/**
 * 刷新调度。
 *
 * `setTimeout` 链而不是 `setInterval`：每一轮跑完才排下一轮，这样退避与
 * `Retry-After` 都能生效，也不会堆积重叠的请求。
 * @module dsh-ds-balance/services/scheduler
 */

import type { BalanceView } from '../domain/balance.js'
import type { Logger } from '../ports/logger.js'
import type { BalanceStatus, GetViewOptions } from './balance-service.js'

/** 首拉延迟。 */
export const INITIAL_DELAY_MS = 1000

/** 缺密钥时的快速重试间隔。 */
export const NO_KEY_RETRY_MS = 5000

/** 指数退避的基数与上限。 */
export const BASE_BACKOFF_MS = 5000
export const MAX_BACKOFF_MS = 300_000

/** 抖动比例。 */
export const JITTER_RATIO = 0.2

/** 退避指数的上限，防止 `2 ** n` 溢出。 */
const MAX_BACKOFF_EXPONENT = 10

/** 延迟下限，避免忙转。 */
export const MIN_DELAY_MS = 1000

/** 定时器抽象，测试可注入。 */
export interface SchedulerTimers {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

/** 调度器需要的最小服务面。 */
export interface SchedulerTarget {
  getView(options?: GetViewOptions): Promise<BalanceView>
  status(): BalanceStatus
}

/** 构造参数。 */
export interface SchedulerOptions {
  target: SchedulerTarget
  timers?: SchedulerTimers
  /** 随机源，抖动用。 */
  random?: () => number
  /** 时刻函数，`nextRunAt` 用。 */
  now?: () => number
  /** 首拉延迟覆盖，测试用。 */
  initialDelayMs?: number
  logger?: Logger | undefined
}

/** 把值夹到区间内。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 加抖动：`base * (1 ± ratio)`。
 * @param base - 基准毫秒数。
 * @param ratio - 抖动比例。
 * @param random - 随机源，返回 `[0, 1)`。
 * @returns 取整后的毫秒数。
 */
export function jitter(base: number, ratio: number, random: () => number): number {
  const min = base * (1 - ratio)
  const span = base * ratio * 2
  return Math.floor(min + random() * span)
}

/**
 * 算下一轮该等多久。
 *
 * 优先级：上游 `Retry-After` → 缺密钥快速重试 → 失败指数退避 → 配置的刷新频率。
 * @param status - 服务的状态切片。
 * @param options - 随机源。
 * @returns 毫秒数。
 */
export function nextDelayMs(status: BalanceStatus, options: { random?: () => number } = {}): number {
  const random = options.random ?? Math.random

  if (status.retryAfterMs !== null && status.retryAfterMs > 0) {
    return clamp(status.retryAfterMs, MIN_DELAY_MS, MAX_BACKOFF_MS)
  }

  if (status.errorCode === 'NO_KEY' && !status.hasSnapshot) {
    return jitter(NO_KEY_RETRY_MS, JITTER_RATIO, random)
  }

  if (status.state === 'error' || status.state === 'stale') {
    const exponent = Math.min(Math.max(0, status.consecutiveFailures - 1), MAX_BACKOFF_EXPONENT)
    return jitter(Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** exponent), JITTER_RATIO, random)
  }

  return jitter(Math.max(MIN_DELAY_MS, status.serverRefreshSeconds * 1000), JITTER_RATIO, random)
}

/** 真正的默认定时器。 */
const defaultTimers: SchedulerTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
}

/**
 * 刷新调度器。
 *
 * `start` / `stop` 幂等；`stop` 之后不再排程。**必须挂在 `ctx.effect` 的 disposer 上。**
 */
export class Scheduler {
  private readonly options: SchedulerOptions
  private readonly timers: SchedulerTimers
  private readonly random: () => number
  private readonly now: () => number
  private readonly initialDelayMs: number
  private handle: unknown = null
  private running = false
  private nextAt: number | null = null

  constructor(options: SchedulerOptions) {
    this.options = options
    this.timers = options.timers ?? defaultTimers
    this.random = options.random ?? Math.random
    this.now = options.now ?? (() => Date.now())
    this.initialDelayMs = options.initialDelayMs ?? INITIAL_DELAY_MS
  }

  /** 下一轮的计划时刻；没排程时为 `null`。 */
  nextRunAt(): number | null {
    return this.nextAt
  }

  /** 是否在运行。 */
  isRunning(): boolean {
    return this.running
  }

  /** 开始调度。重复调用无效。 */
  start(): void {
    if (this.running) return
    this.running = true
    this.schedule(this.initialDelayMs)
  }

  /** 停止调度并清掉已排的那一轮。 */
  stop(): void {
    this.running = false
    if (this.handle !== null) {
      this.timers.clear(this.handle)
      this.handle = null
    }
    this.nextAt = null
  }

  /** 配置或阈值变了之后重排：立刻跑一轮再按新配置继续。 */
  reset(): void {
    this.stop()
    this.running = true
    this.schedule(0)
  }

  /** 排一轮。 */
  private schedule(delay: number): void {
    if (!this.running) return
    this.nextAt = this.now() + delay
    this.handle = this.timers.set(() => { void this.tick() }, delay)
  }

  /** 跑一轮并按状态排下一轮。 */
  private async tick(): Promise<void> {
    this.handle = null
    this.nextAt = null
    if (!this.running) return
    try {
      await this.options.target.getView({ force: true })
    } catch (error) {
      // 服务承诺永不抛错；这里是防御，不让调度链断掉。
      this.options.logger?.error('ds-balance: scheduler tick threw', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    if (!this.running) return
    this.schedule(nextDelayMs(this.options.target.status(), { random: this.random }))
  }
}

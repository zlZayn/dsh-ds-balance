/**
 * 余额缓存与状态机。
 *
 * 职责：把「拿密钥 → 调上游 → 归一化 → 落快照」包成一次可合并的请求，并维护缓存状态。
 * **对外永不抛错**：一切失败都变成 `view.state` 与 `view.error`。
 * @module dsh-ds-balance/services/balance-service
 */

import type { BalanceSnapshot, BalanceView, CacheState } from '../domain/balance.js'
import { classify, parseRetryAfter, type ErrorCode, type ErrorInfo } from '../domain/errors.js'
import { normalize } from '../domain/normalize.js'
import { pickBalance } from '../domain/select.js'
import { severityOf, thresholdsFor } from '../domain/severity.js'
import type { Clock } from '../ports/clock.js'
import type { CoreStore } from '../ports/core-store.js'
import type { DeepSeekClient } from '../ports/deepseek-client.js'
import type { Logger } from '../ports/logger.js'
import { noopMetrics, type Metrics } from '../ports/metrics.js'
import { accountTag8, computeAccountTag } from './account-tag.js'
import type { ConfigService } from './config-service.js'
import type { KeyResolver } from './key-resolver.js'

/** `forceRefresh` 的返回值，形状对齐契约 §8.4。 */
export interface RefreshResult {
  triggered: boolean
  joined: boolean
  cooldownMs: number
  state: CacheState
}

/** 调度器需要的状态切片。 */
export interface BalanceStatus {
  state: CacheState
  errorCode: ErrorCode | null
  consecutiveFailures: number
  hasSnapshot: boolean
  serverRefreshSeconds: number
  /** 上游给的 `Retry-After`，优先于自算退避。 */
  retryAfterMs: number | null
  /** 最近一次成功抓取的时刻；从未成功过是 `null`。健康检查要用。 */
  lastSuccessAt: number | null
}

/** `getView` 的可选参数。 */
export interface GetViewOptions {
  /** 跳过新鲜度判据强制拉一次。 */
  force?: boolean
  /** 覆盖展示币种偏好；缺省读配置。 */
  currency?: string
}

/** 构造参数。 */
export interface BalanceServiceOptions {
  client: DeepSeekClient
  store: CoreStore
  keys: KeyResolver
  config: ConfigService
  clock: Clock
  /** 服务端盐，用来算 `accountTag`。 */
  salt: string
  logger?: Logger | undefined
  metrics?: Metrics | undefined
}

/** 余额缓存与状态机。 */
export class BalanceService {
  private readonly options: BalanceServiceOptions
  private readonly metrics: Metrics
  private snapshot: BalanceSnapshot | null = null
  private state: CacheState = 'empty'
  private error: ErrorInfo | null = null
  private failures = 0
  private retryAfterMs: number | null = null
  private inflight: Promise<BalanceView> | null = null
  /** 落盘失败只报一次，避免每轮刷新都刷屏。 */
  private persistWarned = false

  constructor(options: BalanceServiceOptions) {
    this.options = options
    this.metrics = options.metrics ?? noopMetrics
  }

  /** 当前状态切片，供调度与健康检查使用。 */
  status(): BalanceStatus {
    return {
      state: this.state,
      errorCode: this.error?.code ?? null,
      consecutiveFailures: this.failures,
      hasSnapshot: this.snapshot !== null,
      serverRefreshSeconds: this.options.config.current().serverRefreshSeconds,
      retryAfterMs: this.retryAfterMs,
      lastSuccessAt: this.snapshot?.fetchedAt ?? null,
    }
  }

  /**
   * 当前账本标识的前 8 位；还没有快照时是 `null`。
   *
   * **只回前 8 位**：完整 tag 是账本作用域标识，没有对外的理由。
   */
  accountTag8(): string | null {
    const tag = this.snapshot?.accountTag
    return tag === undefined ? null : accountTag8(tag)
  }

  /**
   * 从存储恢复最近快照（挂载时调一次）。
   *
   * **按 `accountTag` 过滤**：凭据轮换后 tag 变了，旧快照视为不存在，不混用。
   * 没有密钥可算 tag 时静默跳过。
   */
  async restore(): Promise<void> {
    try {
      const apiKey = await this.options.keys.resolve()
      const accountTag = computeAccountTag(this.options.salt, apiKey)
      const stored = await this.options.store.loadLatestSnapshot(accountTag)
      if (stored === null) return
      this.snapshot = stored
      this.state = this.withinWindow() ? 'ok' : 'stale'
      this.publishGauge()
    } catch (error) {
      this.options.logger?.debug('ds-balance: no snapshot restored', { error: describe(error) })
    }
  }

  /**
   * 取当前视图。
   *
   * 有在飞的请求就合并；不 force 且未过期就返回缓存；否则拉一次。
   */
  async getView(options: GetViewOptions = {}): Promise<BalanceView> {
    if (this.inflight !== null) return this.inflight
    if (options.force !== true && this.canServeCache()) return this.toView(options.currency)

    const run = this.fetchOnce(options.currency).finally(() => { this.inflight = null })
    this.inflight = run
    return run
  }

  /**
   * 手动刷新。
   *
   * 冷却中不触发；已有请求在飞时合并并回报 `joined`。
   */
  async forceRefresh(reason: string): Promise<RefreshResult> {
    const cooldownMs = this.options.config.current().manualRefreshCooldownSeconds * 1000
    const since = this.options.clock.now() - (this.snapshot?.fetchedAt ?? 0)
    if (this.state === 'ok' && since < cooldownMs) {
      this.metrics.counter('force_rejected_total')
      this.options.logger?.debug('ds-balance: manual refresh rejected by cooldown', { reason })
      return { triggered: false, joined: false, cooldownMs: cooldownMs - since, state: this.state }
    }
    if (this.inflight !== null) {
      await this.inflight
      return { triggered: true, joined: true, cooldownMs: 0, state: this.state }
    }
    await this.getView({ force: true })
    return { triggered: true, joined: false, cooldownMs: 0, state: this.state }
  }

  /** 快照是否还在 `serverRefreshSeconds` 窗口内。**只看时间，不看状态。** */
  private withinWindow(): boolean {
    if (this.snapshot === null) return false
    const window = this.options.config.current().serverRefreshSeconds * 1000
    return this.options.clock.now() - this.snapshot.fetchedAt < window
  }

  /**
   * 能否直接拿缓存顶上。
   *
   * 与 {@link withinWindow} 分开：`restore` 要在状态还是 `empty` 时用纯时间判据，
   * 而这里必须要求 `ok` —— 否则一次失败之后，窗口内的旧快照会让 `getView`
   * 永远不再重试。
   */
  private canServeCache(): boolean {
    return this.state === 'ok' && this.withinWindow()
  }

  /** 跑一次真实抓取。**所有异常都在这里被吸收。** */
  private async fetchOnce(currency: string | undefined): Promise<BalanceView> {
    const startedAt = this.options.clock.now()
    try {
      const apiKey = await this.options.keys.resolve()
      const config = this.options.config.current()
      const raw = await this.options.client.fetchBalance({
        baseUrl: config.baseUrl,
        apiKey,
        timeoutMs: this.options.config.timeoutMs(),
      })
      const snapshot = normalize(raw, computeAccountTag(this.options.salt, apiKey), this.options.clock.now())
      // 落盘失败不算这次抓取失败：快照留在内存里，界面照常显示，
      // 代价只是重启后不恢复。存储是可降级的一层。
      await this.persist(snapshot)
      this.snapshot = snapshot
      this.state = 'ok'
      this.error = null
      this.failures = 0
      this.retryAfterMs = null
      this.metrics.counter('balance_fetch_total', { result: 'ok' })
      this.metrics.histogram('balance_fetch_duration_ms', {}, this.options.clock.now() - startedAt)
      this.publishGauge()
      return this.toView(currency)
    } catch (error) {
      this.applyFailure(error, startedAt)
      return this.toView(currency)
    }
  }

  /**
   * 把快照落盘。
   *
   * **失败只记一次 warn，不往上抛**：存储层降级不该让整个余额功能不可用。
   * @param snapshot - 刚归一化出来的快照。
   */
  private async persist(snapshot: BalanceSnapshot): Promise<void> {
    try {
      await this.options.store.saveSnapshot(snapshot)
    } catch (error) {
      if (this.persistWarned) return
      this.persistWarned = true
      this.options.logger?.warn('ds-balance: snapshot not persisted, continuing in memory', { error: describe(error) })
    }
  }

  /** 记录一次失败，并把状态推到 `stale` 或 `error`。 */
  private applyFailure(error: unknown, startedAt: number): void {
    const info = classify(error)
    this.failures += 1
    this.error = info
    this.state = this.snapshot === null ? 'error' : 'stale'
    this.retryAfterMs = retryAfterOf(error, this.options.clock.now())
    // 只在首次失败打 warn，避免日志刷屏。
    if (this.failures === 1) {
      this.options.logger?.warn('ds-balance: balance fetch failed', { code: info.code })
    }
    this.metrics.counter('balance_fetch_total', { result: 'error' })
    this.metrics.histogram('balance_fetch_duration_ms', {}, this.options.clock.now() - startedAt)
    this.publishGauge()
  }

  /** 把缓存状态推成指标。 */
  private publishGauge(): void {
    this.metrics.gauge('cache_state', { state: this.state }, 1)
  }

  /** 把缓存折成对外视图。 */
  private toView(currency: string | undefined): BalanceView {
    const config = this.options.config.current()
    const thresholds = this.options.config.thresholds()
    const preference = currency ?? config.displayCurrency
    const selected = this.snapshot === null ? null : pickBalance(this.snapshot.balances, preference)
    return {
      state: this.state,
      stale: this.state === 'stale',
      fetchedAt: this.snapshot?.fetchedAt ?? null,
      ageMs: this.snapshot === null ? null : Math.max(0, this.options.clock.now() - this.snapshot.fetchedAt),
      isAvailable: this.snapshot?.isAvailable ?? null,
      balances: this.snapshot?.balances ?? [],
      selected: selected === null ? null : { currency: selected.currency, total: selected.total },
      severity: severityOf(selected, this.snapshot?.isAvailable ?? false, thresholdsFor(selected?.currency ?? '', thresholds)),
      thresholds,
      error: this.state === 'ok' ? null : this.error,
    }
  }
}

/** 从上游错误里抽 `Retry-After`；抽不到返回 `null`。 */
function retryAfterOf(error: unknown, now: number): number | null {
  const headers = (error as { headers?: Headers }).headers
  if (headers === undefined) return null
  return parseRetryAfter(headers, now) ?? null
}

/** 把未知异常压成一行。 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

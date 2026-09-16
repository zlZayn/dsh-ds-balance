import { describe, expect, it, vi } from 'vitest'
import {
  BASE_BACKOFF_MS,
  INITIAL_DELAY_MS,
  JITTER_RATIO,
  MAX_BACKOFF_MS,
  NO_KEY_RETRY_MS,
  Scheduler,
  jitter,
  nextDelayMs,
  type SchedulerTarget,
} from '../src/services/scheduler.ts'
import type { BalanceStatus } from '../src/services/balance-service.ts'

function status(patch: Partial<BalanceStatus> = {}): BalanceStatus {
  return {
    state: 'ok',
    errorCode: null,
    consecutiveFailures: 0,
    hasSnapshot: true,
    serverRefreshSeconds: 60,
    retryAfterMs: null,
    lastSuccessAt: null,
    ...patch,
  }
}

/** 确定性的随机源：永远取区间中点。 */
const mid = () => 0.5

describe('jitter', () => {
  it('中点等于基准值', () => {
    expect(jitter(1000, 0.2, mid)).toBe(1000)
  })

  it('落在 ±ratio 区间内', () => {
    expect(jitter(1000, 0.2, () => 0)).toBe(800)
    expect(jitter(1000, 0.2, () => 0.999_999)).toBeLessThanOrEqual(1200)
  })

  it('比例是 20%', () => {
    expect(JITTER_RATIO).toBe(0.2)
  })
})

describe('nextDelayMs', () => {
  it('Retry-After 优先', () => {
    expect(nextDelayMs(status({ state: 'error', retryAfterMs: 7000 }), { random: mid })).toBe(7000)
  })

  it('Retry-After 会被夹到上限', () => {
    expect(nextDelayMs(status({ retryAfterMs: 10_000_000 }), { random: mid })).toBe(MAX_BACKOFF_MS)
  })

  it('正常态按配置的刷新频率', () => {
    expect(nextDelayMs(status({ serverRefreshSeconds: 90 }), { random: mid })).toBe(90_000)
  })

  it('缺密钥且无快照时快速重试', () => {
    expect(nextDelayMs(status({ state: 'error', errorCode: 'NO_KEY', hasSnapshot: false }), { random: mid }))
      .toBe(NO_KEY_RETRY_MS)
  })

  it('有快照时不走缺密钥分支', () => {
    const delay = nextDelayMs(status({ state: 'stale', errorCode: 'NO_KEY', hasSnapshot: true, consecutiveFailures: 1 }), { random: mid })
    expect(delay).toBe(BASE_BACKOFF_MS)
  })

  it('失败按指数退避', () => {
    for (const [failures, expected] of [[1, BASE_BACKOFF_MS], [2, BASE_BACKOFF_MS * 2], [3, BASE_BACKOFF_MS * 4]] as const) {
      expect(nextDelayMs(status({ state: 'error', consecutiveFailures: failures }), { random: mid })).toBe(expected)
    }
  })

  it('退避有上限', () => {
    expect(nextDelayMs(status({ state: 'error', consecutiveFailures: 50 }), { random: mid })).toBe(MAX_BACKOFF_MS)
  })

  it('抖动始终为正', () => {
    for (const failures of [0, 1, 5, 50]) {
      expect(nextDelayMs(status({ state: 'error', consecutiveFailures: failures }), { random: () => 0 })).toBeGreaterThan(0)
    }
  })
})

/** 手动推进的定时器替身。 */
function fakeTimers() {
  let seq = 0
  let now = 0
  const jobs = new Map<number, { fn: () => void; at: number }>()
  const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve() }
  return {
    timers: {
      set: (fn: () => void, ms: number): unknown => { seq += 1; jobs.set(seq, { fn, at: now + ms }); return seq },
      clear: (handle: unknown): void => { jobs.delete(handle as number) },
    },
    now: () => now,
    pending: () => [...jobs.values()].map((job) => job.at - now),
    async advance(ms: number): Promise<void> {
      now += ms
      for (const [id, job] of [...jobs.entries()]) {
        if (job.at <= now) { jobs.delete(id); job.fn() }
      }
      await flush()
    },
  }
}

describe('Scheduler', () => {
  function harness(targetPatch: Partial<SchedulerTarget> = {}) {
    const clock = fakeTimers()
    const target: SchedulerTarget = {
      getView: vi.fn().mockResolvedValue({}),
      status: () => status(),
      ...targetPatch,
    }
    const scheduler = new Scheduler({
      target, timers: clock.timers, random: mid, now: clock.now,
    })
    return { scheduler, target, clock }
  }

  it('start 排首拉', () => {
    const h = harness()
    h.scheduler.start()
    expect(h.scheduler.isRunning()).toBe(true)
    expect(h.clock.pending()).toEqual([INITIAL_DELAY_MS])
    expect(h.scheduler.nextRunAt()).toBe(INITIAL_DELAY_MS)
  })

  it('到点跑一轮并排下一轮', async () => {
    const h = harness()
    h.scheduler.start()
    await h.clock.advance(INITIAL_DELAY_MS)
    expect(h.target.getView).toHaveBeenCalledWith({ force: true })
    expect(h.clock.pending()).toEqual([60_000])
  })

  it('重复 start 不会排两轮', () => {
    const h = harness()
    h.scheduler.start()
    h.scheduler.start()
    expect(h.clock.pending()).toHaveLength(1)
  })

  it('stop 之后不再跑', async () => {
    const h = harness()
    h.scheduler.start()
    h.scheduler.stop()
    await h.clock.advance(INITIAL_DELAY_MS * 10)
    expect(h.target.getView).not.toHaveBeenCalled()
    expect(h.scheduler.nextRunAt()).toBeNull()
    expect(h.scheduler.isRunning()).toBe(false)
  })

  it('reset 立刻跑一轮', async () => {
    const h = harness()
    h.scheduler.start()
    h.scheduler.reset()
    await h.clock.advance(0)
    expect(h.target.getView).toHaveBeenCalledTimes(1)
  })

  it('失败态用退避间隔', async () => {
    const h = harness({ status: () => status({ state: 'error', consecutiveFailures: 3 }) })
    h.scheduler.start()
    await h.clock.advance(INITIAL_DELAY_MS)
    expect(h.clock.pending()).toEqual([BASE_BACKOFF_MS * 4])
  })

  it('目标抛错也不会断链', async () => {
    const h = harness({ getView: vi.fn().mockRejectedValue(new Error('boom')) })
    h.scheduler.start()
    await h.clock.advance(INITIAL_DELAY_MS)
    expect(h.clock.pending()).toEqual([60_000])
  })

  it('tick 期间被 stop 就不再排下一轮', async () => {
    let scheduler: Scheduler
    const h = harness({
      getView: vi.fn().mockImplementation(async () => { scheduler.stop(); return {} }),
    })
    scheduler = h.scheduler
    h.scheduler.start()
    await h.clock.advance(INITIAL_DELAY_MS)
    expect(h.clock.pending()).toEqual([])
  })
})

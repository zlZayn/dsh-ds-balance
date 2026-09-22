import { describe, expect, it } from 'vitest'
import {
  CONFIG_SLOT, CONFIG_SLOT_TIMEOUT_MS, CONFIG_SLOT_WARNING, createConfigSlotProbe,
} from '../src/client/config-slot.ts'

/**
 * 假时钟：记住到点回调与取消，测试自己决定什么时候"到点"。
 * 真实计时器一律不进测试 —— 时间相关断言都注入时刻。
 */
function fakeClock(): {
  schedule: (fire: () => void, ms: number) => () => void
  fire: () => void
  cancelled: () => boolean
  delay: () => number | undefined
} {
  let pending: (() => void) | undefined
  let delay: number | undefined
  let cancelled = false
  return {
    schedule: (fire, ms) => {
      pending = fire
      delay = ms
      return () => { cancelled = true; pending = undefined }
    },
    // 真实计时器取消后不会再回调；假时钟照做，否则测不出「标记声明后超时不再生效」。
    fire: () => { const run = pending; if (!cancelled && run) run() },
    cancelled: () => cancelled,
    delay: () => delay,
  }
}

describe('配置槽探测', () => {
  it('默认等满上限才判 missing，上限用默认值', () => {
    const clock = fakeClock()
    const probe = createConfigSlotProbe({ schedule: clock.schedule })
    expect(clock.delay()).toBe(CONFIG_SLOT_TIMEOUT_MS)
    expect(probe.getSnapshot()).toBe('pending')
    clock.fire()
    expect(probe.getSnapshot()).toBe('missing')
  })

  it('上限之内不下结论：pending 期间不通知', () => {
    const clock = fakeClock()
    const probe = createConfigSlotProbe({ schedule: clock.schedule })
    let calls = 0
    probe.subscribe(() => { calls += 1 })
    expect(probe.getSnapshot()).toBe('pending')
    expect(calls).toBe(0)
  })

  it('槽按时声明：判 available，超时不再生效', () => {
    const clock = fakeClock()
    const probe = createConfigSlotProbe({ schedule: clock.schedule })
    const seen: string[] = []
    probe.subscribe(() => { seen.push(probe.getSnapshot()) })
    probe.markDeclared()
    expect(probe.getSnapshot()).toBe('available')
    expect(clock.cancelled()).toBe(true)
    clock.fire()
    expect(probe.getSnapshot()).toBe('available')
    expect(seen).toEqual(['available'])
  })

  it('槽晚到：提示要能撤回（missing -> available）', () => {
    const clock = fakeClock()
    const probe = createConfigSlotProbe({ schedule: clock.schedule })
    const seen: string[] = []
    probe.subscribe(() => { seen.push(probe.getSnapshot()) })
    clock.fire()
    expect(probe.getSnapshot()).toBe('missing')
    probe.markDeclared()
    expect(probe.getSnapshot()).toBe('available')
    expect(seen).toEqual(['missing', 'available'])
  })

  it('重复声明与重复超时都不重复通知', () => {
    const clock = fakeClock()
    const probe = createConfigSlotProbe({ schedule: clock.schedule })
    let calls = 0
    probe.subscribe(() => { calls += 1 })
    clock.fire()
    clock.fire()
    probe.markDeclared()
    probe.markDeclared()
    expect(calls).toBe(2)
  })

  it('释放后不再通知、订阅立即失效', () => {
    const clock = fakeClock()
    const probe = createConfigSlotProbe({ schedule: clock.schedule })
    let calls = 0
    probe.subscribe(() => { calls += 1 })
    probe.dispose()
    expect(clock.cancelled()).toBe(true)
    probe.markDeclared()
    clock.fire()
    expect(calls).toBe(0)
  })

  it('提示文案是英文、带 [WARN] 前缀、无 emoji', () => {
    expect(CONFIG_SLOT_WARNING.startsWith('[WARN] ')).toBe(true)
    // 非 ASCII 一律不许出现：前缀之外还夹中文或 emoji 就是违约。
    expect(/^[\x20-\x7e]+$/.test(CONFIG_SLOT_WARNING)).toBe(true)
    // 文案必须点名**卡片真正注册的那一格**。0.1.7 把它从 bundle 槽换到了 row 槽，
    // 文案不跟着换就会指着一个我们根本没用的槽 —— 提示比没有提示更误事。
    expect(CONFIG_SLOT_WARNING).toContain(CONFIG_SLOT)
    expect(CONFIG_SLOT).toBe('plugins.row.config')
    expect(CONFIG_SLOT_WARNING).not.toContain('plugins.bundle.config')
    expect(CONFIG_SLOT_WARNING).toContain('engines.dsh')
  })
})

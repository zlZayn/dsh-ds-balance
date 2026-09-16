import { describe, expect, it } from 'vitest'
import { scenarios } from '../src/client/mock/scenarios.ts'
import { selectionOf } from '../src/client/model.ts'

describe('mock 场景不变量', () => {
  it('selected 要么是 null，要么能在 balances 里找到同币种同金额的一条', () => {
    for (const [key, value] of Object.entries(scenarios)) {
      if (value.selected === null) continue
      const hit = value.balances.find(
        (item) => item.currency.toUpperCase() === value.selected!.currency.toUpperCase(),
      )
      expect(hit, key + ' 的 selected 在 balances 里找不到对应币种').toBeDefined()
      expect(hit?.total, key + ' 的 selected 金额与 balances 不一致').toBe(value.selected.total)
    }
  })

  it('balances 为空时 selected 必须是 null', () => {
    for (const [key, value] of Object.entries(scenarios)) {
      if (value.balances.length === 0) expect(value.selected, key).toBeNull()
    }
  })

  it('每个场景都能被 selectionOf 消费（不抛错、形状自洽）', () => {
    for (const [key, value] of Object.entries(scenarios)) {
      const auto = selectionOf(value, 'auto')
      expect(auto.empty, key).toBe(value.selected === null)
      const usd = selectionOf(value, 'USD')
      expect(typeof usd.matchesPreference, key).toBe('boolean')
    }
  })

  it('覆盖了 state 的四档与 severity 的五档', () => {
    const states = new Set(Object.values(scenarios).map((value) => value.state))
    const severities = new Set(Object.values(scenarios).map((value) => value.severity))
    for (const state of ['empty', 'ok', 'stale', 'error']) expect([...states]).toContain(state)
    for (const severity of ['ok', 'warn', 'critical', 'unavailable', 'unknown']) {
      expect([...severities]).toContain(severity)
    }
  })
})

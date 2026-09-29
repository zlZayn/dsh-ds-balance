import { describe, expect, it } from 'vitest'
import type { BalanceSource } from '../src/domain/balance.ts'
import {
  ACCOUNT_PROVIDER,
  DEFAULT_SOURCE,
  FALLBACK_ORDER,
  KEY_PROVIDER,
  pickSource,
  routeOf,
} from '../src/services/source-selector.ts'

/** 造一个「哪条可用」的判据。 */
const only =
  (...sources: BalanceSource[]) =>
  (source: BalanceSource) =>
    sources.includes(source)

describe('routeOf', () => {
  it('认两条官方路', () => {
    expect(routeOf(KEY_PROVIDER)).toBe('deepseek-http')
    expect(routeOf(ACCOUNT_PROVIDER)).toBe('deepseek-account')
  })

  it('别家供应商是「other」而不是「读不到」', () => {
    expect(routeOf('opencode-go')).toBe('other')
    expect(routeOf('glm')).toBe('other')
  })

  it('空值与缺席都算读不到', () => {
    expect(routeOf(null)).toBeNull()
    expect(routeOf(undefined)).toBeNull()
    expect(routeOf('')).toBeNull()
  })
})

describe('pickSource', () => {
  it('路由点名的那条可用就用它', () => {
    expect(pickSource({ routed: 'deepseek-http', available: only('deepseek-http') })).toBe(
      'deepseek-http',
    )
    expect(pickSource({ routed: 'deepseek-account', available: only('deepseek-account') })).toBe(
      'deepseek-account',
    )
  })

  it('路由点名的那条不可用 → 回落到另一条', () => {
    expect(pickSource({ routed: 'deepseek-account', available: only('deepseek-http') })).toBe(
      'deepseek-http',
    )
    expect(pickSource({ routed: 'deepseek-http', available: only('deepseek-account') })).toBe(
      'deepseek-account',
    )
  })

  it('别家供应商 / 读不到路由 → 按固定顺序回落', () => {
    for (const routed of ['other', null] as const) {
      expect(pickSource({ routed, available: only('deepseek-http', 'deepseek-account') })).toBe(
        'deepseek-http',
      )
      expect(pickSource({ routed, available: only('deepseek-account') })).toBe('deepseek-account')
    }
  })

  it('一条都不可用 → 回默认那条（由它自然报 NO_KEY）', () => {
    expect(pickSource({ routed: null, available: () => false })).toBe(DEFAULT_SOURCE)
    expect(pickSource({ routed: 'deepseek-account', available: () => false })).toBe(DEFAULT_SOURCE)
  })

  it('固定顺序以 Key 优先开头：这是「不改变今天能用的用户」的落点', () => {
    expect(FALLBACK_ORDER[0]).toBe('deepseek-http')
  })
})

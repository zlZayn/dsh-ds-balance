import { describe, expect, it } from 'vitest'
import { severityOf, thresholdsFor, thresholdsOf } from '../src/domain/severity.ts'
import { formatMoney, parseMoney } from '../src/domain/money.ts'
import type { BalanceInfo } from '../src/domain/balance.ts'

const config = { cnyWarn: 10, cnyCritical: 5, usdWarn: 2, usdCritical: 1 }

function balance(total: string): BalanceInfo {
  return { currency: 'CNY', total: parseMoney(total), granted: 0n, toppedUp: parseMoney(total) }
}

describe('thresholdsOf', () => {
  it('按币种产出阈值', () => {
    const thresholds = thresholdsOf(config)
    expect(formatMoney(thresholds.CNY!.warn, 2)).toBe('10.00')
    expect(formatMoney(thresholds.CNY!.critical, 2)).toBe('5.00')
    expect(formatMoney(thresholds.USD!.warn, 2)).toBe('2.00')
    expect(formatMoney(thresholds.USD!.critical, 2)).toBe('1.00')
  })
})

describe('thresholdsFor', () => {
  it('没有配置的币种回落成全零', () => {
    expect(thresholdsFor('EUR', thresholdsOf(config))).toEqual({ warn: 0n, critical: 0n })
  })
})

describe('severityOf', () => {
  const thresholds = thresholdsOf(config).CNY!

  it('没有选定币种时是 unknown', () => {
    expect(severityOf(null, true, thresholds)).toBe('unknown')
  })

  it('**账户不可用压过「没有币种」**：停用 + 空余额列表是一条真实路径', () => {
    // 欠费/停用的账户上游可能给空的 balance_infos —— 那时 selected 也是 null。
    // 若先判 selected === null 就会返回 unknown，界面把「账户停用」画成灰环，
    // 与「账户本来就没有余额」同形（真机上就是这么漏的）。
    expect(severityOf(null, false, thresholds)).toBe('unavailable')
  })

  it('账户不可用压过阈值', () => {
    expect(severityOf(balance('1000'), false, thresholds)).toBe('unavailable')
  })

  it('阈值边界取等号', () => {
    expect(severityOf(balance('5'), true, thresholds)).toBe('critical')
    expect(severityOf(balance('5.01'), true, thresholds)).toBe('warn')
    expect(severityOf(balance('10'), true, thresholds)).toBe('warn')
    expect(severityOf(balance('10.01'), true, thresholds)).toBe('ok')
  })

  it('零余额是 critical 而不是 unknown', () => {
    expect(severityOf(balance('0'), true, thresholds)).toBe('critical')
  })

  it('五档全覆盖', () => {
    const seen = new Set([
      severityOf(balance('100'), true, thresholds),
      severityOf(balance('7'), true, thresholds),
      severityOf(balance('3'), true, thresholds),
      severityOf(balance('3'), false, thresholds),
      severityOf(null, true, thresholds),
    ])
    expect([...seen].sort()).toEqual(['critical', 'ok', 'unavailable', 'unknown', 'warn'])
  })

  it('`unavailable` 只由 isAvailable=false 产生，不会与「没有币种」互相顶替', () => {
    // 两条判据各自独立：账户可用 + 没币种 = unknown；账户不可用 = unavailable（无论有没有币种）。
    expect(severityOf(null, true, thresholds)).toBe('unknown')
    expect(severityOf(null, false, thresholds)).toBe('unavailable')
    expect(severityOf(balance('100'), false, thresholds)).toBe('unavailable')
  })
})

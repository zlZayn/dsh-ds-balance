import { describe, expect, it } from 'vitest'
import type { BalanceResponse } from '../src/client/api-types.ts'
import {
  ageBucket,
  currencySymbol,
  dotStateOf,
  formatAmount,
  formatMoney,
  ringSpecOf,
  selectionOf,
} from '../src/client/model.ts'

/** 造一个响应；只覆写关心的字段。 */
function response(patch: Partial<BalanceResponse> = {}): BalanceResponse {
  return {
    requestId: 'req_test',
    schemaVersion: 1,
    state: 'ok',
    stale: false,
    fetchedAt: 1_760_000_000_000,
    ageMs: 12_000,
    isAvailable: true,
    accountTag8: 'a1b2c3d4',
    balances: [{ currency: 'CNY', total: '110.00000000', granted: '10.00000000', toppedUp: '100.00000000' }],
    selected: { currency: 'CNY', total: '110.00000000' },
    severity: 'ok',
    thresholds: { CNY: { warn: '10.00000000', critical: '5.00000000' } },
    todayUsage: null,
    error: null,
    ...patch,
  }
}

describe('dotStateOf', () => {
  it('把 severity 机械映射到五个状态，没有金额判断', () => {
    expect(dotStateOf('ok')).toBe('done')
    expect(dotStateOf('warn')).toBe('warning')
    expect(dotStateOf('critical')).toBe('error')
    expect(dotStateOf('unavailable')).toBe('error')
    expect(dotStateOf('unknown')).toBe('idle')
  })
})

describe('formatAmount / formatMoney', () => {
  it('裁两位、补千分位，全程按字符串走', () => {
    expect(formatAmount('1234567.89000000')).toBe('1,234,567.89')
    expect(formatAmount('110.00000000')).toBe('110')
    expect(formatAmount('-5.50000000')).toBe('-5.50')
  })

  it('未知币种回落成代码本身，不加符号', () => {
    expect(currencySymbol('CNY')).toBe('¥')
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('JPY')).toBe('')
    expect(formatMoney('12.00000000', 'JPY')).toBe('12')
  })
})

describe('selectionOf', () => {
  it('读后端的 selected，而不是自己挑', () => {
    const value = selectionOf(response({
      balances: [
        { currency: 'CNY', total: '110.00000000', granted: '0.00000000', toppedUp: '110.00000000' },
        { currency: 'USD', total: '20.00000000', granted: '0.00000000', toppedUp: '20.00000000' },
      ],
      // 后端把 USD 排在后面却选了它：顺序不该影响结果。
      selected: { currency: 'USD', total: '20.00000000' },
    }), 'auto')
    expect(value.shown?.currency).toBe('USD')
    expect(value.shown?.granted).toBe('0.00000000')
    expect(value.matchesPreference).toBe(true)
    expect(value.auto).toBe(true)
    expect(value.empty).toBe(false)
  })

  it('auto 永不报不匹配', () => {
    expect(selectionOf(response(), 'auto').matchesPreference).toBe(true)
    expect(selectionOf(response(), '').matchesPreference).toBe(true)
  })

  it('选定币种与后端选出的不一致时标记不匹配', () => {
    const value = selectionOf(response(), 'USD')
    expect(value.matchesPreference).toBe(false)
    expect(value.shown?.currency).toBe('CNY')
    expect(value.auto).toBe(false)
  })

  it('币种比较不区分大小写', () => {
    expect(selectionOf(response(), 'cny').matchesPreference).toBe(true)
  })

  it('selected 为 null 时是空态', () => {
    const value = selectionOf(response({ balances: [], selected: null, severity: 'unknown' }), 'USD')
    expect(value.shown).toBeNull()
    expect(value.empty).toBe(true)
    expect(value.matchesPreference).toBe(false)
  })

  it('selected 指向 balances 里没有的币种时给 null，不硬凑一条', () => {
    const value = selectionOf(response({ selected: { currency: 'EUR', total: '1.00000000' } }), 'auto')
    expect(value.shown).toBeNull()
    expect(value.empty).toBe(true)
  })
})

describe('ageBucket', () => {
  it('按毫秒差归档，负值与非数归 unknown', () => {
    expect(ageBucket(1_000).bucket).toBe('just-now')
    expect(ageBucket(30_000).bucket).toBe('seconds')
    expect(ageBucket(90_000).bucket).toBe('minutes')
    expect(ageBucket(3 * 3_600_000).bucket).toBe('hours')
    expect(ageBucket(50 * 3_600_000).bucket).toBe('days')
    expect(ageBucket(Number.NaN).bucket).toBe('unknown')
    expect(ageBucket(-1).bucket).toBe('unknown')
  })
})

describe('ringSpecOf', () => {
  it('颜色编码数值严重度：绿 → 琥珀 → 红', () => {
    expect(ringSpecOf('ok').state).toBe('done')
    expect(ringSpecOf('warn').state).toBe('warning')
    expect(ringSpecOf('critical').state).toBe('error')
  })

  it('critical 与 unavailable 都是红弧，靠中心叉号区分', () => {
    // 官方 token 里 error-primary 与 error-secondary 在深色主题下同值，
    // 没有第五种色相可用，所以「账户不可用」用形状编码。
    expect(ringSpecOf('critical').marker).toBeNull()
    expect(ringSpecOf('unavailable').marker).toBe('cross')
  })

  it('只有 unavailable 画中心符号，其余四档都不画', () => {
    for (const severity of ['ok', 'warn', 'critical', 'unknown'] as const) {
      expect(ringSpecOf(severity).marker, severity).toBeNull()
    }
    expect(ringSpecOf('unavailable').marker).toBe('cross')
  })

  it('unknown 保持灰弧且不画符号', () => {
    expect(ringSpecOf('unknown')).toEqual({ state: 'idle', marker: null })
  })
})

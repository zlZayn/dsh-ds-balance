import { describe, expect, it } from 'vitest'
import type { BalanceView } from '../src/domain/balance.ts'
import { parseMoney } from '../src/domain/money.ts'
import { newRequestId, toWireBalanceView, toWireError } from '../src/http/wire.ts'
import { SCHEMA_VERSION } from '../src/version.ts'
import type { BalanceResponse } from '../src/client/api-types.ts'

/** 造一个视图；只覆写关心的字段。 */
function view(patch: Partial<BalanceView> = {}): BalanceView {
  return {
    state: 'ok',
    stale: false,
    fetchedAt: 1_760_000_000_000,
    ageMs: 12_000,
    isAvailable: true,
    balances: [{ currency: 'CNY', total: parseMoney('110'), granted: parseMoney('10'), toppedUp: parseMoney('100') }],
    selected: { currency: 'CNY', total: parseMoney('110') },
    severity: 'ok',
    thresholds: { CNY: { warn: parseMoney('10'), critical: parseMoney('5') } },
    error: null,
    ...patch,
  }
}

describe('toWireBalanceView', () => {
  it('金额一律折成八位小数字符串', () => {
    const body = toWireBalanceView(view(), 'a1b2c3d4', 'req_test')
    expect(body.balances[0]?.total).toBe('110.00000000')
    expect(body.balances[0]?.granted).toBe('10.00000000')
    expect(body.balances[0]?.toppedUp).toBe('100.00000000')
    expect(body.selected?.total).toBe('110.00000000')
    expect(body.thresholds.CNY?.warn).toBe('10.00000000')
    expect(body.thresholds.CNY?.critical).toBe('5.00000000')
  })

  it('回传 schema 版本、请求标识与账本短标识', () => {
    const body = toWireBalanceView(view(), 'a1b2c3d4', 'req_test')
    expect(body.schemaVersion).toBe(SCHEMA_VERSION)
    expect(body.requestId).toBe('req_test')
    expect(body.accountTag8).toBe('a1b2c3d4')
    expect(body.todayUsage).toBeNull()
    expect(body.error).toBeNull()
  })

  it('没有快照时 fetchedAt 与 ageMs 记 0，isAvailable 记 false', () => {
    const body = toWireBalanceView(
      view({ state: 'empty', fetchedAt: null, ageMs: null, isAvailable: null, balances: [], selected: null, severity: 'unknown' }),
      '',
      'req_test',
    )
    expect(body.fetchedAt).toBe(0)
    expect(body.ageMs).toBe(0)
    expect(body.isAvailable).toBe(false)
    expect(body.selected).toBeNull()
    expect(body.balances).toEqual([])
  })

  it('错误带 code / message / retryable，details 不外传', () => {
    const body = toWireBalanceView(
      view({ state: 'error', error: { code: 'NO_KEY', message: 'no api key', retryable: false, details: { ref: 'DEEPSEEK_API_KEY' } } }),
      '',
      'req_test',
    )
    expect(body.error).toEqual({ code: 'NO_KEY', message: 'no api key', retryable: false })
  })

  it('响应体满足前端契约类型 BalanceResponse（编译期断言）', () => {
    const body: BalanceResponse = toWireBalanceView(view(), 'a1b2c3d4', 'req_test')
    expect(body.severity).toBe('ok')
  })
})

describe('toWireError', () => {
  it('只保留 code / message / retryable', () => {
    expect(toWireError({ code: 'UPSTREAM_429', message: 'slow down', retryable: true, details: { retryAfterMs: 1000 } }))
      .toEqual({ code: 'UPSTREAM_429', message: 'slow down', retryable: true })
  })
})

describe('newRequestId', () => {
  it('形如 req_ 前缀的十六进制串，且每次不同', () => {
    const a = newRequestId()
    const b = newRequestId()
    expect(a).toMatch(/^req_[0-9a-f]{16}$/)
    expect(a).not.toBe(b)
  })
})

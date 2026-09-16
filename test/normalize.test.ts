import { describe, expect, it } from 'vitest'
import { nextSnapshotId, normalize, parseErrorBody } from '../src/domain/normalize.ts'
import { ParseError, ShapeError } from '../src/domain/errors.ts'
import { formatMoney } from '../src/domain/money.ts'

const good = {
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '110.00000000', granted_balance: '10.00000000', topped_up_balance: '100.00000000' },
  ],
}

describe('normalize', () => {
  it('解析出最小单位金额', () => {
    const snapshot = normalize(good, 'tag', 1760000000000)
    expect(snapshot.accountTag).toBe('tag')
    expect(snapshot.fetchedAt).toBe(1760000000000)
    expect(snapshot.isAvailable).toBe(true)
    expect(snapshot.source).toBe('deepseek-http')
    expect(formatMoney(snapshot.balances[0]!.total, 2)).toBe('110.00')
    expect(formatMoney(snapshot.balances[0]!.granted, 2)).toBe('10.00')
    expect(formatMoney(snapshot.balances[0]!.toppedUp, 2)).toBe('100.00')
  })

  it('保留原始响应供审计', () => {
    expect(normalize(good, 'tag', 1).raw).toBe(good)
  })

  it('接受空币种列表', () => {
    expect(normalize({ is_available: false, balance_infos: [] }, 'tag', 1).balances).toEqual([])
  })

  it('结构不符抛 ShapeError', () => {
    expect(() => normalize(null, 't', 1)).toThrow(ShapeError)
    expect(() => normalize([], 't', 1)).toThrow(ShapeError)
    expect(() => normalize({ balance_infos: [] }, 't', 1)).toThrow(ShapeError)
    expect(() => normalize({ is_available: 'yes', balance_infos: [] }, 't', 1)).toThrow(ShapeError)
    expect(() => normalize({ is_available: true }, 't', 1)).toThrow(ShapeError)
    expect(() => normalize({ is_available: true, balance_infos: [null] }, 't', 1)).toThrow(ShapeError)
    expect(() => normalize({ is_available: true, balance_infos: [{ currency: '' }] }, 't', 1)).toThrow(ShapeError)
  })

  it('金额坏掉抛 ParseError 并指出字段', () => {
    const bad = { is_available: true, balance_infos: [{ ...good.balance_infos[0], total_balance: 'abc' }] }
    expect(() => normalize(bad, 't', 1)).toThrow(ParseError)
    expect(() => normalize(bad, 't', 1)).toThrow(/total_balance/)
  })

  it('金额缺失抛 ShapeError 而不是归零', () => {
    const missing = { is_available: true, balance_infos: [{ currency: 'CNY' }] }
    expect(() => normalize(missing, 't', 1)).toThrow(ShapeError)
  })
})

describe('nextSnapshotId', () => {
  it('同一时刻单调递增', () => {
    const first = nextSnapshotId(1000)
    const second = nextSnapshotId(1000)
    expect(second > first).toBe(true)
  })

  it('跨时刻按字典序可比', () => {
    const earlier = nextSnapshotId(1000)
    const later = nextSnapshotId(2000)
    expect(later > earlier).toBe(true)
  })
})

describe('parseErrorBody', () => {
  it('嵌套 error.type', () => {
    expect(parseErrorBody('{"error":{"type":"invalid_request_error","message":"bad key"}}'))
      .toEqual({ code: 'invalid_request_error', message: 'bad key' })
  })

  it('嵌套 error.code', () => {
    expect(parseErrorBody('{"error":{"code":"401","message":"nope"}}')).toEqual({ code: '401', message: 'nope' })
  })

  it('detail 形状', () => {
    expect(parseErrorBody('{"detail":"missing header"}')).toEqual({ message: 'missing header' })
  })

  it('message 形状', () => {
    expect(parseErrorBody('{"message":"oops"}')).toEqual({ message: 'oops' })
  })

  it('非 JSON 退回截断原文', () => {
    expect(parseErrorBody('gateway timeout')).toEqual({ message: 'gateway timeout' })
  })

  it('空正文返回空对象', () => {
    expect(parseErrorBody('   ')).toEqual({})
  })

  it('未知结构兜底成 JSON 文本', () => {
    const parsed = parseErrorBody('{"weird":1}')
    expect(parsed.message).toBe('{"weird":1}')
  })
})

import { describe, expect, it } from 'vitest'
import {
  MONEY_SCALE,
  addMoney,
  cmpMoney,
  formatMoney,
  isZeroMoney,
  parseMoney,
  subMoney,
} from '../src/domain/money.ts'
import { ParseError } from '../src/domain/errors.ts'

describe('parseMoney', () => {
  it('解析整数与小数', () => {
    expect(parseMoney('0')).toBe(0n)
    expect(parseMoney('1')).toBe(MONEY_SCALE)
    expect(parseMoney('110.00000000')).toBe(110n * MONEY_SCALE)
    expect(parseMoney('0.00000001')).toBe(1n)
  })

  it('接受负号', () => {
    expect(parseMoney('-0.5')).toBe(-50_000_000n)
  })

  it('补零到 8 位', () => {
    expect(parseMoney('1.5')).toBe(150_000_000n)
    expect(parseMoney('1.000000001')).toBe(100_000_000n)
  })

  it('超过 8 位小数截断而不是四舍五入', () => {
    expect(parseMoney('0.999999999')).toBe(99_999_999n)
  })

  it('拒绝科学计数法与空串', () => {
    for (const bad of ['1e3', '', '  ', 'abc', '1.2.3', '1,000', '+1', '.5', '1.']) {
      expect(() => parseMoney(bad), bad).toThrow(ParseError)
    }
  })

  it('数字入参按十进制文本处理', () => {
    expect(parseMoney(110)).toBe(110n * MONEY_SCALE)
  })
})

describe('formatMoney', () => {
  it('默认 8 位小数', () => {
    expect(formatMoney(parseMoney('110'))).toBe('110.00000000')
  })

  it('UI 用 2 位', () => {
    expect(formatMoney(parseMoney('110.005'), 2)).toBe('110.00')
    expect(formatMoney(parseMoney('110.999'), 2)).toBe('110.99')
  })

  it('0 位只留整数部分', () => {
    expect(formatMoney(parseMoney('110.9'), 0)).toBe('110')
  })

  it('保留负号且不丢整数部分', () => {
    expect(formatMoney(parseMoney('-0.5'), 2)).toBe('-0.50')
    expect(formatMoney(parseMoney('-110.25'), 2)).toBe('-110.25')
  })

  it('小数越界抛 RangeError', () => {
    expect(() => formatMoney(0n, 9)).toThrow(RangeError)
    expect(() => formatMoney(0n, -1)).toThrow(RangeError)
    expect(() => formatMoney(0n, 1.5)).toThrow(RangeError)
  })
})

describe('往返一致', () => {
  it('解析后再格式化回到原值', () => {
    for (const text of ['0.00000000', '1.00000000', '110.12345678', '-3.50000000']) {
      expect(formatMoney(parseMoney(text))).toBe(text)
    }
  })
})

describe('算术', () => {
  it('加减与比较', () => {
    const a = parseMoney('110.00')
    const b = parseMoney('10.00')
    expect(formatMoney(addMoney(a, b), 2)).toBe('120.00')
    expect(formatMoney(subMoney(a, b), 2)).toBe('100.00')
    expect(cmpMoney(a, b)).toBe(1)
    expect(cmpMoney(b, a)).toBe(-1)
    expect(cmpMoney(a, a)).toBe(0)
    expect(isZeroMoney(subMoney(a, a))).toBe(true)
  })
})

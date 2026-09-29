import { describe, expect, it } from 'vitest'
import { projectAccountBalance, toPlainDecimal } from '../src/domain/account.ts'
import { ParseError } from '../src/domain/errors.ts'

describe('toPlainDecimal', () => {
  it('定点字符串原样放过', () => {
    expect(toPlainDecimal('110.00000000')).toBe('110.00000000')
    expect(toPlainDecimal('0')).toBe('0')
  })

  it('展开正指数', () => {
    expect(toPlainDecimal('1e+3')).toBe('1000')
    expect(toPlainDecimal('12.5E1')).toBe('125')
  })

  it('展开负指数', () => {
    expect(toPlainDecimal('0E-16')).toBe('0.0000000000000000')
    expect(toPlainDecimal('-1.2e-3')).toBe('-0.0012')
  })

  it('省掉整数位的写法补 0', () => {
    expect(toPlainDecimal('.5')).toBe('0.5')
    expect(toPlainDecimal('-.5')).toBe('-0.5')
  })

  it('认不出来的形状原样返回，让下游的 parseMoney 去报错', () => {
    expect(toPlainDecimal('abc')).toBe('abc')
  })
})

describe('projectAccountBalance', () => {
  it('总余额 = 充值 + 赠送，两个分项各自照给', () => {
    const raw = projectAccountBalance({
      wallets: [{ currency: 'CNY', balance: '100.00000000' }],
      bonusWallets: [{ currency: 'CNY', balance: '10.00000000' }],
    })
    expect(raw.is_available).toBe(true)
    expect(raw.balance_infos).toEqual([
      {
        currency: 'CNY',
        total_balance: '110.00000000',
        granted_balance: '10.00000000',
        topped_up_balance: '100.00000000',
      },
    ])
  })

  it('只有赠送钱包的账户也照出', () => {
    const raw = projectAccountBalance({
      wallets: [],
      bonusWallets: [{ currency: 'CNY', balance: '5.00000000' }],
    })
    expect(raw.balance_infos[0]?.total_balance).toBe('5.00000000')
    expect(raw.balance_infos[0]?.topped_up_balance).toBe('0.00000000')
  })

  it('多币种各出一条，顺序按首次出现', () => {
    const raw = projectAccountBalance({
      wallets: [
        { currency: 'CNY', balance: '1' },
        { currency: 'USD', balance: '2' },
      ],
      bonusWallets: [{ currency: 'USD', balance: '0.5' }],
    })
    expect(raw.balance_infos.map((row) => row.currency)).toEqual(['CNY', 'USD'])
    expect(raw.balance_infos[1]?.total_balance).toBe('2.50000000')
  })

  it('科学计数法先展开再相加', () => {
    const raw = projectAccountBalance({
      wallets: [{ currency: 'CNY', balance: '1e+2' }],
      bonusWallets: [{ currency: 'CNY', balance: '1E-2' }],
    })
    expect(raw.balance_infos[0]?.total_balance).toBe('100.01000000')
  })

  it('金额坏掉抛 ParseError，不静默归零', () => {
    expect(() =>
      projectAccountBalance({
        wallets: [{ currency: 'CNY', balance: 'not-a-number' }],
        bonusWallets: [],
      }),
    ).toThrow(ParseError)
  })
})

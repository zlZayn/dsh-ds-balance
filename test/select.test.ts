import { describe, expect, it } from 'vitest'
import { AUTO_CURRENCY, pickBalance, stableOrder } from '../src/domain/select.ts'
import { parseMoney } from '../src/domain/money.ts'
import type { BalanceInfo } from '../src/domain/balance.ts'

function info(currency: string, total: string): BalanceInfo {
  return { currency, total: parseMoney(total), granted: 0n, toppedUp: parseMoney(total) }
}

describe('stableOrder', () => {
  it('CNY 提前且不打乱其余相对顺序', () => {
    const input = [info('USD', '1'), info('EUR', '1'), info('CNY', '1')]
    expect(stableOrder(input).map((item) => item.currency)).toEqual(['CNY', 'USD', 'EUR'])
  })

  it('不改动入参', () => {
    const input = [info('USD', '1'), info('CNY', '1')]
    stableOrder(input)
    expect(input.map((item) => item.currency)).toEqual(['USD', 'CNY'])
  })
})

describe('pickBalance', () => {
  it('空数组返回 null', () => {
    expect(pickBalance([])).toBeNull()
    expect(pickBalance([], 'USD')).toBeNull()
  })

  it('偏好币种命中且余额大于零', () => {
    const picked = pickBalance([info('CNY', '10'), info('USD', '20')], 'USD')
    expect(picked?.currency).toBe('USD')
  })

  it('偏好币种余额为零时不采用', () => {
    const picked = pickBalance([info('CNY', '10'), info('USD', '0')], 'USD')
    expect(picked?.currency).toBe('CNY')
  })

  it('偏好币种不存在时走默认链', () => {
    const picked = pickBalance([info('USD', '20'), info('CNY', '0')], 'EUR')
    expect(picked?.currency).toBe('USD')
  })

  it('CNY 优先，其次任一非零', () => {
    expect(pickBalance([info('USD', '20'), info('CNY', '10')])?.currency).toBe('CNY')
    expect(pickBalance([info('EUR', '5'), info('USD', '20')])?.currency).toBe('EUR')
  })

  it('全为零时仍返回 CNY', () => {
    expect(pickBalance([info('USD', '0'), info('CNY', '0')])?.currency).toBe('CNY')
  })

  it('auto 与空串等价于不指定', () => {
    const list = [info('USD', '20'), info('CNY', '10')]
    expect(pickBalance(list, AUTO_CURRENCY)?.currency).toBe('CNY')
    expect(pickBalance(list, '')?.currency).toBe('CNY')
    expect(pickBalance(list, '  ')?.currency).toBe('CNY')
  })

  it('偏好匹配不区分大小写', () => {
    expect(pickBalance([info('USD', '20')], 'usd')?.currency).toBe('USD')
  })

  it('数组顺序跳变不改变结果', () => {
    const forward = [info('CNY', '10'), info('USD', '20'), info('EUR', '30')]
    const reversed = [...forward].reverse()
    expect(pickBalance(forward)?.currency).toBe(pickBalance(reversed)?.currency)
    expect(pickBalance(forward, 'USD')?.currency).toBe(pickBalance(reversed, 'USD')?.currency)
  })
})

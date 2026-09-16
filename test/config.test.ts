import { describe, expect, it } from 'vitest'
import { DEFAULT_TIMEOUT_MS, TIMEOUT_ENV, resolveTimeoutMs } from '../src/config.ts'

describe('resolveTimeoutMs', () => {
  it('没有环境变量时用常量', () => {
    expect(resolveTimeoutMs({})).toBe(DEFAULT_TIMEOUT_MS)
    expect(DEFAULT_TIMEOUT_MS).toBe(8000)
  })

  it('环境变量覆盖', () => {
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '15000' })).toBe(15000)
  })

  it('越界回落常量', () => {
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '999' })).toBe(DEFAULT_TIMEOUT_MS)
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '60001' })).toBe(DEFAULT_TIMEOUT_MS)
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '0' })).toBe(DEFAULT_TIMEOUT_MS)
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '-1' })).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('不可解析回落常量', () => {
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: 'abc' })).toBe(DEFAULT_TIMEOUT_MS)
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '' })).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('小数截断成整数', () => {
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '1234.9' })).toBe(1234)
  })

  it('边界值可用', () => {
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '1000' })).toBe(1000)
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '60000' })).toBe(60000)
  })
})

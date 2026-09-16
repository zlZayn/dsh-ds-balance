import { describe, expect, it } from 'vitest'
import { ACCOUNT_TAG_LENGTH, accountTag8, computeAccountTag } from '../src/services/account-tag.ts'

describe('computeAccountTag', () => {
  it('是 32 位十六进制', () => {
    const tag = computeAccountTag('salt', 'sk-abc')
    expect(tag).toHaveLength(ACCOUNT_TAG_LENGTH)
    expect(tag).toMatch(/^[0-9a-f]{32}$/)
  })

  it('同输入同输出', () => {
    expect(computeAccountTag('salt', 'sk-abc')).toBe(computeAccountTag('salt', 'sk-abc'))
  })

  it('换盐换密钥都会变', () => {
    expect(computeAccountTag('salt', 'sk-abc')).not.toBe(computeAccountTag('salt2', 'sk-abc'))
    expect(computeAccountTag('salt', 'sk-abc')).not.toBe(computeAccountTag('salt', 'sk-abd'))
  })

  it('不含明文密钥', () => {
    expect(computeAccountTag('salt', 'sk-abcdef')).not.toContain('sk-')
  })
})

describe('accountTag8', () => {
  it('取前 8 位', () => {
    expect(accountTag8(computeAccountTag('salt', 'sk-abc'))).toHaveLength(8)
  })
})

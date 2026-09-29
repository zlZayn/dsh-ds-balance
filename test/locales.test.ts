import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

/** 两份词典的键集必须逐字相同：缺一个键只会在那种语言下露出另一种语言，界面上不报错。 */
describe('词典', () => {
  it('中英键集逐字相同', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('没有空串词条', () => {
    for (const [key, value] of [...Object.entries(zh), ...Object.entries(en)]) {
      expect(value.trim(), key).not.toBe('')
    }
  })
})

/**
 * 来源标签的括号**属于词典**：中文全角、英文半角带前置空格。
 *
 * 这条守的是一条容易写错的规矩 —— 在代码里拼 `(` 会让其中一种语言立刻不对劲，
 * 而那种不对劲只有真机看得见。
 */
describe('来源标签', () => {
  const keys = ['popover.source.key', 'popover.source.account'] as const

  it('中文用全角括号', () => {
    for (const key of keys) {
      expect(zh[key].startsWith('（'), key).toBe(true)
      expect(zh[key].endsWith('）'), key).toBe(true)
    }
  })

  it('英文用半角括号，且前置一个空格', () => {
    for (const key of keys) {
      expect(en[key].startsWith(' ('), key).toBe(true)
      expect(en[key].endsWith(')'), key).toBe(true)
    }
  })

  it('两份不共用同一个字符串（否则一定有一边是错的）', () => {
    for (const key of keys) expect(zh[key]).not.toBe(en[key])
  })
})

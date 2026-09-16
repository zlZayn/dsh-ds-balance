import { describe, expect, it } from 'vitest'
import { CONFIG_FIELDS, Config } from '../src/config.ts'

/**
 * schemastery 的 object 节点把属性挂在 dict 上；拿不到就说明内部形状变了，
 * 那时宁可让断言炸掉，也不要让它空转成「两个空数组相等」。
 */
function schemaKeys(): string[] {
  const dict = (Config as unknown as { dict?: Record<string, unknown> }).dict
  return Object.keys(dict ?? {})
}

describe('CONFIG_FIELDS', () => {
  it('与 schema 的实际键集完全一致', () => {
    const keys = schemaKeys()
    expect(keys.length).toBeGreaterThan(0)
    expect([...CONFIG_FIELDS].sort()).toEqual([...keys].sort())
  })

  it('字段数就是契约里的 11 个', () => {
    expect(CONFIG_FIELDS).toHaveLength(11)
  })

  it('不含 timeoutMs：它是常量加环境变量覆盖，不进 schema', () => {
    expect([...CONFIG_FIELDS] as string[]).not.toContain('timeoutMs')
  })
})

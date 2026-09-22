import { describe, expect, it } from 'vitest'
import { CONFIG_FIELDS, Config, THRESHOLD_PAIRS } from '../src/config.ts'

/** schemastery 的 object 节点把属性挂在 dict 上；拿不到就说明内部形状变了。 */
function schemaDict(): Record<string, unknown> {
  const dict = (Config as unknown as { dict?: Record<string, unknown> }).dict
  return dict ?? {}
}

/**
 * schema 的属性名。拿不到就说明内部形状变了，那时宁可让断言炸掉，
 * 也不要让它空转成「两个空数组相等」。
 */
function schemaKeys(): string[] {
  return Object.keys(schemaDict())
}

/** 一个字段节点上的 volatile 标记。schemastery 把它放在 `meta.volatile`。 */
function isVolatile(field: string): boolean {
  const node = schemaDict()[field] as { meta?: { volatile?: unknown } } | undefined
  return node?.meta?.volatile === true
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

/**
 * 本轮最要紧的一条断言（勘察报告的 R1）。
 *
 * 漏加 `.volatile()` 的症状是**静默的**：宿主的 `volatileForm()` 在没有 volatile
 * 字段时返回 `undefined`，那一行整条退出 `describe()` —— 行上还有 Configure 控件，
 * 点进去却拿不到 `form`，什么都不显示、也不报错。前端测试看不见它，
 * 只有对着 schema 数一遍才拦得住。
 */
describe('volatile 面', () => {
  it('11 个字段一个不漏，全部带 volatile', () => {
    const missing = [...CONFIG_FIELDS].filter(field => !isVolatile(field))
    expect(missing, `这些字段没加 .volatile()：${missing.join(', ')}`).toEqual([])
  })

  it('字段数与 CONFIG_FIELDS 一致（防漏改一处）', () => {
    expect(schemaKeys()).toHaveLength(CONFIG_FIELDS.length)
  })
})

describe('阈值对的默认值', () => {
  it('THRESHOLD_PAIRS 里抄的默认值与 schema 的实际默认值一致', () => {
    // 消费侧守卫（resolveThresholdPairs）要在违规时回落成「默认值」，那个值就抄在这张表里；
    // 抄错了会把用户静默带到一个他没见过的工作点。
    // Config({}) 给的是引用面（全字段 volatile），所以先逐字段 .get() 解出来。
    const refs = (Config as unknown as (input: unknown) => Record<string, { get(): unknown }>)({})
    const defaults = Object.fromEntries(Object.entries(refs).map(([key, ref]) => [key, ref.get()])) as Record<string, number>
    for (const pair of THRESHOLD_PAIRS) {
      expect(defaults[pair.warn], pair.currency + ' 的预警默认值').toBe(pair.defaultWarn)
      expect(defaults[pair.critical], pair.currency + ' 的告急默认值').toBe(pair.defaultCritical)
    }
  })
})

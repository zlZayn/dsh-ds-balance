import { describe, expect, it } from 'vitest'
import { Config, THRESHOLD_PAIRS as HOST_PAIRS, validateThresholds, type Config as ConfigShape } from '../src/config.ts'
import {
  THRESHOLD_PAIRS, orderPairWrites, thresholdsOk, type FieldState,
} from '../src/client/settings/use-config-form.ts'

/**
 * 阈值成对校验：宿主与浏览器两个半体各存一份表，这里同时盯住两边。
 *
 * 两边不许值导入（见 src/AGENTS.md），所以「默认值被抄成两份」是这块的固有风险 ——
 * 本文件就是那份抄写的对账表。
 */

/** 造一个字段状态；只覆写关心的字段。 */
function state(patch: Partial<FieldState> = {}): FieldState {
  return {
    text: '', value: undefined, effective: undefined, stored: false, overridden: false, dirty: false, invalid: false,
    ...patch,
  }
}

/** 造一条待写入的编辑。 */
function setWrite(field: string, value: unknown) {
  return { field, write: { kind: 'set' as const, value } }
}

/** 读一条写入里的数值。 */
function valueOf(item: { write?: { kind: string; value?: unknown } }): number {
  return item.write?.kind === 'set' ? Number(item.write.value) : Number.NaN
}

const base = (): ConfigShape => Config({}) as ConfigShape

describe('阈值成对：默认值', () => {
  it('两个半体抄的是同一份默认值', () => {
    const resolved = base()
    for (const pair of THRESHOLD_PAIRS) {
      const host = HOST_PAIRS.find(item => item.currency === pair.currency)
      expect(host, pair.currency + ' 在宿主表里缺席').toBeTruthy()
      if (host === undefined) continue
      expect(resolved[host.warn], pair.currency + ' 的预警默认值').toBe(pair.defaultWarn)
      expect(resolved[host.critical], pair.currency + ' 的告急默认值').toBe(pair.defaultCritical)
    }
  })

  it('默认值本身合法：warn 严格大于 critical', () => {
    for (const pair of THRESHOLD_PAIRS) {
      expect(pair.defaultWarn > pair.defaultCritical, pair.currency).toBe(true)
    }
    expect(() => { validateThresholds(base()) }).not.toThrow()
  })
})

describe('宿主跨字段校验', () => {
  it('严格大于才通过', () => {
    expect(() => { validateThresholds({ ...base(), cnyWarn: 10, cnyCritical: 5 }) }).not.toThrow()
    // 相等也拒绝：压线时余额会被同时判成 warn 与 critical，「预警」这一档就不存在了。
    expect(() => { validateThresholds({ ...base(), cnyWarn: 5, cnyCritical: 5 }) }).toThrow()
    expect(() => { validateThresholds({ ...base(), cnyWarn: 4, cnyCritical: 5 }) }).toThrow()
  })

  it('告急可以是 0，预警不行', () => {
    expect(() => { validateThresholds({ ...base(), cnyWarn: 1, cnyCritical: 0 }) }).not.toThrow()
    expect(() => { validateThresholds({ ...base(), cnyWarn: 0, cnyCritical: 0 }) }).toThrow()
  })

  it('错误信息指向具体币种', () => {
    expect(() => { validateThresholds({ ...base(), cnyWarn: 1, cnyCritical: 1 }) }).toThrow(/CNY/)
    expect(() => { validateThresholds({ ...base(), usdWarn: 1, usdCritical: 1 }) }).toThrow(/USD/)
  })

  it('两个币种互不连坐', () => {
    expect(() => { validateThresholds({ ...base(), cnyWarn: 1, cnyCritical: 1, usdWarn: 9, usdCritical: 1 }) })
      .toThrow(/CNY/)
    expect(() => { validateThresholds({ ...base(), cnyWarn: 9, cnyCritical: 1, usdWarn: 1, usdCritical: 1 }) })
      .toThrow(/USD/)
  })
})

describe('前端成对校验', () => {
  const cny = THRESHOLD_PAIRS[0]

  it('严格大于才通过', () => {
    expect(thresholdsOk(cny, state({ text: '20' }), state({ text: '15' }))).toBe(true)
    expect(thresholdsOk(cny, state({ text: '20' }), state({ text: '20' }))).toBe(false)
    expect(thresholdsOk(cny, state({ text: '15' }), state({ text: '20' }))).toBe(false)
  })

  it('告急可以是 0，预警不行', () => {
    expect(thresholdsOk(cny, state({ text: '1' }), state({ text: '0' }))).toBe(true)
    expect(thresholdsOk(cny, state({ text: '0' }), state({ text: '0' }))).toBe(false)
  })

  it('边界：差一点点也算通过', () => {
    expect(thresholdsOk(cny, state({ text: '5.01' }), state({ text: '5' }))).toBe(true)
    expect(thresholdsOk(cny, state({ text: '5' }), state({ text: '5.01' }))).toBe(false)
  })

  it('空草稿按默认值算，不是按旧值算', () => {
    // CNY 默认 10 / 5：空着的预警配 5 仍然合法，配 10 就不合法。
    expect(thresholdsOk(cny, state({ text: '' }), state({ text: '5' }))).toBe(true)
    expect(thresholdsOk(cny, state({ text: '' }), state({ text: '10' }))).toBe(false)
  })

  it('草稿不是数字时交给字段自己的 parse，不在这里重复报', () => {
    expect(thresholdsOk(cny, state({ text: 'abc' }), state({ text: '5' }))).toBe(true)
    expect(thresholdsOk(cny, state({ text: '5' }), state({ text: 'abc' }))).toBe(true)
  })
})

describe('成对写入的排序', () => {
  const cny = THRESHOLD_PAIRS[0]

  it('先写预警会让中间态非法时，交换成先写告急', () => {
    // 现状 (20, 15)，目标 (10, 5)：先写 warn 会得到 (10, 15)，宿主会拒绝整次写入。
    const ordered = orderPairWrites(
      [setWrite(cny.warn, 10), setWrite(cny.critical, 5)],
      { [cny.warn]: 20, [cny.critical]: 15 },
    )
    expect(ordered.map(item => item.field)).toEqual([cny.critical, cny.warn])
  })

  it('先写预警已经合法时保持原顺序', () => {
    // 现状 (10, 5)，目标 (20, 15)：先写 warn 会得到 (20, 5)，合法。
    const ordered = orderPairWrites(
      [setWrite(cny.warn, 20), setWrite(cny.critical, 15)],
      { [cny.warn]: 10, [cny.critical]: 5 },
    )
    expect(ordered.map(item => item.field)).toEqual([cny.warn, cny.critical])
  })

  it('只写一半时不动顺序', () => {
    const ordered = orderPairWrites([setWrite(cny.warn, 20)], { [cny.warn]: 10, [cny.critical]: 5 })
    expect(ordered.map(item => item.field)).toEqual([cny.warn])
  })

  it('两个币种各排各的', () => {
    const usd = THRESHOLD_PAIRS[1]
    const ordered = orderPairWrites(
      [setWrite(cny.warn, 10), setWrite(cny.critical, 5), setWrite(usd.warn, 0.5), setWrite(usd.critical, 0.2)],
      { [cny.warn]: 20, [cny.critical]: 15, [usd.warn]: 2, [usd.critical]: 1 },
    )
    expect(ordered.map(item => item.field)).toEqual([cny.critical, cny.warn, usd.critical, usd.warn])
  })

  it('排序之后每一步合并都合法（穷举小取值域）', () => {
    const valid = (w: number, c: number): boolean => w > c
    let checked = 0
    for (const W of [3, 8, 12, 30]) {
      for (const C of [0, 2, 7, 11]) {
        if (!valid(W, C)) continue
        for (const w of [1, 5, 9, 25]) {
          for (const c of [0, 1, 6, 10]) {
            if (!valid(w, c)) continue
            const merged: Record<string, number> = { [cny.warn]: W, [cny.critical]: C }
            for (const item of orderPairWrites(
              [setWrite(cny.warn, w), setWrite(cny.critical, c)],
              merged,
            )) {
              merged[item.field] = valueOf(item)
              expect(valid(merged[cny.warn], merged[cny.critical]),
                `中间态非法：warn=${merged[cny.warn]} critical=${merged[cny.critical]}`).toBe(true)
              checked += 1
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(200)
  })
})

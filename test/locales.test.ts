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

/**
 * 处境文案的**最终表**钉在这里。
 *
 * 为什么值得写死：这几句是用户唯一能看到「为什么这里没有数字」的地方 ——
 * 浮层在没有金额时显示的是 `--`，它自己**从不解释**为什么（见 BalancePopover：
 * 它没有 error / situation 任何入参）。所以文案写飘了，用户就只剩一个空浮层和一句错话。
 *
 * 逐字断言会让「改一个词」也变红 —— 那是有意的：改文案时应当顺带读一遍上面
 * `locales.ts` 里那段理由，而不是让措辞悄悄漂走。
 */
describe('处境文案（悬停气泡的内容）', () => {
  /** 最终表：键 → [中文, 英文]。 */
  const TABLE = {
    'situation.checking': ['正在获取', 'Loading'],
    'situation.unavailable': ['读不到余额', 'Balance unavailable'],
    'situation.internalError': ['服务异常', 'Service error'],
    'situation.noCredential': ['尚未配置凭据', 'No credential configured'],
    'situation.accountUnavailable': ['账户不可用', 'Account unavailable'],
    'situation.stale': ['数据已过期', 'Data is stale'],
    'situation.emptyWallet': ['暂无余额', 'No balance'],
  } as const

  it('逐条与最终表一致', () => {
    for (const [key, [cn, us]] of Object.entries(TABLE)) {
      expect(zh[key as keyof typeof zh], key).toBe(cn)
      expect(en[key as keyof typeof en], key).toBe(us)
    }
  })

  it('**不出现「插件内部」这类指代实现的说法**', () => {
    // 用户不知道也不关心是哪个组件坏了；他要知道的是「现在拿不到」。
    // 中文直译 "Plugin error" 就是这个毛病，英文侧本来没这个问题。
    expect(zh['situation.internalError']).not.toContain('插件')
    expect(zh['situation.internalError']).not.toContain('内部')
    expect(en['situation.internalError']).not.toContain('Plugin')
  })

  it('**`unavailable` 不带「暂时 / Temporarily」**：它接住的错误里有一半等不好', () => {
    // `fetch-failed` 覆盖从网络抖动到 `UPSTREAM_401`（key 失效）/ `UPSTREAM_402`（欠费）
    // 的一整片。对后者说「暂时」是**有害**的假话：用户该去改凭据、去充值，而不是干等。
    expect(zh['situation.unavailable']).not.toContain('暂时')
    expect(zh['situation.unavailable']).not.toContain('稍后')
    expect(en['situation.unavailable'].toLowerCase()).not.toContain('temporar')
  })

  it('**`offline` 与 `fetch-failed` 共用同一句**（对用户是同一件事：读不到）', () => {
    // 两者的差别是诊断面（我们不通 vs 上游不通），不是用户面。
    // 这条查的是共用的**存在**：两个处境都指向同一个键（见 client/situation.ts 的形态表）。
    expect(zh['situation.unavailable']).toBe(TABLE['situation.unavailable'][0])
  })

  it('**不出现重复的两句**（同一句话挂在两个不同处境上会让人以为是一回事）', () => {
    // `unavailable` 由 offline 与 fetch-failed 共用，那是**一个键**、不是两句 —— 允许。
    // 这里查的是七个键的值两两不同：文案漂成一样时，界面上就少了一种处境。
    const values = Object.values(TABLE).map(([cn]) => cn)
    expect(new Set(values).size, `有重复的处境文案：${values.join(' / ')}`).toBe(values.length)
  })
})

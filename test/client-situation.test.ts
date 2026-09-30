import { describe, expect, it } from 'vitest'
import { SITUATIONS, familyOf, presentationOf } from '../src/client/situation.ts'
import { ringRatioOf } from '../src/client/model.ts'
import { SITUATIONS as HOST_SITUATIONS } from '../src/domain/situation.ts'
import { zh } from '../src/client/locales.ts'

/**
 * 处境 → 形态表的守卫。
 *
 * 这张表是「一个处境一个形态」的唯一实现，所以它值得比普通映射更严的断言：
 * 完备性（漏一个编译期就红，这里再钉一次）、合并意图（谁和谁同族是**有意的**，
 * 将来被静默拆开/合并要红）、以及「没数字就不标来源」这条语义。
 */
describe('处境形态表', () => {
  it('客户端闭集与宿主闭集逐字相同（两个半体不共享值，只能对账）', () => {
    expect([...SITUATIONS].sort()).toEqual([...HOST_SITUATIONS].sort())
  })

  it('每个处境都有形态；gauge 族之外的颜色不吃 severity', () => {
    for (const situation of SITUATIONS) {
      const presentation = presentationOf(situation, 'ok')
      expect(presentation.family, situation).toBeTruthy()
      // 非 gauge 族：换一个 severity 也不该改变它的形态（颜色/符号/弧都由处境定死）。
      const other = presentationOf(situation, 'critical')
      if (presentation.family !== 'gauge') {
        expect(other, `${situation} 不是 gauge 族，形态不该随 severity 变`).toEqual(presentation)
      }
    }
  })

  it('按 severity 上色的只有四个「看数字」的处境；**`account-unavailable` 不吃 severity**', () => {
    // 颜色来自 severity 的处境的**白名单**：这几个才是「余额高低」的编码。
    const severityColoured = SITUATIONS.filter((s) => {
      const asWarn = presentationOf(s, 'warn').ring
      const asOk = presentationOf(s, 'ok').ring
      return asWarn !== asOk
    })
    expect(severityColoured.sort()).toEqual(['critical', 'low', 'ok', 'stale'])

    // `account-unavailable` 定死红环：停用这个事实本身就决定红，与余额多少无关；
    // 而上游对欠费账户可能给空的余额列表（severity 会是 unknown → 灰环），
    // 那会把「停用」画成「没信息」—— 所以它是结构保证，不依赖另一处的判定顺序。
    for (const severity of ['ok', 'warn', 'critical', 'unavailable', 'unknown'] as const) {
      expect(presentationOf('account-unavailable', severity).ring, severity).toBe('error')
    }

    // 非 gauge 族：颜色与弧都由处境定死。
    for (const situation of SITUATIONS) {
      if (presentationOf(situation, 'ok').family === 'gauge') continue
      expect(presentationOf(situation, 'warn').arc, `${situation} 不是 gauge 族，不该画弧`).toBe(
        'none',
      )
    }
  })

  it('**两个 gauge 成员有意不画弧**：`account-unavailable` 与「余额恰好为 0」', () => {
    // `account-unavailable`：余额不是「多少」而是「没有」，按比例画会出一条长红弧，
    // 读起来像「红=很多」，方向正好反了。形状是「红环 + 无叉」，与「红环 + 叉」仍分得开。
    const gaugeWithoutArc = SITUATIONS.filter(
      (s) => familyOf(s) === 'gauge' && presentationOf(s, 'ok').arc === 'none',
    )
    expect(gaugeWithoutArc).toEqual(['account-unavailable'])
    // 其余 gauge 族都要画弧（有数字就有刻度）。
    const gaugeWithArc = SITUATIONS.filter(
      (s) => familyOf(s) === 'gauge' && presentationOf(s, 'ok').arc === 'gauge',
    )
    expect(gaugeWithArc.sort()).toEqual(['critical', 'low', 'ok', 'stale'])
    // 而「余额刚好为 0」是**同形**的：`ringRatioOf` 对它也返回 0（不画弧）。
    // 这两条不是 bug，是刻意的 —— 静止态都是「红环无叉」，靠浮层文案区分。
    expect(ringRatioOf('0.00000000', 5, 'critical')).toBe(0)
  })

  it('**只有 no-credential 用 ＋**、**只有两种「读不到」用叉**（形状通道不许乱用）', () => {
    const withPlus = SITUATIONS.filter((s) => presentationOf(s, 'ok').marker === 'plus')
    expect(withPlus).toEqual(['no-credential'])
    const withCross = SITUATIONS.filter((s) => presentationOf(s, 'ok').marker === 'cross')
    // 三个「我们试过了、没读到」的处境：端点不通 / 抓取失败 / 我们坏了。
    expect(withCross.sort()).toEqual(['fetch-failed', 'internal-error', 'offline'])
  })

  it('**只有「有数字」那一族可能标来源**（判据是 `shown !== null`，不是表里的开关）', () => {
    // 来源标签的闸门在组件里：`shown === null ? null : sourceLabelKeyOf(...)`。
    // 所以这里钉的是它的**前置条件** —— 哪些处境**可能**有数字。
    // 曾经表里有一个 `showSource` 开关，但它按**处境**给，
    // 而 `account-unavailable`（账户停用）上游可能给空的余额列表，那时并没有数字，
    // 按表标就会在一份空浮层里写「（API Key）」。改成由 `shown` 判之后，
    // 这个开关就成了纯粹的错误来源 —— 已删除，闸门只有一个。
    for (const situation of SITUATIONS) {
      const possible = familyOf(situation) === 'gauge'
      // 可能标来源 ⟺ 这一族可能有数字。其余三族按定义没有数字（宿主不会给 selected）。
      expect(possible, `${situation} 的来源标签可能性`).toBe(
        ['ok', 'low', 'critical', 'stale', 'account-unavailable'].includes(situation),
      )
    }
  })

  it('`account-unavailable` 与「有数字」解耦：有数字时标来源、没数字时不标', () => {
    // 同一处境下两种形状都存在，所以它**不能**用一个静态开关表达 —— 这正是删掉 showSource 的理由。
    const p = presentationOf('account-unavailable', 'unavailable')
    expect(p.family).toBe('gauge')
    // 它不吃 severity（颜色定死红），所以「有没有数字」只体现在组件那侧的 shown 上。
    expect(p.ring).toBe('error')
  })

  it('**合并意图写死在这里**：同族关系是有意的，改了要红', () => {
    // 收起态只有 4 个族，且这四个分组各自都有理由（见 situation.ts 的注释）。
    const families: Record<string, string[]> = {}
    for (const situation of SITUATIONS) {
      const family = familyOf(situation)
      families[family] = [...(families[family] ?? []), situation].sort()
    }
    expect(families).toEqual({
      gauge: ['account-unavailable', 'critical', 'low', 'ok', 'stale'],
      unreadable: ['fetch-failed', 'internal-error', 'offline'],
      'needs-credential': ['no-credential'],
      'no-reading': ['checking', 'empty-wallet'],
    })
  })

  it('文案：正常态没有文案；「读不到」三兄弟里，我们坏了要单独说', () => {
    const normal = SITUATIONS.filter((s) => presentationOf(s, 'ok').textKey === null)
    expect(normal.sort()).toEqual(['critical', 'low', 'ok'])
    const keys = SITUATIONS.map((s) => presentationOf(s, 'ok').textKey).filter(
      (k): k is NonNullable<typeof k> => k !== null,
    )
    for (const key of keys) {
      expect(zh[key], `词典里缺 ${key}`).toBeTruthy()
    }
    // 「读不到」是同一族（视觉一样），但文案**两分**：
    // 端点不通与上游读不到共用「服务暂不可用」——对用户是同一件事（等）；
    // 我们自己抛错时说「插件内部错误」——那是「我们坏了」，不该让上游背。
    // 这正是「枚举细、视觉粗」的落点：区别只在文案与日志，不在形状。
    const unreadable = SITUATIONS.filter((s) => familyOf(s) === 'unreadable')
    expect(unreadable.sort()).toEqual(['fetch-failed', 'internal-error', 'offline'])
    expect(presentationOf('internal-error', 'ok').textKey).toBe('situation.internalError')
    for (const situation of ['offline', 'fetch-failed'] as const) {
      expect(presentationOf(situation, 'ok').textKey, situation).toBe('situation.unavailable')
    }
  })

  it('专属文案不许被别的处境借用（改错了要红）', () => {
    // 每个非 null 文案键的**拥有者**写死在这里：共用的必须显式列出。
    const owners: Record<string, string[]> = {}
    for (const situation of SITUATIONS) {
      const key = presentationOf(situation, 'ok').textKey
      if (key === null) continue
      owners[key] = [...(owners[key] ?? []), situation].sort()
    }
    expect(owners).toEqual({
      'situation.checking': ['checking'],
      'situation.unavailable': ['fetch-failed', 'offline'],
      'situation.internalError': ['internal-error'],
      'situation.noCredential': ['no-credential'],
      'situation.accountUnavailable': ['account-unavailable'],
      'situation.stale': ['stale'],
      'situation.emptyWallet': ['empty-wallet'],
    })
  })
})

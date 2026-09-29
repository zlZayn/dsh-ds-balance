import { describe, expect, it } from 'vitest'
import { SITUATIONS, familyOf, presentationOf } from '../src/client/situation.ts'
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

  it('gauge 族：只有它按 severity 上色；**弧是另一件事，可以不给**', () => {
    for (const situation of SITUATIONS) {
      const presentation = presentationOf(situation, 'warn')
      if (presentation.family === 'gauge') {
        expect(presentation.ring, `${situation} 是 gauge 族，颜色应来自 severity`).toBe('warning')
      } else {
        // 非 gauge 族：颜色与弧都由处境定死。
        expect(presentation.arc, `${situation} 不是 gauge 族，不该画弧`).toBe('none')
      }
    }
    // **有意不给弧的那一个**：账户被停用时余额不是「多少」而是「没有」，
    // 按比例画会画出一条很长的红弧，读起来像「红=很多」，方向正好反了。
    // 它的形状是「红环 + 无叉」，与「红环 + 叉」（读不到）仍分得开。
    const gaugeWithoutArc = SITUATIONS.filter(
      (s) => familyOf(s) === 'gauge' && presentationOf(s, 'ok').arc === 'none',
    )
    expect(gaugeWithoutArc).toEqual(['account-unavailable'])
    // 其余 gauge 族都要画弧（有数字就有刻度）。
    const gaugeWithArc = SITUATIONS.filter(
      (s) => familyOf(s) === 'gauge' && presentationOf(s, 'ok').arc === 'gauge',
    )
    expect(gaugeWithArc.sort()).toEqual(['critical', 'low', 'ok', 'stale'])
  })

  it('**只有 no-credential 用 ＋**、**只有两种「读不到」用叉**（形状通道不许乱用）', () => {
    const withPlus = SITUATIONS.filter((s) => presentationOf(s, 'ok').marker === 'plus')
    expect(withPlus).toEqual(['no-credential'])
    const withCross = SITUATIONS.filter((s) => presentationOf(s, 'ok').marker === 'cross')
    // 三个「我们试过了、没读到」的处境：端点不通 / 抓取失败 / 我们坏了。
    expect(withCross.sort()).toEqual(['fetch-failed', 'internal-error', 'offline'])
  })

  it('没数字就不标来源（括号只说「这份数字从哪来」）', () => {
    for (const situation of SITUATIONS) {
      const presentation = presentationOf(situation, 'ok')
      if (!presentation.showSource) continue
      // 标来源的处境必须都是「真的有数字」的那些。
      expect(presentation.family, `${situation} 标了来源却不是 gauge 族`).toBe('gauge')
    }
    // 反向：所有 gauge 族都该标（有数字就有来路）。
    for (const situation of SITUATIONS) {
      if (familyOf(situation) === 'gauge') {
        expect(presentationOf(situation, 'ok').showSource, situation).toBe(true)
      }
    }
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

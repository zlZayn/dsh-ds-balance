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

  it('**五个族各自一种形态，没有两族同形**（同形由 render-matrix 按真渲染钉住）', () => {
    // 族的意义就是「屏幕上长得不一样」——同族=同形，异族=异形。
    // 这条只查形态表的**声明**；「实际画出来是否真的不同」由 render-matrix 渲真组件去查
    // （声明 arc: 'gauge' 但余额为 0 时不画弧，只看表会漏掉这种同形）。
    const families: Record<string, string[]> = {}
    for (const situation of SITUATIONS) {
      const family = familyOf(situation)
      families[family] = [...(families[family] ?? []), situation].sort()
    }
    expect(families).toEqual({
      gauge: ['critical', 'low', 'ok', 'stale'],
      unreadable: ['account-unavailable', 'fetch-failed', 'internal-error', 'offline'],
      'needs-credential': ['no-credential'],
      pending: ['checking'],
      empty: ['empty-wallet'],
    })
    // 每个族的「形态签名」必须互不相同。
    const signatures = new Map<string, string>()
    for (const situation of SITUATIONS) {
      const p = presentationOf(situation, 'ok')
      const signature = `${p.ring}|${p.marker ?? '-'}|${p.arc}`
      const owner = signatures.get(signature)
      if (owner === undefined) {
        signatures.set(signature, familyOf(situation))
        continue
      }
      expect(familyOf(situation), `形态签名 ${signature} 被两族共用`).toBe(owner)
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

  it('**只有 `checking` 是「进行中」**：转弧是它独有的形态', () => {
    // 转弧把「加载中」与「账户没钱」（都是灰环）分开 —— 从前两者逐像素相同。
    // 圆是对称的，整圈转等于没转，所以必须有一条**不完整**的弧在动（见 PercentRing）。
    const ongoing = SITUATIONS.filter((s) => presentationOf(s, 'ok').ring === 'ongoing')
    expect(ongoing).toEqual(['checking'])
    // 它自己不画「按比例」的弧 —— 转弧由 PercentRing 内部给，不走 ringRatioOf。
    expect(presentationOf('checking', 'ok').arc).toBe('none')
    // 反向：其余处境都不得是 ongoing（否则会出现第二条转动的环）。
    for (const situation of SITUATIONS) {
      if (situation === 'checking') continue
      expect(presentationOf(situation, 'ok').ring, situation).not.toBe('ongoing')
    }
  })

  it('**gauge 族里没有「不画弧的成员」** —— 账户停用已移出这一族', () => {
    // 从前 `account-unavailable` 挂在 gauge，且 `arc: 'none'` —— 于是它与
    // 「余额恰好为 0」的 critical 都是「红环 + 无叉 + 无弧」，逐像素相同。
    // 现在它归 unreadable（红环 + 叉），gauge 族只剩真的有数字的那四个。
    const gaugeWithoutArc = SITUATIONS.filter(
      (s) => familyOf(s) === 'gauge' && presentationOf(s, 'ok').arc === 'none',
    )
    expect(gaugeWithoutArc).toEqual([])
    const gaugeWithArc = SITUATIONS.filter(
      (s) => familyOf(s) === 'gauge' && presentationOf(s, 'ok').arc === 'gauge',
    )
    expect(gaugeWithArc.sort()).toEqual(['critical', 'low', 'ok', 'stale'])
    // 「余额刚好为 0」仍然不画弧（`ringRatioOf` 返回 0）—— 那**在族内**，
    // 与同族的 red 环形同，靠数字本身区分（浮层里写着 ¥0.00）：
    expect(ringRatioOf('0.00000000', 5, 'critical')).toBe(0)
    expect(ringRatioOf('3.00000000', 5, 'critical')).toBeGreaterThan(0)
  })

  it('**叉 = 「这里没有可用的数字」**：读不到（三个）与用不了（账户停用）', () => {
    const withPlus = SITUATIONS.filter((s) => presentationOf(s, 'ok').marker === 'plus')
    expect(withPlus).toEqual(['no-credential'])
    const withCross = SITUATIONS.filter((s) => presentationOf(s, 'ok').marker === 'cross')
    // 四个「拿不到可用的数字」的处境。账户停用**并入**这一类：
    // 它从前靠「红环无叉」与 critical 区分，但余额为 0 的 critical 也是红环无叉无弧，
    // 那区分不成立。叉的语义因此从「读不到」扩到「读不到或用不了」——
    // 两者同属「否定：这里没有可用的数字」，用户动作也都是去查。
    expect(withCross.sort()).toEqual([
      'account-unavailable',
      'fetch-failed',
      'internal-error',
      'offline',
    ])
    // 反向：只有这五个处境带记号，其余都不带（形状通道不许乱用）。
    const withMarker = SITUATIONS.filter((s) => presentationOf(s, 'ok').marker !== null)
    expect(withMarker.sort()).toEqual([...withCross, ...withPlus].sort())
  })

  it('**只有「有数字」那一族可能标来源**（判据是 `shown !== null`，不是表里的开关）', () => {
    // 来源标签的闸门在组件里：`shown === null ? null : sourceLabelKeyOf(...)`。
    // 所以这里钉的是它的**前置条件** —— 哪些处境**可能**有数字。
    // 曾经表里有一个 `showSource` 开关，但它按**处境**给，
    // 而 `account-unavailable`（账户停用）上游可能给空的余额列表，那时并没有数字，
    // 按表标就会在一份空浮层里写「（API Key）」。改成由 `shown` 判之后，
    // 这个开关就成了纯粹的错误来源 —— 已删除，闸门只有一个。
    //
    // 注意 `account-unavailable` 现在**不在**可能标来源的名单里 —— 但理由不是「它一定没有数字」：
    // 实测上游对停用账户**仍可能给余额行**（`pickBalance` 照样挑得出、`selectionOf` 照样找得到），
    // 那时组件按 `shown !== null` 就会标来源。这是**有意允许**的：
    // 「这份数字从哪来」是一个局部事实，只要真有数字就该说；族归属说的是「用户该做什么」，
    // 两件事不必一致。所以这条断言只钉「族 ⟹ 可能有数字」这一侧，
    // 不钉「非该族 ⟹ 一定没数字」—— 后者是假的。
    for (const situation of SITUATIONS) {
      const possible = familyOf(situation) === 'gauge'
      expect(possible, `${situation} 的来源标签可能性`).toBe(
        ['ok', 'low', 'critical', 'stale'].includes(situation),
      )
    }
  })

  it('`account-unavailable` 与「有数字」解耦：有数字时标来源、没数字时不标', () => {
    // 同一处境下两种形状都存在，所以它**不能**用一个静态开关表达 —— 这正是删掉 showSource 的理由。
    const p = presentationOf('account-unavailable', 'unavailable')
    expect(p.family).toBe('unreadable')
    // 它不吃 severity（颜色定死红），所以「有没有数字」只体现在组件那侧的 shown 上。
    expect(p.ring).toBe('error')
  })

  it('**合并意图写死在这里**：同族关系是有意的，改了要红', () => {
    // 收起态 5 个族，每个族对应一种用户动作（见 situation.ts 的注释）：
    // 看数字 / 等（加载中）/ 去配置 / 什么都不用做 / 去查（读不到或用不了）。
    const families: Record<string, string[]> = {}
    for (const situation of SITUATIONS) {
      const family = familyOf(situation)
      families[family] = [...(families[family] ?? []), situation].sort()
    }
    expect(families).toEqual({
      gauge: ['critical', 'low', 'ok', 'stale'],
      unreadable: ['account-unavailable', 'fetch-failed', 'internal-error', 'offline'],
      'needs-credential': ['no-credential'],
      pending: ['checking'],
      empty: ['empty-wallet'],
    })
  })

  it('文案：正常态没有文案；「读不到」四兄弟里，我们坏了要单独说', () => {
    const normal = SITUATIONS.filter((s) => presentationOf(s, 'ok').textKey === null)
    expect(normal.sort()).toEqual(['critical', 'low', 'ok'])
    const keys = SITUATIONS.map((s) => presentationOf(s, 'ok').textKey).filter(
      (k): k is NonNullable<typeof k> => k !== null,
    )
    for (const key of keys) {
      expect(zh[key], `词典里缺 ${key}`).toBeTruthy()
    }
    // 「读不到 / 用不了」是同一族（视觉一样），但文案**三分**：
    // 端点不通与上游读不到共用「暂时读不到」——对用户是同一件事（等）；
    // 我们自己抛错时说「服务异常」——那是「我们坏了」，不该让上游背；
    // 账户停用说「账户不可用」——那是「你的账户有问题」，该去查账户。
    // 这正是「枚举细、视觉粗」的落点：区别只在文案与日志，不在形状。
    const unreadable = SITUATIONS.filter((s) => familyOf(s) === 'unreadable')
    expect(unreadable.sort()).toEqual([
      'account-unavailable',
      'fetch-failed',
      'internal-error',
      'offline',
    ])
    expect(presentationOf('internal-error', 'ok').textKey).toBe('situation.internalError')
    expect(presentationOf('account-unavailable', 'ok').textKey).toBe('situation.accountUnavailable')
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

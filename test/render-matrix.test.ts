import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { severityOf, thresholdsOf } from '../src/domain/severity.ts'
import { situationOf } from '../src/domain/situation.ts'
import { presentationOf, familyOf, type Situation } from '../src/client/situation.ts'
import { ringRatioOf } from '../src/client/model.ts'
import { PercentRing } from '../src/client/sidebar/PercentRing.tsx'
import { parseMoney } from '../src/domain/money.ts'
import type { BalanceInfo, Severity } from '../src/domain/balance.ts'

/**
 * **端到端形态矩阵**：把宿主真实可能发出的每一组事实跑完整条链
 * （`severityOf` → `situationOf` → `presentationOf` → `ringRatioOf`），
 * 逐行钉住「屏幕上实际画出来什么」。
 *
 * 为什么值得单独一组（而不是散在各文件的单测里）：它守的是**组合**，
 * 而这一轮的真实缺陷恰好全在组合上 ——
 * - 「账户停用 + 空余额列表」让 `severity` 落到 `unknown`，界面把**停用画成灰环**；
 * - 「stale + 快照里没有可展示币种」让界面说「数据已过期」，而用户手里一个数字都没有；
 * - 来源标签的开关按**处境**给，但同一处境下「有没有数字」还会变。
 * 三个都不是某一条判据写错，而是**两条判据的交互**错了 —— 只有把整条链跑一遍才看得见。
 *
 * 判据刻意用「实际画出来什么」而不是「表里声明了什么」：
 * `presentation.arc === 'gauge'` 只说明「这一族有刻度」，
 * 真正画不画弧还要看 `ringRatioOf` 的返回值（余额为 0 就不画）。
 */

const TH = thresholdsOf({ cnyWarn: 10, cnyCritical: 5, usdWarn: 2, usdCritical: 1 })

const row = (total: string): BalanceInfo => ({
  currency: 'CNY',
  total: parseMoney(total),
  granted: 0n,
  toppedUp: parseMoney(total),
})

/** 一条现实场景。 */
interface Scenario {
  readonly note: string
  readonly hasSnapshot: boolean
  readonly stale: boolean
  readonly isAvailable: boolean
  /** `null` = 没有任何可展示的币种（balances 为空，或挑不出）。 */
  readonly selected: BalanceInfo | null
  readonly errorCode: string | null
  /** warn 阈值；`undefined` = 没配（弧长退回定性值）。 */
  readonly warn?: number | undefined
}

/** 跑完整条链，给出这一组事实在界面上实际画出来什么。 */
function render(s: Scenario): {
  situation: Situation
  severity: Severity
  ring: string
  marker: string | null
  arcRatio: number
  textKey: string | null
} {
  // 宿主：severity 的完整链（`balance-source` 的无快照兜底 + `severityOf`）。
  const severity: Severity = s.hasSnapshot
    ? severityOf(s.selected, s.isAvailable, TH.CNY)
    : s.errorCode === 'NO_KEY'
      ? 'unknown'
      : 'unavailable'
  const situation = situationOf({
    hasSnapshot: s.hasSnapshot,
    stale: s.stale,
    isAvailable: s.isAvailable,
    hasSelected: s.selected !== null,
    severity,
    errorCode: s.errorCode as never,
  })
  const p = presentationOf(situation, severity)
  // 客户端：弧长只在 `arc === 'gauge'` 时算（组件逐字复算）。
  const warn = 'warn' in s ? s.warn : 10
  const arcRatio =
    p.arc === 'gauge'
      ? ringRatioOf(s.selected === null ? null : String(s.selected.total), warn, severity)
      : 0
  return { situation, severity, ring: p.ring, marker: p.marker, arcRatio, textKey: p.textKey }
}

/** 全部现实场景（覆盖 11 个处境）。 */
const SCENARIOS: readonly Scenario[] = [
  // —— 客户端本地事实 ——
  // checking / offline 不经宿主判定，另有一组断言（见下）。
  // —— 无快照 ——
  {
    note: '没接入（无凭据）',
    hasSnapshot: false,
    stale: false,
    isAvailable: false,
    selected: null,
    errorCode: 'NO_KEY',
  },
  {
    note: '接入了但网络不通',
    hasSnapshot: false,
    stale: false,
    isAvailable: false,
    selected: null,
    errorCode: 'NO_NETWORK',
  },
  {
    note: '接入了但上游 5xx',
    hasSnapshot: false,
    stale: false,
    isAvailable: false,
    selected: null,
    errorCode: 'UPSTREAM_5XX',
  },
  {
    note: '接入了但解析失败',
    hasSnapshot: false,
    stale: false,
    isAvailable: false,
    selected: null,
    errorCode: 'PARSE_ERROR',
  },
  // —— 有快照、账户停用 ——
  {
    note: '停用 + 余额行(0)',
    hasSnapshot: true,
    stale: false,
    isAvailable: false,
    selected: row('0'),
    errorCode: null,
  },
  {
    note: '停用 + 余额行(50)',
    hasSnapshot: true,
    stale: false,
    isAvailable: false,
    selected: row('50'),
    errorCode: null,
  },
  {
    note: '**停用 + 空余额列表**',
    hasSnapshot: true,
    stale: false,
    isAvailable: false,
    selected: null,
    errorCode: null,
  },
  // —— 有快照、本轮失败（stale） ——
  {
    note: 'stale + 旧余额充足',
    hasSnapshot: true,
    stale: true,
    isAvailable: true,
    selected: row('100'),
    errorCode: 'NO_NETWORK',
  },
  {
    note: 'stale + 旧余额偏低',
    hasSnapshot: true,
    stale: true,
    isAvailable: true,
    selected: row('8'),
    errorCode: 'NO_NETWORK',
  },
  {
    note: 'stale + 旧余额告急',
    hasSnapshot: true,
    stale: true,
    isAvailable: true,
    selected: row('3'),
    errorCode: 'NO_NETWORK',
  },
  {
    note: 'stale + 旧余额为 0',
    hasSnapshot: true,
    stale: true,
    isAvailable: true,
    selected: row('0'),
    errorCode: 'NO_NETWORK',
  },
  {
    note: '**stale + 无可展示币种**',
    hasSnapshot: true,
    stale: true,
    isAvailable: true,
    selected: null,
    errorCode: 'NO_NETWORK',
  },
  // —— 有快照、正常 ——
  {
    note: '账户可用但一个币种都没有',
    hasSnapshot: true,
    stale: false,
    isAvailable: true,
    selected: null,
    errorCode: null,
  },
  {
    note: '正常 + 充足',
    hasSnapshot: true,
    stale: false,
    isAvailable: true,
    selected: row('100'),
    errorCode: null,
  },
  {
    note: '正常 + 偏低',
    hasSnapshot: true,
    stale: false,
    isAvailable: true,
    selected: row('8'),
    errorCode: null,
  },
  {
    note: '正常 + 告急',
    hasSnapshot: true,
    stale: false,
    isAvailable: true,
    selected: row('3'),
    errorCode: null,
  },
  {
    note: '正常 + 余额恰好为 0',
    hasSnapshot: true,
    stale: false,
    isAvailable: true,
    selected: row('0'),
    errorCode: null,
  },
  // —— 阈值没配（弧长退回定性值） ——
  {
    note: '正常 + 充足（没配阈值）',
    hasSnapshot: true,
    stale: false,
    isAvailable: true,
    selected: row('100'),
    errorCode: null,
    warn: undefined,
  },
  {
    note: '正常 + 偏低（没配阈值）',
    hasSnapshot: true,
    stale: false,
    isAvailable: true,
    selected: row('8'),
    errorCode: null,
    warn: undefined,
  },
  {
    note: '正常 + 告急（没配阈值）',
    hasSnapshot: true,
    stale: false,
    isAvailable: true,
    selected: row('3'),
    errorCode: null,
    warn: undefined,
  },
]

describe('端到端形态矩阵', () => {
  it('覆盖处境闭集里**由事实判出来的**全部 8 个（另三个各有归属）', () => {
    const covered = new Set(SCENARIOS.map((s) => render(s).situation))
    // `situationOf` 判得出的处境（= 宿主 `SITUATIONS_FROM_FACTS`）。逐个场景跑真函数，不照抄常量。
    const fromFacts = [
      'no-credential',
      'fetch-failed',
      'account-unavailable',
      'stale',
      'empty-wallet',
      'ok',
      'low',
      'critical',
    ]
    for (const situation of fromFacts) {
      expect(covered, `处境 ${situation} 没有场景覆盖`).toContain(situation)
    }
    // 剩下三个不该由事实判定产生，各有各的生产方：
    // - `internal-error`：HTTP 兜底视图直接给（handler 自己抛错时走不到 situationOf）；
    // - `checking` / `offline`：客户端本地事实（宿主不可能知道），由 data.ts 的占位视图给。
    for (const situation of ['internal-error', 'checking', 'offline']) {
      expect(covered, `${situation} 不该由事实判定产生`).not.toContain(situation)
    }
  })

  it('**客户端那两个本地处境**也在这张矩阵里（它们不经宿主判定）', () => {
    // `checking`（首帧还没问到）与 `offline`（插件自己的端点不通）——
    // 宿主不可能知道这两件事，由 `data.ts` 的占位视图直接给。
    for (const [situation, expected] of [
      // `checking` 的形态是 `ongoing`（转弧）而不是 idle —— 见「加载中与账户没钱不再同形」。
      ['checking', { ring: 'ongoing', marker: null, arc: 'none' }],
      ['offline', { ring: 'error', marker: 'cross', arc: 'none' }],
    ] as const) {
      const p = presentationOf(situation, 'unknown')
      expect({ ring: p.ring, marker: p.marker, arc: p.arc }, situation).toEqual(expected)
      // 两者都没有数字，所以都不标来源（闸门在组件里判 `shown`）。
      expect(p.textKey, situation).toBe(
        situation === 'checking' ? 'situation.checking' : 'situation.unavailable',
      )
    }
  })

  it('**「账户停用」在任何一种事实组合下都是红环 + 叉**（含上游给空余额列表那条）', () => {
    // 两道防线：判定顺序（`isAvailable` 先判，否则停用+空余额表会落到 unknown → 灰环）
    // + 形态表把这一族的颜色定死。
    for (const scenario of SCENARIOS.filter((s) => !s.isAvailable && s.hasSnapshot)) {
      const r = render(scenario)
      expect(r.situation, scenario.note).toBe('account-unavailable')
      expect(r.ring, scenario.note).toBe('error')
      // 叉是它与「余额恰好为 0」分开的唯一通道（两者其余通道逐值相同）。
      expect(r.marker, scenario.note).toBe('cross')
    }
  })

  it('**`stale` 只出现在「真的有一份旧数字」时**', () => {
    // 「快照在、里面没有可展示币种、这轮又没读到」不能说「数据已过期」——
    // 用户手里一个数字都没有，那句话听着像「有旧数据可看」。归 fetch-failed。
    const staleScenarios = SCENARIOS.filter((s) => render(s).situation === 'stale')
    expect(staleScenarios.length).toBeGreaterThan(0)
    for (const scenario of staleScenarios) {
      expect(scenario.selected, `${scenario.note} 说 stale 却没有数字`).not.toBeNull()
    }
    const noNumberStale = SCENARIOS.find((s) => s.note.includes('stale + 无可展示币种'))!
    expect(render(noNumberStale).situation).toBe('fetch-failed')
  })

  it('**有数字那一族的颜色永远不是灰**（灰 = 没信息，不能用来表示余额高低）', () => {
    // 结构性防线：只要处境落在「有数字」这一族，颜色必须是绿/琥珀/红。
    // 灰只允许出现在「读不到」「待配置」「加载中」「账户没钱」四族。
    for (const scenario of SCENARIOS) {
      const r = render(scenario)
      const hasNumber =
        scenario.selected !== null && ['ok', 'low', 'critical', 'stale'].includes(r.situation)
      if (!hasNumber) continue
      expect(['done', 'warning', 'error'], `${scenario.note}（${r.situation}）`).toContain(r.ring)
      expect(r.ring, `${scenario.note} 有数字却是灰环`).not.toBe('idle')
    }
  })

  it('**形状通道三分**：叉 = 拿不到可用的数字、＋ = 待配置、gauge 族无记号', () => {
    for (const scenario of SCENARIOS) {
      const r = render(scenario)
      const expected =
        r.situation === 'no-credential'
          ? 'plus'
          : r.situation === 'account-unavailable' ||
              r.situation === 'fetch-failed' ||
              r.situation === 'offline' ||
              r.situation === 'internal-error'
            ? 'cross'
            : null
      expect(r.marker, `${scenario.note}（${r.situation}）的记号`).toBe(expected)
    }
    // 客户端那两个：offline 用叉（我们也读不到），checking 不用（它还在取，不是失败）。
    expect(presentationOf('offline', 'unknown').marker).toBe('cross')
    expect(presentationOf('checking', 'unknown').marker).toBeNull()
    // 待配置只由 no-credential 产生。
    expect(presentationOf('no-credential', 'unknown').marker).toBe('plus')
  })

  it('弧长只由「有数字」那一族且余额为正时画出来', () => {
    for (const scenario of SCENARIOS) {
      const r = render(scenario)
      if (r.arcRatio <= 0) continue
      // 画得出弧 ⇒ 一定有数字，且处境在有数字那一族。
      expect(scenario.selected, `${scenario.note} 没有数字却画了弧`).not.toBeNull()
      expect(['ok', 'low', 'critical', 'stale'], `${scenario.note}`).toContain(r.situation)
    }
  })

  it('**两枚红环不再同形**：「余额恰好为 0」与「账户停用」靠叉分开', () => {
    // 这两条曾经是**逐像素相同**的（红环 + 无叉 + 无弧）。曾经把它写成「有意接受的同形」，
    // 但那个接受是错的：两者要用户做的事不同（余额为 0 是「账户空了」，
    // 停用是「去查账户」），而环上没有任何东西能区分它们。
    const zero = render({
      note: '正常 + 余额恰好为 0',
      hasSnapshot: true,
      stale: false,
      isAvailable: true,
      selected: row('0'),
      errorCode: null,
    })
    const suspended = render({
      note: '停用 + 空余额列表',
      hasSnapshot: true,
      stale: false,
      isAvailable: false,
      selected: null,
      errorCode: null,
    })
    expect(zero.ring).toBe(suspended.ring) // 都是 red —— 这一点没变，也不该变
    expect(zero.arcRatio).toBe(suspended.arcRatio) // 都不画弧
    // **分开它们的就是这个通道**：停用带叉，余额为 0 不带。
    expect(zero.marker).toBeNull()
    expect(suspended.marker).toBe('cross')
    expect(zero.textKey).not.toBe(suspended.textKey)
  })
})

/**
 * **渲真组件**：上面那些断言读的是形态表，而表里写的是 `arc: 'gauge'`（有没有刻度），
 * 真正画不画弧还由 `ringRatioOf` 的返回值决定（余额为 0 就不画）。
 * 只看表会漏掉「声明不同、画出来一样」的同形 —— 本轮两处歧义都是这样躲过审计的。
 *
 * 所以这一组把**真组件的 SVG** 渲出来，按**看得见的通道**（色 / 弧 / 记号 / 是否转动）
 * 做指纹，要求：**不同族 ⟹ 不同形**。
 */
describe('真渲染：不同族必须不同形（同形就是歧义）', () => {
  /** 从真 SVG 里抽「看得见的通道」。 */
  function visibleChannels(html: string): string {
    const state = /data-state="([a-z]+)"/.exec(html)?.[1] ?? '?'
    const dash = /stroke-dasharray="([\d.]+) /.exec(html)
    // 记号朝向按**坐标**判：叉与＋都是 2 条 <line>，按条数会把它们判成同形。
    // 正交（＋）每条线都过圆心（x1=x2 或 y1=y2）；斜交（叉）都不过。
    const lines = [
      ...html.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g),
    ]
    let marker = '-'
    if (lines.length > 0) {
      marker = lines.every((m) => m[1] === m[3] || m[2] === m[4]) ? 'plus' : 'cross'
    }
    // 转动是 checking 独有的通道：它靠一个带 class 的 <g> 承载。
    const spinning = /<g class="[^"]*spin[^"]*"/.test(html) ? 'spin' : '-'
    return `state=${state} arc=${dash?.[1] ?? 'none'} marker=${marker} anim=${spinning}`
  }

  /** 渲一个处境的真 SVG（用它现实中最典型的那组输入）。 */
  function svgOf(situation: Situation, severity: Severity, total: string | null): string {
    const p = presentationOf(situation, severity)
    const ratio = p.arc === 'gauge' ? ringRatioOf(total, 10, severity) : 0
    return renderToStaticMarkup(
      createElement(PercentRing, { state: p.ring, marker: p.marker, ratio, size: 18 }),
    )
  }

  /** 每个处境的典型输入（与 SCENARIOS 同源，但这里要的是「渲出来」）。 */
  const TYPICAL: ReadonlyArray<[Situation, Severity, string | null]> = [
    ['checking', 'unknown', null],
    ['empty-wallet', 'unknown', null],
    ['no-credential', 'unknown', null],
    ['offline', 'unavailable', null],
    ['fetch-failed', 'unavailable', null],
    ['internal-error', 'unknown', null],
    ['account-unavailable', 'unavailable', null],
    ['stale', 'ok', '100.00000000'],
    ['ok', 'ok', '100.00000000'],
    ['low', 'warn', '8.00000000'],
    ['critical', 'critical', '3.00000000'],
  ]

  it('**11 个处境渲出来只有 2 组同形，且两组都是同族**（跨族同形才是歧义）', () => {
    const byFingerprint = new Map<string, Situation[]>()
    for (const [situation, severity, total] of TYPICAL) {
      const fingerprint = visibleChannels(svgOf(situation, severity, total))
      byFingerprint.set(fingerprint, [...(byFingerprint.get(fingerprint) ?? []), situation])
    }
    const collisions = [...byFingerprint.entries()]
      .filter(([, who]) => who.length > 1)
      .map(([fingerprint, who]) => ({ fingerprint, who: who.sort() }))
    // 两组同形，各有明确理由：
    // ① offline/fetch-failed/internal-error/account-unavailable：**同一族**，本来就该同形 ——
    //    用户动作都是「去查」，区别只在文案（诊断面）。
    // ② ok/stale：**同一族**，数字是真的、只是旧；新鲜度不改变形状，只在文案里说。
    // 判据落点是「同形 ⟹ 同族」：**跨族同形才是歧义**（用户要做的事不同，环上却分不出来）。
    for (const { fingerprint, who } of collisions) {
      const families = new Set(who.map((s) => familyOf(s)))
      expect(families.size, `跨族同形（歧义）：${fingerprint} → ${who.join(' / ')}`).toBe(1)
    }
    // 反向控制：这条断言必须真的看到过同形，否则「没有跨族同形」可能是空转的假绿。
    expect(collisions.length, '同形组数（应为 2）').toBe(2)
  })

  it('**三个通道各司其职**：族管形状、gauge 族的颜色与弧长管读数', () => {
    // 这条不变量我写错过两次，两次都红得对，值得把结论记下来：
    // ① 先是写成「同族一定同形」—— 错：`gauge` 族的**颜色**就是余额高低的编码（绿/琥珀/红）。
    // ② 改成「同族形状一致（抹掉颜色）」—— 还是错：`gauge` 族的**弧长**也是读数
    //    （占阈值的几分之几），族内本来就该长短不一。
    // 正确的分层是三个通道：
    // - **形状**（有没有弧 / 记号 / 是否转动）：同族必须一致 —— 这才是「长得一样」；
    // - **颜色**：gauge 族由 severity 定（族内可变），其余族由处境定死；
    // - **弧长**：只有 gauge 族有，且它就是读数（族内可变）。
    const shapeOf = (fingerprint: string): string =>
      // 抹掉颜色与弧的具体长度，只留「有没有弧」。
      fingerprint.replace(/state=\S+/, '').replace(/arc=[\d.]+/, 'arc=yes')
    const shapeByFamily = new Map<string, Set<string>>()
    const colourByFamily = new Map<string, Set<string>>()
    for (const [situation, severity, total] of TYPICAL) {
      const fingerprint = visibleChannels(svgOf(situation, severity, total))
      const family = familyOf(situation)
      shapeByFamily.set(
        family,
        (shapeByFamily.get(family) ?? new Set<string>()).add(shapeOf(fingerprint)),
      )
      colourByFamily.set(
        family,
        (colourByFamily.get(family) ?? new Set<string>()).add(
          /state=(\S+)/.exec(fingerprint)?.[1] ?? '?',
        ),
      )
    }
    for (const [family, shapes] of shapeByFamily) {
      expect(shapes.size, `族 ${family} 内部形状不一致（分族与视觉脱节）`).toBe(1)
    }
    expect(shapeByFamily.size, '被渲染覆盖的族数').toBe(5)
    // 颜色只有在 gauge 族里才允许可变 —— 其余族必须恒定，否则「颜色由处境定死」是假的。
    for (const [family, colours] of colourByFamily) {
      if (family === 'gauge') {
        expect(colours.size, 'gauge 族的颜色本来就该随 severity 变').toBeGreaterThan(1)
        continue
      }
      expect(colours.size, `族 ${family} 的颜色不该变`).toBe(1)
    }
  })

  it('**加载中与账户没钱不再同形**：前者有一条转动的弧，后者是空环', () => {
    // 这是本轮修掉的第一处歧义。两者都是灰环，从前逐像素相同 ——
    // 而用户要做的完全不同（等 vs 什么都不用做）。
    const checking = visibleChannels(svgOf('checking', 'unknown', null))
    const empty = visibleChannels(svgOf('empty-wallet', 'unknown', null))
    expect(checking).not.toBe(empty)
    expect(checking).toContain('anim=spin')
    expect(checking).toContain('arc=')
    expect(empty).toContain('arc=none')
    expect(empty).toContain('anim=-')
  })

  it('**转动的弧必须是「不完整的」**：整圈转等于没转（圆是对称的）', () => {
    // 这条守的是「为什么不能图省事让整条环转」。官方 StateDot 的 ongoing 也是
    // 一条 12/150 的短弧在转，理由相同。
    const html = svgOf('checking', 'unknown', null)
    const arc = Number(/stroke-dasharray="([\d.]+) /.exec(html)?.[1] ?? '0')
    const circumference = 2 * Math.PI * 6.5
    expect(arc, '转弧长度').toBeGreaterThan(0)
    expect(
      arc / circumference,
      '转弧占圆周的比例（必须明显小于 1，否则看不出来在转）',
    ).toBeLessThan(0.5)
  })
})

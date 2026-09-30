import { describe, expect, it } from 'vitest'
import { severityOf, thresholdsOf } from '../src/domain/severity.ts'
import { situationOf } from '../src/domain/situation.ts'
import { presentationOf, type Situation } from '../src/client/situation.ts'
import { ringRatioOf } from '../src/client/model.ts'
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
      ['checking', { ring: 'idle', marker: null, arc: 'none' }],
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

  it('**「账户停用」在任何一种事实组合下都是红环**（含上游给空余额列表那条）', () => {
    // 这一条是本轮真实缺陷：`severityOf` 从前先判 `selected === null`，
    // 于是「停用 + 空余额列表」返回 `unknown` → 灰环，与「账户本来没余额」同形。
    // 现在两道防线：判定顺序（isAvailable 先判）+ 形态表把这一族的颜色定死。
    for (const scenario of SCENARIOS.filter((s) => !s.isAvailable && s.hasSnapshot)) {
      const r = render(scenario)
      expect(r.situation, scenario.note).toBe('account-unavailable')
      expect(r.ring, scenario.note).toBe('error')
      expect(r.marker, scenario.note).toBeNull()
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
    // 灰只允许出现在「读不到」「待配置」「暂无读数」三族。
    for (const scenario of SCENARIOS) {
      const r = render(scenario)
      const hasNumber =
        scenario.selected !== null && ['ok', 'low', 'critical', 'stale'].includes(r.situation)
      if (!hasNumber) continue
      expect(['done', 'warning', 'error'], `${scenario.note}（${r.situation}）`).toContain(r.ring)
      expect(r.ring, `${scenario.note} 有数字却是灰环`).not.toBe('idle')
    }
  })

  it('**「读不到」有叉、「待配置」有＋、「看数字」没有记号**（形状通道三分）', () => {
    for (const scenario of SCENARIOS) {
      const r = render(scenario)
      if (r.situation === 'fetch-failed' || r.situation === 'no-credential') continue
      // 其余宿主处境都不该带中心记号（叉只给读不到，＋只给待配置）。
      expect(r.marker, `${scenario.note}（${r.situation}）不该有记号`).toBeNull()
    }
    // 客户端那两个：offline 用叉（我们也读不到），checking 不用。
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

  it('「余额恰好为 0」与「账户停用」静止态同形（红环无叉无弧）—— 有意接受，靠文案区分', () => {
    // 按**事实**取场景，不按 note 字符串匹配（后者带 markdown 标记，容易写飘）。
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
    // 三个视觉通道逐值相同 —— 这是**刻意的取舍**，不是漏改：
    // 红环已经用掉了唯一可用的「坏消息」色，而「余额为 0」与「账户停用」都要用户去看。
    expect(zero.ring).toBe(suspended.ring)
    expect(zero.marker).toBe(suspended.marker)
    expect(zero.arcRatio).toBe(suspended.arcRatio)
    // 区分它们的是文案与浮层金额，不是环 —— 所以文案键必须不同。
    expect(zero.textKey).not.toBe(suspended.textKey)
  })
})

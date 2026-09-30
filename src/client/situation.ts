/**
 * 处境 → 界面形态的唯一映射表。
 *
 * **为什么要有它**：环、文案、来源标签以前**各拼各的** —— 环只吃 `severity`，文案吃
 * `state + error.code + isAvailable + selection`，标签吃 `state + source`。三套输入集不同、
 * 优先级也不同，于是必然出现「环说 A、文案说 B」与「一个空环代表三种处境」。
 * 现在三者都从同一个处境派生，组件里不再有第二个分支入口。
 *
 * **分层是刻意的**（细节见 [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md)）：
 * - **处境**（内部，11 个取值）：诊断要细，日志与指标都用它；
 * - **视觉族**（收起态，4 个）：视觉要粗 —— 收起态只有一个圆环，塞不下 11 种区别；
 * - **通道值**（色 / 弧 / 符号）：组件只认这一层。
 *
 * **每一处合并都是有意的**（见 `FAMILY` 的注释），不是默认掉进去的。
 * @module dsh-ds-balance/client/situation
 */

import type { BalanceResponse, Severity } from './api-types.ts'
import type { LocaleKey } from './locales.ts'
import { dotStateOf, type DotState, type RingMarker } from './model.ts'

/**
 * 处境闭集 —— 与宿主 `domain/situation.ts` **逐字同形**。
 *
 * 两个半体不共享值，所以这里是自己抄的一份字面量，由 `test/situation.test.ts` 对账。
 */
export type Situation =
  | 'checking'
  | 'offline'
  | 'internal-error'
  | 'no-credential'
  | 'fetch-failed'
  | 'account-unavailable'
  | 'stale'
  | 'empty-wallet'
  | 'ok'
  | 'low'
  | 'critical'

/** 全部处境；测试用它断言形态表完备。 */
export const SITUATIONS = [
  'checking',
  'offline',
  'internal-error',
  'no-credential',
  'fetch-failed',
  'account-unavailable',
  'stale',
  'empty-wallet',
  'ok',
  'low',
  'critical',
] as const satisfies readonly Situation[]

/**
 * 收起态的视觉族。
 *
 * **收起态真正动态的只有圆环本身**（括号在浮层里，不在那一格），
 * 所以族的粒度就是「那一个圆环能表达几种用户处境」：
 * - `gauge`：有数字 —— 看数字（ok / low / critical / stale / 账户停用）；
 * - `unreadable`：我们试过了、没读到 —— 等（端点不通 / 抓取失败 / 内部错误）；
 * - `needs-credential`：没接入，需要**用户去配置**（唯一需要动手的一族）；
 * - `no-reading`：还没有数字，也没什么可做 —— 等（首帧 / 账户没有任何余额）。
 *
 * **`unreadable` 与 `no-reading` 不合并**：合并只能二选一 ——
 * 全红会让每次加载都闪一下叉（冤枉），全灰会让真失败看起来像「没事」。
 * 两者的颜色差就是「试过且失败」与「还没有答案」的分界，值得留。
 */
export type SituationFamily = 'gauge' | 'unreadable' | 'needs-credential' | 'no-reading'

/** 弧长来源：按余额比例画，还是不画。 */
export type ArcSource = 'gauge' | 'none'

/** 一个处境对应的界面形态。 */
export interface Presentation {
  /** 视觉族（收起态的粒度）。 */
  family: SituationFamily
  /** 环的颜色状态。 */
  ring: DotState
  /** 环的中心符号；`null` 表示不画。 */
  marker: RingMarker | null
  /** 弧长从哪来。 */
  arc: ArcSource
  /** 浮层 / 悬停的状态文案键；`null` 表示「一切正常，不必说」。 */
  textKey: LocaleKey | null
}

/**
 * 一个处境的完整形态。
 *
 * `ring` 对 `gauge` 族是**占位**（真正颜色由 `severity` 决定，见 {@link presentationOf}），
 * 其余族是定值。
 */
interface SituationShape extends Presentation {
  /** 这一族是否按 `severity` 上色（只有 gauge 族）。 */
  severityColoured: boolean
}

/**
 * 形态表。**漏一个处境编译不过** —— `Record<Situation, …>` 就是完备性检查。
 *
 * 合并意图逐条写在这里（改之前先读）：
 * - `checking` 与 `empty-wallet` 同族：用户动作相同（都无需动手），且 `checking` 只有一个往返；
 *   代价是端点挂住的那一小段看起来像「账户空」，靠悬停与浮层分辨。
 * - `offline` / `fetch-failed` / `internal-error` 同族：动作相同（等）；
 *   三者的差别是诊断面（谁坏了），不是用户面。`internal-error` 在**枚举里保持独立**
 *   （日志、指标、文案要区分「我们坏了」与「上游坏了」），只是视觉上并入。
 * - `stale` 归 `gauge`：数字是真的，只是旧；新鲜度不改变用户动作，年龄在浮层里说。
 * - `account-unavailable` 归 `gauge` 的红端：与「余额告急」同指向（查看 / 充值）。
 */
const SHAPES: Readonly<Record<Situation, SituationShape>> = {
  // —— 客户端本地事实（宿主不可能知道这两件事）——
  checking: {
    family: 'no-reading',
    ring: 'idle',
    marker: null,
    arc: 'none',
    textKey: 'situation.checking',
    severityColoured: false,
  },
  offline: {
    family: 'unreadable',
    ring: 'error',
    marker: 'cross',
    arc: 'none',
    textKey: 'situation.unavailable',
    severityColoured: false,
  },
  // —— 宿主判定 ——
  'internal-error': {
    family: 'unreadable',
    ring: 'error',
    marker: 'cross',
    arc: 'none',
    textKey: 'situation.internalError',
    severityColoured: false,
  },
  'no-credential': {
    family: 'needs-credential',
    ring: 'idle',
    marker: 'plus',
    arc: 'none',
    textKey: 'situation.noCredential',
    severityColoured: false,
  },
  'fetch-failed': {
    family: 'unreadable',
    ring: 'error',
    marker: 'cross',
    arc: 'none',
    textKey: 'situation.unavailable',
    severityColoured: false,
  },
  'account-unavailable': {
    family: 'gauge',
    // **颜色定死为红，不吃 severity。**
    // 它是「账户停用」—— 这个事实本身就决定了红，与余额多少无关；
    // 而上游对欠费账户可能给空的余额列表（selected=null → severity=unknown → 灰环），
    // 那会把「停用」画成「没信息」。定死红环是**结构保证**，不依赖另一处的判定顺序。
    ring: 'error',
    marker: null,
    arc: 'none',
    textKey: 'situation.accountUnavailable',
    severityColoured: false,
  },
  stale: {
    family: 'gauge',
    ring: 'done',
    marker: null,
    arc: 'gauge',
    textKey: 'situation.stale',
    severityColoured: true,
  },
  'empty-wallet': {
    family: 'no-reading',
    ring: 'idle',
    marker: null,
    arc: 'none',
    textKey: 'situation.emptyWallet',
    severityColoured: false,
  },
  ok: {
    family: 'gauge',
    ring: 'done',
    marker: null,
    arc: 'gauge',
    textKey: null,
    severityColoured: true,
  },
  low: {
    family: 'gauge',
    ring: 'warning',
    marker: null,
    arc: 'gauge',
    textKey: null,
    severityColoured: true,
  },
  critical: {
    family: 'gauge',
    ring: 'error',
    marker: null,
    arc: 'gauge',
    textKey: null,
    severityColoured: true,
  },
}

/**
 * 取一个处境的形态。
 *
 * `gauge` 族的环色**必须**由 `severity` 定（绿 / 琥珀 / 红就是余额高低的编码），
 * 所以这一族的颜色在这里现算 —— 这是全仓**唯一**读 `severity` 配色的地方。
 * @param situation - 处境。
 * @param severity - 后端给的严重度；只对 `gauge` 族有意义。
 * @returns 完整形态。
 */
export function presentationOf(situation: Situation, severity: Severity): Presentation {
  const shape = SHAPES[situation]
  if (!shape.severityColoured) return shape
  return { ...shape, ring: dotStateOf(severity) }
}

/** 一个处境的视觉族。 */
export function familyOf(situation: Situation): SituationFamily {
  return SHAPES[situation].family
}

/** 是不是处境闭集里的取值。 */
export function isSituation(value: unknown): value is Situation {
  return typeof value === 'string' && (SITUATIONS as readonly string[]).includes(value)
}

/**
 * 从**旧宿主**的响应推导处境。
 *
 * 客户端半边由 HMR 立刻换新，宿主半边要重启才换（见
 * [事故复盘](../../../docs/postmortem/2026-09-17-client-host-version-skew.md)）——
 * 所以「新客户端 + 旧宿主」是**合法的中间态**，那时响应里没有 `situation`，
 * 只能照旧字段推。这条路径是**兼容层**，新宿主上了就走不到。
 *
 * 判据尽量对齐宿主 `situationOf` 的优先级；推不出来的边角（例如 `internal-error`
 * 与 `account-unavailable` 在旧契约里没有各自的信号）退到最接近的那个处境。
 * @param response - 后端响应。
 * @returns 处境。
 */
export function legacySituationOf(response: BalanceResponse): Situation {
  const hasSnapshot = response.fetchedAt > 0 || response.selected !== null
  const code = response.error?.code
  if (!hasSnapshot) {
    if (code === 'NO_KEY') return 'no-credential'
    // 端点不可达是客户端本地合成的事实，旧响应里也只能从这两处看出来。
    if (code === 'PLUGIN_UNREACHABLE') return 'offline'
    return response.state === 'empty' && code === undefined ? 'checking' : 'fetch-failed'
  }
  if (!response.isAvailable) return 'account-unavailable'
  if (response.state === 'stale') return 'stale'
  if (response.selected === null) return 'empty-wallet'
  if (response.severity === 'critical') return 'critical'
  if (response.severity === 'warn') return 'low'
  if (response.severity === 'unavailable' || response.severity === 'unknown') return 'fetch-failed'
  return 'ok'
}

/**
 * 取一份响应的处境：新宿主给什么用什么，旧宿主现推。
 * @param response - 后端响应。
 * @returns 处境。
 */
export function situationOfResponse(response: BalanceResponse): Situation {
  return isSituation(response.situation) ? response.situation : legacySituationOf(response)
}

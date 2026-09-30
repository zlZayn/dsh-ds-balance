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
 * - **视觉族**（收起态，5 个）：视觉要粗 —— 收起态只有一个圆环，塞不下 11 种区别；
 * - **通道值**（色 / 弧 / 符号）：组件只认这一层。
 *
 * **每一处合并都是有意的**（见 `SHAPES` 的注释），不是默认掉进去的。
 * 反向也成立：**每一处拆分都是为了消掉一次同形** —— 同形的两组在屏幕上没法区分，
 * 而它们要用户做的事往往不同。这条不变量由 `test/render-matrix.test.ts` 按
 * **真组件的渲染结果**钉住（不是读这张表）。
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
 * 收起态的视觉族 = **圆环能表达的几种形态**。
 *
 * 五族与「屏幕上看得见的东西」一一对应，**没有两族同形**（`test/render-matrix.test.ts`
 * 按真组件的渲染结果钉住这条）：
 * - `gauge`：有数字，颜色是余额高低的编码 —— 看数字（ok / low / critical / stale）；
 * - `unreadable`：读不到，或读到了但用不了 —— 红环 + 叉。等 / 检查 / 去查账户
 *   （端点不通 / 抓取失败 / 我们坏了 / 账户停用）；
 * - `needs-credential`：没接入，需要**用户去配置** —— 灰环 + ＋（唯一需要动手的一族）；
 * - `pending`：正在取，还没有答案 —— 灰环 + 一条不完整的转弧（首帧）；
 * - `empty`：连上了、账户可用，就是没有余额 —— 灰空环，无需动作。
 *
 * **为什么 `checking` 与 `empty-wallet` 拆成两族**：两者都是灰环，曾经同族 ——
 * 于是「加载中」与「账户没钱」在屏幕上**逐像素相同**，而用户要做的事完全不同
 * （等 vs 什么都不用做）。转弧把「还在动」画出来，两者才分得开。
 *
 * **为什么 `account-unavailable` 归 `unreadable`**：它和另外三个一样，都是
 * 「这个数字现在拿不到 / 不可信」，用户要做的也是去查（账户 / 网络 / 我们）。
 * 它曾经挂在 `gauge` 的红端，靠「红环无叉」与「余额告急」区分 —— 但那区分**不成立**：
 * 余额恰好为 0 的 `critical` 同样是红环、无叉、无弧，两者逐像素相同。
 * 加叉之后与 `critical` 分开了；叉的语义扩成「读不到**或用不了**」，同属
 * 「否定：这里没有可用的数字」。
 *
 * **`unreadable` 与 `pending` 不合并**：合并只能二选一 ——
 * 全红会让每次加载都闪一下叉（冤枉），全灰会让真失败看起来像「没事」。
 * 两者的颜色差就是「试过且失败」与「还没有答案」的分界，值得留。
 */
export type SituationFamily = 'gauge' | 'unreadable' | 'needs-credential' | 'pending' | 'empty'

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
 * - `offline` / `fetch-failed` / `internal-error` / `account-unavailable` 同族：动作相同（等 / 检查）；
 *   四者的差别是诊断面（谁坏了），不是用户面。`internal-error` 在**枚举里保持独立**
 *   （日志、指标、文案要区分「我们坏了」与「上游坏了」），只是视觉上并入。
 *   `account-unavailable` 并入的是**形状**（叉 = 这里没有可用的数字），颜色也同为红。
 * - `stale` 归 `gauge`：数字是真的，只是旧；新鲜度不改变用户动作，年龄在浮层里说。
 * - `checking` 自成一族：它是唯一「正在动」的形态（转弧），用户动作是等。
 * - `empty-wallet` 自成一族：灰空环 —— 唯一一个「什么都不用做」的形态。
 */
const SHAPES: Readonly<Record<Situation, SituationShape>> = {
  // —— 客户端本地事实（宿主不可能知道这两件事）——
  checking: {
    family: 'pending',
    ring: 'ongoing',
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
    family: 'unreadable',
    // **颜色定死为红，不吃 severity。**
    // 它是「账户停用」—— 这个事实本身就决定了红，与余额多少无关；
    // 而上游对欠费账户可能给空的余额列表（selected=null → severity=unknown → 灰环），
    // 那会把「停用」画成「没信息」。定死红环是**结构保证**，不依赖另一处的判定顺序。
    ring: 'error',
    // **叉：与「余额告急」分开的唯一办法。**
    // 从前它靠「红环无叉」与 critical 区分，但余额恰好为 0 的 critical 也是红环无叉无弧 ——
    // 两者在屏幕上逐像素相同（见 test/render-matrix.test.ts 的「两枚红环」一组）。
    // 叉的语义从「读不到」扩到「读不到**或用不了**」：两者同属「这里没有可用的数字」。
    marker: 'cross',
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
    family: 'empty',
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

/**
 * 一个处境的视觉族。
 *
 * **它没有生产消费方**（`grep family src/` 只剩声明与这里）—— 这是有意的，不是遗漏：
 * 组件只需要 `ring` / `marker` / `arc` 那三个通道值，多知道一层「族」就是多耦合一层。
 *
 * **但它不是死代码**，和退役的 `ringSpecOf` 有本质区别（那条教训见
 * [test/model.test.ts](../../../test/model.test.ts) 的「形态不变量」）：
 * - `ringSpecOf` 是个**映射函数**，输出没有任何消费方，测试断言的又是它自己的映射 ——
 *   那些断言**自我满足**，守着一个再也画不到屏幕上的东西；
 * - `family` 是一条**独立的声明**：「我宣称这些处境在屏幕上应当同形」。它被
 *   [test/render-matrix.test.ts](../../../test/render-matrix.test.ts) 当作**假设**，
 *   拿去和**真组件的渲染结果**（另一份独立观测）对账 —— 假设与证据来自两处，
 *   对不上才红。删掉它，那条不变量就失去「应该」这一侧，只剩「实际」。
 *
 * 数学上也确实推不出来：`(ring, marker, arc)` 这组通道值**定不了族** ——
 * `error|cross|none` 收了 unreadable 四个，而 gauge 四个处境分散在三种通道值上
 * （颜色与弧长本身就是它们的读数）。所以族是一层额外的、必须显式声明的信息。
 * @param situation - 处境。
 * @returns 视觉族。
 */
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
 * **优先级必须与宿主 `situationOf` 逐条对齐**，包括那三条修正。这里曾经漏搬了第三条：
 * `state === 'stale'` 判在 `selected === null` **之前**，于是「快照在、里面没有可展示币种、
 * 这轮又没读到」会被推成 `stale` —— 用户手里一个数字都没有，界面上却说「数据已过期」。
 * 兼容层走的是同一条渲染路径，所以那边的缺陷在这边同样成立，修一条不算修完。
 *
 * 推不出来的边角（`internal-error` 与 `account-unavailable` 在旧契约里没有各自的信号）
 * 退到最接近的那个处境。
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
  // **`stale` 的前提是「真的有一份旧数字」**，与宿主那条同理：
  // 没有可展示的币种时，说「数据已过期」是假话（听着像「有旧数据可看」），归 `fetch-failed`。
  if (response.selected === null)
    return response.state === 'stale' ? 'fetch-failed' : 'empty-wallet'
  if (response.state === 'stale') return 'stale'
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

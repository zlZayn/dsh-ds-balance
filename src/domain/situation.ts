/**
 * 处境：界面上每一种形态对应的「用户此刻的处境」。
 *
 * **为什么要有它**：之前环、文案、来源标签**各拼各的** —— 环只吃 `severity`，文案吃
 * `state + error.code + isAvailable + selection`，标签吃 `state + source`。三套输入集不同、
 * 优先级也不同，于是必然出现「环说 A、文案说 B」（例如旧快照 + `isAvailable: false` 时
 * 环是叉、文案却是「数据已过期」），也必然出现「一个空环同时代表三种处境」。
 *
 * 现在只有这一处分支：`situationOf` 按**固定优先级**逐条判，第一个命中即返回。
 * 环、文案、标签都从它的输出派生，不再各自读字段。
 *
 * **闭集，取值有意细**：内部枚举可以细（诊断、日志、指标都要它），
 * 视觉可以粗（收起态只有 5 个族，见客户端 `client/situation.ts` 的形态表）。
 * 两者不必一一对应 —— 但**每一处合并都必须是有意的、写在表里的**，不是默认掉进去的。
 * @module dsh-ds-balance/domain/situation
 */

import type { Severity } from './balance.js'
import type { ErrorCode } from './errors.js'

/**
 * 处境闭集。
 *
 * 前两个**只有客户端能产生**（宿主不可能知道「插件自己的端点通不通」与「首帧到了没有」），
 * 其余九个由宿主判定。两个生产方、一张消费表。
 */
export type Situation =
  /** 首帧：还没问到后端。客户端本地事实。 */
  | 'checking'
  /** 插件自己的端点不可达。客户端本地事实。 */
  | 'offline'
  /** handler 自己抛错 —— 「我们坏了」，不是「上游坏了」。 */
  | 'internal-error'
  /** 两条官方取数路都没有凭据 —— 需要用户去配置。 */
  | 'no-credential'
  /** 接入过（或本该接入）却读不到：网络 / 上游 / 账号查询失败，且没有旧快照。 */
  | 'fetch-failed'
  /** 读到了，但上游说这个账户不可用（停用 / 欠费）。 */
  | 'account-unavailable'
  /** 有旧快照，但本次没读到。 */
  | 'stale'
  /** 连上了、账户可用，但没有任何可展示的币种。 */
  | 'empty-wallet'
  /** 有数字，正常。 */
  | 'ok'
  /** 有数字，偏低。 */
  | 'low'
  /** 有数字，告急。 */
  | 'critical'

/**
 * {@link situationOf} 可能返回的处境。
 *
 * **注意不含 `internal-error` 与两个客户端值**：前者由 HTTP 层的兜底视图直接给
 * （`handlers.ts` 的 `failureView` —— handler 自己抛错时根本走不到 `situationOf`），
 * 后者只有客户端能产生。生产方是三分而不是两分，这张表把它写清楚。
 */
export const SITUATIONS_FROM_FACTS = [
  'no-credential',
  'fetch-failed',
  'account-unavailable',
  'stale',
  'empty-wallet',
  'ok',
  'low',
  'critical',
] as const satisfies readonly Situation[]

/** 宿主能产生的处境 = 事实判出来的 + 兜底视图那一个。 */
export const HOST_SITUATIONS = [
  'internal-error',
  ...SITUATIONS_FROM_FACTS,
] as const satisfies readonly Situation[]

/** 客户端本地产生的处境（宿主不可能知道这两件事）。 */
export const CLIENT_SITUATIONS = ['checking', 'offline'] as const satisfies readonly Situation[]

/** 全部处境。 */
export const SITUATIONS = [
  ...CLIENT_SITUATIONS,
  ...HOST_SITUATIONS,
] as const satisfies readonly Situation[]

/**
 * 判定处境所需的事实。
 *
 * 刻意**只收事实、不收 `BalanceView`**：这样它可以脱离视图结构单测，
 * 也让「哪些输入参与判定」在类型上就一目了然。
 */
export interface SituationFacts {
  /** 有没有快照（旧快照也算有）。 */
  hasSnapshot: boolean
  /** 本次抓取是否失败、但快照还在（`state === 'stale'`）。 */
  stale: boolean
  /** 上游 `is_available`；没有快照时无意义。 */
  isAvailable: boolean
  /** 有没有选中可展示的币种。 */
  hasSelected: boolean
  /** 后端算好的严重度。 */
  severity: Severity
  /** 本次失败的对外错误码；没失败时 `null`。 */
  errorCode: ErrorCode | null
}

/**
 * 判定处境。**顺序即优先级**，第一个命中即返回。
 *
 * 三条刻意的优先级（都对旧写法做过修正）：
 * 1. **没接入压过一切**：一条凭据都没有时，说「读不到余额」是误导 —— 用户没配过任何东西，
 *    该说的是「尚未配置凭据」。判据是 `NO_KEY` **且没有快照**（有快照说明曾经读到过，
 *    那就不是「没接入」，而是「这轮没读到」）。
 * 2. **账户停用压过「数据过期」**：`isAvailable: false` 是上游明确给的事实，比「数字旧了」
 *    更强的信号，且那种快照的余额通常是 0 —— 说「数据已过期」会把真问题藏起来。
 * 3. **`stale` 的前提是「真的有一份旧数字」**（`hasSelected`）。快照在、但里面一个可展示的
 *    币种都没有、这轮又没读到 —— 用户手里没有任何数字，说「数据已过期」是假话
 *    （听着像「有旧数据可看」）。归 `fetch-failed`：读不到才是实话。
 *
 * **不变量（界面按它设计，测试钉着）**：
 * - 返回 `stale` / `ok` / `low` / `critical` ⇒ **一定有可展示的币种**
 *   （所以「有数字那一族」的颜色永远由真实阈值算出来，不会是 `unknown`）；
 * - 返回 `account-unavailable` ⇒ `isAvailable` 一定是 `false`，颜色恒红。
 *
 * @param facts - 判定所需的六个事实。
 * @returns 闭集内的处境。
 */
export function situationOf(facts: SituationFacts): Situation {
  // ①② 没有快照：分清「没接入」与「接入了但读不到」。
  if (!facts.hasSnapshot) {
    return facts.errorCode === 'NO_KEY' ? 'no-credential' : 'fetch-failed'
  }
  // ③ 账户维度的事实压过新鲜度：停用比「数字旧」更该说。
  if (!facts.isAvailable) return 'account-unavailable'
  // ④ 没有可展示的币种：分清「这轮没读到」与「账户本来就没有」。
  //    前者说「读不到」才是实话 —— 用户手里一个数字都没有，没有「旧数据」可谈；
  //    这也是「有数字那一族」颜色不会是 unknown 的结构保证（见上面不变量）。
  if (!facts.hasSelected) return facts.stale ? 'fetch-failed' : 'empty-wallet'
  // ⑤ 有旧快照、也有数字，但本轮没读到：数字照常显示，文案说它旧。
  if (facts.stale) return 'stale'
  // ⑥ 有数字，按阈值分档。`unavailable` / `unknown` 在上面已经被接走，
  //    真漏到这里说明判定链有洞 —— 归到最保守的「读不到」，不假装正常。
  if (facts.severity === 'unavailable' || facts.severity === 'unknown') return 'fetch-failed'
  if (facts.severity === 'critical') return 'critical'
  if (facts.severity === 'warn') return 'low'
  return 'ok'
}

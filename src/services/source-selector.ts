/**
 * 取数来源选择。纯函数，没有 `ctx`、没有 I/O。
 *
 * **本文件是「新增一个来源」要动的唯一一处逻辑**：加一行 `ROUTED`、把新来源排进
 * `FALLBACK_ORDER`，再在装配处多建一份账本（reader + ledger）。账本状态机、调度、HTTP、
 * 界面都不认识具体来源 —— 它们只认 {@link BalanceSource} 这个闭集与「哪条此刻活跃」。
 *
 * 规则是**四层回落**：
 * 1. 当前会话的路由（客户端把会话级选择当提示带上来的）；
 * 2. 全局默认路由（提示缺席时宿主自己读）；
 * 3. 固定顺序（`FALLBACK_ORDER`）；
 * 4. 一条都不可用：回 {@link DEFAULT_SOURCE}，让它自然报 `NO_KEY`（与只有一条路时逐字相同）。
 *
 * 完整判据见 [决策记录](../../.agents/notes/2026-09-30-account-balance-source.md)。
 * @module dsh-ds-balance/services/source-selector
 */

import type { BalanceSource } from '../domain/balance.js'

/** API Key 那条路的宿主 provider id。 */
export const KEY_PROVIDER = 'deepseek-official'

/** 账号登录那条路的宿主 provider id。 */
export const ACCOUNT_PROVIDER = 'deepseek-account'

/** 宿主 provider id → 本插件的取数来源。**认得的路只有这里列出的**。 */
const ROUTED: Readonly<Record<string, BalanceSource>> = {
  // 官方余额端点那条：凭据是 API Key（解析链见 KeyResolver）。
  [KEY_PROVIDER]: 'deepseek-http',
  // 宿主账号服务那条：凭据是账号登录态。
  [ACCOUNT_PROVIDER]: 'deepseek-account',
}

/**
 * 路由都指不出该走哪条时的固定顺序：**排在前的先被选中**。
 *
 * Key 优先是刻意的：它让「今天能用的用户」数字一字不变 —— 账号那条路是补上断掉的那条，
 * 不是抢走已经在用的那条。
 */
export const FALLBACK_ORDER: readonly BalanceSource[] = ['deepseek-http', 'deepseek-account']

/** 一条都不可用时回落到谁。挑 Key 那条，因为它的 `NO_KEY` 文案是既有用户认识的那句。 */
export const DEFAULT_SOURCE: BalanceSource = 'deepseek-http'

/** 路由判出来的来源；`'other'` 表示当前跑在别家供应商上（两条官方路都没在用）。 */
export type RoutedSource = BalanceSource | 'other' | null

/**
 * 把宿主 provider id 翻成我们认的来源。
 *
 * **只认 {@link ROUTED} 里列出的两条**：别家的余额插件够不着，也不该去猜。
 * @param provider - 宿主给的路由 id；读不到时传 `null`。
 * @returns 认得的来源，或 `'other'` / `null`。
 */
export function routeOf(provider: string | null | undefined): RoutedSource {
  if (provider === null || provider === undefined || provider === '') return null
  return ROUTED[provider] ?? 'other'
}

/**
 * 选这一轮走哪条路。
 * @param input - 路由判据，以及逐来源的可用性（由门面从各账本问出来）。
 * @returns 要用的来源。
 */
export function pickSource(input: {
  routed: RoutedSource
  available: (source: BalanceSource) => boolean
}): BalanceSource {
  const { routed, available } = input
  if (routed !== null && routed !== 'other' && available(routed)) return routed
  for (const source of FALLBACK_ORDER) {
    if (available(source)) return source
  }
  return DEFAULT_SOURCE
}

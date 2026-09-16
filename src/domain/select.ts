/**
 * 多币种选择。
 *
 * **后端权威**：前端不再自己挑币种，只读 `selected`。数组顺序可能跳变，
 * 所以这里先做一次稳定排序再走优先级链。
 * @module dsh-ds-balance/domain/select
 */

import type { BalanceInfo } from './balance.js'
import { isZeroMoney } from './money.js'

/** `displayCurrency` 的「跟随账户」取值。 */
export const AUTO_CURRENCY = 'auto'

/**
 * 稳定排序：`CNY` 排到最前，其余保持原有相对顺序。
 * @param balances - 上游给的数组，顺序不可依赖。
 * @returns 新数组，不改动入参。
 */
export function stableOrder(balances: readonly BalanceInfo[]): BalanceInfo[] {
  return [...balances].sort((left, right) => {
    if (left.currency === right.currency) return 0
    if (left.currency === 'CNY') return -1
    if (right.currency === 'CNY') return 1
    return 0
  })
}

/**
 * 按偏好挑选要展示的币种。
 *
 * 优先级：偏好币种（且余额 > 0）→ `CNY` 且 > 0 → 任一 > 0 → `CNY` → 第一个 → `null`。
 * @param balances - 上游给的数组。
 * @param preferred - 前端传来的 `displayCurrency`；`auto` 或空表示不指定。
 * @returns 选中的余额项，或 `null` 表示账户没有任何币种。
 */
export function pickBalance(balances: readonly BalanceInfo[], preferred?: string): BalanceInfo | null {
  if (balances.length === 0) return null
  const ordered = stableOrder(balances)
  const wanted = preferred?.trim() ?? ''

  if (wanted !== '' && wanted !== AUTO_CURRENCY) {
    const hit = ordered.find((item) => item.currency.toUpperCase() === wanted.toUpperCase() && !isZeroMoney(item.total))
    if (hit !== undefined) return hit
  }

  return ordered.find((item) => item.currency === 'CNY' && !isZeroMoney(item.total))
    ?? ordered.find((item) => !isZeroMoney(item.total))
    ?? ordered.find((item) => item.currency === 'CNY')
    ?? ordered[0]
    ?? null
}

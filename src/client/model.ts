/**
 * 视图模型：把后端契约机械映射成界面需要的形状。
 * 这里不允许出现金额阈值判断 —— 颜色只由 `severity` 决定。
 * @module dsh-ds-balance/client/model
 */

import type { BalanceInfo, BalanceResponse, Severity } from './api-types.ts'

/** StateDot 的五个状态（原生原语取值）。 */
export type DotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

/** severity → StateDot 状态。见 .agents/notes 的映射决策。 */
export function dotStateOf(severity: Severity): DotState {
  switch (severity) {
    case 'ok': return 'done'
    case 'warn': return 'warning'
    case 'critical': return 'error'
    case 'unavailable': return 'error'
    case 'unknown': return 'idle'
  }
}

/** 币种符号。未知币种回落到代码本身。 */
export function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case 'CNY': return '¥'
    case 'USD': return '$'
    case 'EUR': return '€'
    default: return ''
  }
}

/**
 * 把后端的定点小数字符串裁成两位显示。
 * 全程按字符串处理，不经过浮点数：金额相等比较与累加都在后端。
 */
export function formatAmount(value: string): string {
  const trimmed = value.trim()
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(trimmed)
  if (match === null) return trimmed
  const [, sign, whole, fraction = ''] = match
  const cents = (fraction + '00').slice(0, 2)
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return cents === '00' ? `${sign}${grouped}` : `${sign}${grouped}.${cents}`
}

/** 带币种符号的显示金额。 */
export function formatMoney(amount: string, currency: string): string {
  return `${currencySymbol(currency)}${formatAmount(amount)}`
}

/** 币种选择结果。 */
export interface CurrencySelection {
  /** 实际用于展示的币种；账户无任何余额时为 null。 */
  shown: BalanceInfo | null
  /** 用户选定的币种是否存在于账户中。 */
  matchesPreference: boolean
  /** 是否处于「自动」模式。 */
  auto: boolean
  /** 是否连一个币种都没有。 */
  empty: boolean
}

/**
 * 按用户偏好挑选要展示的币种。
 *
 * 规则：不静默、不惩罚、不偷偷改设置。
 * - `auto`：取账户第一个币种，永不报不匹配。
 * - 指定币种存在：用它。
 * - 指定币种不存在但账户有其他币种：回落到第一个，并标记不匹配。
 * - 账户完全没有余额：`shown` 为 null，标记为空。
 *
 * 不依赖数组顺序做语义判断，但回落到「第一个」时顺序是唯一可用依据。
 */
export function selectCurrency(response: BalanceResponse, preference: string): CurrencySelection {
  const auto = preference === 'auto' || preference === ''
  const list = response.balances
  if (list.length === 0) {
    return { shown: null, matchesPreference: auto, auto, empty: true }
  }
  if (auto) {
    return { shown: list[0] ?? null, matchesPreference: true, auto, empty: false }
  }
  const wanted = list.find((item) => item.currency.toUpperCase() === preference.toUpperCase())
  if (wanted !== undefined) {
    return { shown: wanted, matchesPreference: true, auto, empty: false }
  }
  return { shown: list[0] ?? null, matchesPreference: false, auto, empty: false }
}

/** 浮层相对时间的档位。 */
export type AgeBucket = 'just-now' | 'seconds' | 'minutes' | 'hours' | 'days' | 'unknown'

/** 把毫秒差归到一档，具体文案交给词典。 */
export function ageBucket(ageMs: number): { bucket: AgeBucket; value: number } {
  if (!Number.isFinite(ageMs) || ageMs < 0) return { bucket: 'unknown', value: 0 }
  const seconds = Math.floor(ageMs / 1000)
  if (seconds < 5) return { bucket: 'just-now', value: seconds }
  if (seconds < 60) return { bucket: 'seconds', value: seconds }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return { bucket: 'minutes', value: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { bucket: 'hours', value: hours }
  return { bucket: 'days', value: Math.floor(hours / 24) }
}

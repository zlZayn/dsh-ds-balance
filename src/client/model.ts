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
  /** 实际用于展示的那条余额；`null` 表示后端没有给出可展示的币种。 */
  shown: BalanceInfo | null
  /** 后端选定的币种是否就是设置里选的那个。 */
  matchesPreference: boolean
  /** 是否处于「自动」模式。 */
  auto: boolean
  /** 是否连一条可展示的余额都没有。 */
  empty: boolean
}

/**
 * 从后端给出的 `selected` 读出展示币种。
 *
 * **前端不再自己挑币种**：挑选规则（偏好币种、CNY 优先、余额为 0 时跳过）是
 * 后端的职责，前端只把结果映射成界面。设置里的显示币种作为查询参数传给后端。
 *
 * 读的字段只有两个：`selected.currency`（决定展示哪条）与 `selected` 是否为
 * `null`（决定空态）。金额直接取 `balances` 里同币种那条 —— `selected` 只带
 * `total`，浮层还要 `granted` 与 `toppedUp`。
 *
 * `balances` 里找不到 `selected.currency` 时返回 `shown: null` 而不是硬凑一条：
 * 契约保证它一定在，真出现就是形状违约，宁可显示「暂无余额」也不要编一个金额。
 * @param response - 后端响应。
 * @param preference - 设置里的显示币种；`auto` 表示跟随账户。
 * @returns 展示币种与三个布尔标记。
 */
export function selectionOf(response: BalanceResponse, preference: string): CurrencySelection {
  const auto = preference === 'auto' || preference === ''
  const selected = response.selected
  if (selected === null) {
    return { shown: null, matchesPreference: auto, auto, empty: true }
  }
  const wanted = selected.currency.toUpperCase()
  const shown = response.balances.find((item) => item.currency.toUpperCase() === wanted) ?? null
  return {
    shown,
    matchesPreference: auto || wanted === preference.toUpperCase(),
    auto,
    empty: shown === null,
  }
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

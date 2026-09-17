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

/** 圆环中心可以画的符号。目前只有「账户不可用」用得到。 */
export type RingMarker = 'cross'

/** 一个 severity 对应的环形态。 */
export interface RingSpec {
  /** 弧的状态；决定弧色。 */
  state: DotState
  /** 中心符号；`null` 表示不画。 */
  marker: RingMarker | null
}

/**
 * severity → 环形态。
 *
 * **颜色只有四个色相可用**：官方 token 里 `error-primary` 与 `error-secondary`
 * 在深色主题下同值，没有第五种颜色。所以两档「红」靠**形状**区分：
 *
 * - 颜色编码「数值严重度」：绿 → 琥珀 → 红。
 * - 形状编码「账户可用性」：`unavailable` 是账户维度的事实，与余额高低无关，
 *   它拿红弧再加一个中心叉号。色盲与低分辨率下依然能分开。
 *
 * `critical` 与 `unavailable` 都是红弧，这是有意的：**别再往回改成从红系里挑两个**。
 * @param severity - 后端给的严重度。
 * @returns 弧状态与中心符号。
 */
export function ringSpecOf(severity: Severity): RingSpec {
  return {
    state: dotStateOf(severity),
    marker: severity === 'unavailable' ? 'cross' : null,
  }
}

/** 金额定点小数的小数位数，与宿主领域层同源（1e8）。 */
const DECIMAL_SCALE = 100_000_000n

/** 弧长比例算到万分之一就够 —— 再细的差别也画不出来。 */
const ARC_STEPS = 10_000n

/** 定点小数字符串的形状，与 `formatAmount` 认的是同一条。 */
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d*))?$/

/**
 * warn 阈值不可用时的定性弧长。
 *
 * `ok` 与 `unavailable` 都给满环：前者无需提醒，后者是账户维度的问题、与余额高低无关。
 * `critical` 给 1/4 而不是 0，好让「余额很低」与「读不到数据」在形状上仍分得开。
 */
const QUALITATIVE_ARC: Readonly<Record<Severity, number>> = {
  ok: 1,
  warn: 0.75,
  critical: 0.25,
  unavailable: 1,
  unknown: 0,
}

/** 定点小数字符串 → 放大 1e8 的整数；形状不符给 `null`，小数超过 8 位截断。 */
function scaledOf(value: string): bigint | null {
  const match = DECIMAL_PATTERN.exec(value.trim())
  if (match === null) return null
  const [, sign, whole, fraction = ''] = match
  const magnitude = BigInt(whole) * DECIMAL_SCALE + BigInt((fraction + '00000000').slice(0, 8))
  return sign === '-' ? -magnitude : magnitude
}

/**
 * 圆环的弧长比例：选中币种的余额占它 warn 阈值的几分之几，封顶 1。
 *
 * **阈值在这里只当刻度，不当判据**：颜色仍然完全来自 `severity`，
 * 这个函数只回答「弧画多长」。阈值是用户自己设的，它天然就是「多少算少」的坐标轴，
 * 不必再引入一个「满」的基准。`critical` 不参与这里 —— 它已经在后端决定了 `severity`，
 * 再进一次弧长等于把同一件事算两遍。
 *
 * 金额比较走放大 1e8 的整数，不经过浮点数：`v = w` 必须**恰好**是满环。
 * @param total - 选中币种的余额（定点小数字符串）；`null` 表示没有可展示的币种。
 * @param warnThreshold - 该币种的 warn 阈值；`undefined` 或非正数表示没配。
 * @param severity - 后端给的严重度，仅在阈值不可用时用来定性。
 * @returns 0~1 的弧长比例。
 */
export function ringRatioOf(
  total: string | null,
  warnThreshold: number | undefined,
  severity: Severity,
): number {
  const balance = total === null ? null : scaledOf(total)
  const limit = warnThreshold === undefined || !Number.isFinite(warnThreshold)
    ? null
    : scaledOf(String(warnThreshold))
  if (balance === null || limit === null || limit <= 0n) return QUALITATIVE_ARC[severity]
  // 负余额是形状违约，画空环 —— 画成满环会被读成「余额充足」，方向正好反过来。
  if (balance <= 0n) return 0
  if (balance >= limit) return 1
  return Number((balance * ARC_STEPS) / limit) / Number(ARC_STEPS)
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

/**
 * 当前年龄：上一次得知的年龄，加上此后流逝的时间。
 *
 * 基准必须是**收到那份响应的时刻**，不是组件挂载的时刻 ——
 * 拿挂载时刻去换算 `ageMs` 的话，自动轮询带回来的新快照永远拨不回「刚刚」，
 * 只有另记了时刻的手动刷新看起来才会动。
 * @param seenAt - 收到那份响应的本地时刻（毫秒）。
 * @param seenAgeMs - 那份响应里后端算好的年龄（毫秒）。
 * @param now - 当前本地时刻（毫秒）。
 * @returns 毫秒计的当前年龄；基准缺失时按 0 算。
 */
export function currentAgeMs(seenAt: number, seenAgeMs: number, now: number): number {
  const base = Number.isFinite(seenAgeMs) ? Math.max(0, seenAgeMs) : 0
  return Math.max(0, base + (now - seenAt))
}

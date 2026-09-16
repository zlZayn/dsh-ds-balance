/**
 * 后端契约类型。本阶段不实现后端，这些形状只用来约束 mock 数据。
 * @module dsh-ds-balance/client/api-types
 */

/** 余额数据的状态维度。 */
export type BalanceState = 'empty' | 'ok' | 'stale' | 'error'

/** 颜色严重度维度。前端只做机械映射，不比较金额。 */
export type Severity = 'ok' | 'warn' | 'critical' | 'unavailable' | 'unknown'

/** 估算来源。第一版 UI 不消费。 */
export type UsageSource = 'blended' | 'balance-observed' | 'projection'

/** 单个币种的余额。金额一律是字符串。 */
export interface BalanceInfo {
  currency: string
  total: string
  granted: string
  toppedUp: string
}

/** 今日用量。第一版 UI 不消费，保留以维持契约完整。 */
export interface TodayUsage {
  value: string
  currency: string
  source: UsageSource
  confidence: string
  needsReview: boolean
  range: [string, string] | null
}

/** 后端错误。 */
export interface BalanceError {
  code: string
  message: string
}

/** `GET /api/v1/balance` 的响应。 */
export interface BalanceResponse {
  requestId: string
  schemaVersion: number
  state: BalanceState
  stale: boolean
  fetchedAt: number
  ageMs: number
  isAvailable: boolean
  accountTag8: string
  balances: BalanceInfo[]
  selected: { currency: string; total: string } | null
  severity: Severity
  thresholds: Record<string, { warn: string; critical: string }>
  todayUsage: TodayUsage | null
  error: BalanceError | null
}

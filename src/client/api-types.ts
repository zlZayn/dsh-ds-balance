/**
 * 后端契约类型。本阶段不实现后端，这些形状只用来约束 mock 数据。
 * @module dsh-ds-balance/client/api-types
 */

import type { ErrorCode } from '../domain/errors.ts'
import type { UNREACHABLE_CODE } from './data.ts'

/** 余额数据的状态维度。 */
export type BalanceState = 'empty' | 'ok' | 'stale' | 'error'

/**
 * 余额来源。
 *
 * 与宿主 `domain/balance.ts` 的 `BalanceSource` **逐字同形**：两个半体不共享值，
 * 所以这里是自己抄的一份字面量，由 `test/client-data.test.ts` 对账。
 */
export type BalanceSource = 'deepseek-http' | 'deepseek-account'

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

/**
 * 客户端可见的错误码：宿主闭集 ∪ 客户端本地合成的「端点不可达」。
 *
 * `UNREACHABLE_CODE` 只在客户端产生（端点拿不到、或回的不是 JSON），宿主侧不认识它，
 * 所以是**显式扩展**而不是往宿主闭集里塞。
 */
export type BalanceErrorCode = ErrorCode | typeof UNREACHABLE_CODE

/** 后端错误。 */
export interface BalanceError {
  code: BalanceErrorCode
  message: string
}

/** `GET /api/v1/balance` 的响应。 */
export interface BalanceResponse {
  requestId: string
  schemaVersion: number
  /** 这一份数字是哪条取数路给的。标题里的来源标签读它。 */
  source: BalanceSource
  /**
   * 处境：界面唯一的分支入口。
   *
   * **旧宿主没有这个字段**（客户端 HMR 换新、宿主重启才换），所以类型上可选，
   * 读它必须过形状守卫 —— 见 [situation.ts](situation.ts) 的 `situationOfResponse`。
   */
  situation?: string
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

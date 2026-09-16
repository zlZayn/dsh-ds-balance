/**
 * 余额领域类型。
 *
 * 这里定义的是**契约形状**：金额一律 `bigint` 最小单位，序列化时才变字符串。
 * @module dsh-ds-balance/domain/balance
 */

import type { ErrorInfo } from './errors.js'
import type { Units } from './money.js'

/** 币种代码，例如 `CNY` / `USD`。 */
export type Currency = string

/** 缓存状态。闭集。 */
export type CacheState = 'empty' | 'ok' | 'stale' | 'error'

/** 颜色严重度。闭集，前端只做机械映射。 */
export type Severity = 'ok' | 'warn' | 'critical' | 'unavailable' | 'unknown'

/** 单个币种的余额。 */
export interface BalanceInfo {
  currency: Currency
  total: Units
  granted: Units
  toppedUp: Units
}

/** 一次成功抓取的不可变快照。 */
export interface BalanceSnapshot {
  /** 快照标识，单调可排序。 */
  snapshotId: string
  /** 账本作用域标识：HMAC(serverSalt, apiKey) 前缀，不含明文。 */
  accountTag: string
  /** 抓取时刻（毫秒）。 */
  fetchedAt: number
  /** 上游 `is_available`。 */
  isAvailable: boolean
  /** 全币种余额。 */
  balances: BalanceInfo[]
  /** 数据来源。 */
  source: 'deepseek-http'
  /** 原始响应，审计用。 */
  raw: unknown
}

/** 一个币种的预警 / 告急阈值。 */
export interface ThresholdPair {
  warn: Units
  critical: Units
}

/** 给前端的余额视图。 */
export interface BalanceView {
  state: CacheState
  stale: boolean
  fetchedAt: number | null
  ageMs: number | null
  isAvailable: boolean | null
  balances: BalanceInfo[]
  selected: { currency: Currency; total: Units } | null
  severity: Severity
  thresholds: Record<Currency, ThresholdPair>
  error: ErrorInfo | null
}

/** 上游 `GET /user/balance` 的原始响应形状。字段名保持上游拼写。 */
export interface RawBalanceResponse {
  is_available: boolean
  balance_infos: Array<{
    currency: string
    total_balance: string
    granted_balance: string
    topped_up_balance: string
  }>
}

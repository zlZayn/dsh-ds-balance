/**
 * 线上形状与序列化。
 *
 * 契约见 docs/backend-architecture.md §8：**金额一律八位小数字符串**，
 * `bigint` 最小单位只活在进程内。本模块是纯函数，不碰 `ctx`、不发请求。
 * @module dsh-ds-balance/http/wire
 */

import { randomUUID } from 'node:crypto'
import type { BalanceView, CacheState, Currency, Severity, ThresholdPair } from '../domain/balance.js'
import type { ErrorInfo } from '../domain/errors.js'
import { formatMoney } from '../domain/money.js'
import { SCHEMA_VERSION } from '../version.js'

/** 一个币种的余额，金额是八位小数字符串。 */
export interface WireBalance {
  currency: Currency
  total: string
  granted: string
  toppedUp: string
}

/** 一个币种的阈值，金额同样是字符串。 */
export interface WireThresholdPair {
  warn: string
  critical: string
}

/**
 * 线上的错误结构。
 *
 * `details` **不出去**：它可能带上游原文，属于内部诊断面。
 */
export interface WireError {
  code: string
  message: string
  retryable: boolean
}

/**
 * 凭据的只读描述。
 *
 * 形状逐字对齐官方 `credentialProvider.describe()`：**只有三个事实，没有装值的槽**。
 * 界面靠它决定凭据字段是「可编辑」还是「由启动环境提供」。
 */
export interface WireCredentialInfo {
  ref: string
  configured: boolean
  source: string | null
  writable: boolean
}

/** `GET /api/v1/balance` 的响应体。 */
export interface WireBalanceResponse {
  requestId: string
  schemaVersion: number
  state: CacheState
  stale: boolean
  fetchedAt: number
  ageMs: number
  isAvailable: boolean
  accountTag8: string
  balances: WireBalance[]
  selected: { currency: Currency; total: string } | null
  severity: Severity
  thresholds: Record<Currency, WireThresholdPair>
  /** 第一版不做「今日已用」；字段保留以维持契约完整。 */
  todayUsage: null
  error: WireError | null
}

/** 生成一个请求标识。只用于把响应与前端的日志对上，不含任何账户信息。 */
export function newRequestId(): string {
  return `req_${randomUUID().replaceAll('-', '').slice(0, 16)}`
}

/** 把错误折成线上形状。 */
export function toWireError(info: ErrorInfo): WireError {
  return { code: info.code, message: info.message, retryable: info.retryable }
}

/** 把 `bigint` 最小单位折成八位小数字符串。 */
function amount(units: bigint): string {
  return formatMoney(units)
}

/** 把一个币种的阈值折成线上形状。 */
function thresholdPair(pair: ThresholdPair): WireThresholdPair {
  return { warn: amount(pair.warn), critical: amount(pair.critical) }
}

/**
 * 把领域视图折成线上响应。
 *
 * 两处刻意的兜底，都是为了让响应仍能通过前端的字段类型：
 * - 没有快照时 `fetchedAt` / `ageMs` 记 0（前端把 0 读成「刚刚」，
 *   与 mock 在空态 / 错误态给的取值一致）；
 * - 没有快照时 `isAvailable` 记 `false`。
 * @param view - 服务层给出的视图。
 * @param accountTag8 - 当前账本标识前 8 位；没有快照时传空串。
 * @param requestId - 本次请求的标识。
 * @returns 契约 §8.3 的响应体。
 */
export function toWireBalanceView(
  view: BalanceView,
  accountTag8: string,
  requestId: string,
): WireBalanceResponse {
  const thresholds: Record<Currency, WireThresholdPair> = {}
  for (const [currency, pair] of Object.entries(view.thresholds)) {
    thresholds[currency] = thresholdPair(pair)
  }
  return {
    requestId,
    schemaVersion: SCHEMA_VERSION,
    state: view.state,
    stale: view.stale,
    fetchedAt: view.fetchedAt ?? 0,
    ageMs: view.ageMs ?? 0,
    isAvailable: view.isAvailable ?? false,
    accountTag8,
    balances: view.balances.map((item) => ({
      currency: item.currency,
      total: amount(item.total),
      granted: amount(item.granted),
      toppedUp: amount(item.toppedUp),
    })),
    selected: view.selected === null
      ? null
      : { currency: view.selected.currency, total: amount(view.selected.total) },
    severity: view.severity,
    thresholds,
    todayUsage: null,
    error: view.error === null ? null : toWireError(view.error),
  }
}

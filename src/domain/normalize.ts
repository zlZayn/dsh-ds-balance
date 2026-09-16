/**
 * 归一化与错误体解析。
 *
 * 两条铁律：结构不符抛 {@link ShapeError}，金额解析失败抛 {@link ParseError}。
 * **绝不静默归 0。**
 * @module dsh-ds-balance/domain/normalize
 */

import type { BalanceInfo, BalanceSnapshot, RawBalanceResponse } from './balance.js'
import { ParseError, ShapeError } from './errors.js'
import { parseMoney } from './money.js'

let lastStamp = 0
let counter = 0

/**
 * 生成单调递增、可按字典序排序的快照 id。
 * @param now - 当前时刻。
 * @returns 形如 `<时间戳 base36>-<序号 base36>` 的 id。
 */
export function nextSnapshotId(now: number): string {
  if (now === lastStamp) counter += 1
  else {
    lastStamp = now
    counter = 0
  }
  return `${now.toString(36).padStart(9, '0')}-${counter.toString(36).padStart(3, '0')}`
}

/** 校验一个币种条目。 */
function toBalanceInfo(entry: unknown, index: number): BalanceInfo {
  if (entry === null || typeof entry !== 'object') {
    throw new ShapeError(`balance_infos[${index}] is not an object`)
  }
  const row = entry as Record<string, unknown>
  if (typeof row.currency !== 'string' || row.currency.trim() === '') {
    throw new ShapeError(`balance_infos[${index}].currency is not a non-empty string`)
  }
  return {
    currency: row.currency,
    total: parseAmount(row.total_balance, `balance_infos[${index}].total_balance`),
    granted: parseAmount(row.granted_balance, `balance_infos[${index}].granted_balance`),
    toppedUp: parseAmount(row.topped_up_balance, `balance_infos[${index}].topped_up_balance`),
  }
}

/** 解析一个金额字段，带字段名以便定位。 */
function parseAmount(value: unknown, field: string): bigint {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ShapeError(`${field} is not a string`)
  }
  try {
    return parseMoney(value)
  } catch (error) {
    if (error instanceof ParseError) throw new ParseError(`${field}: ${error.message}`, { cause: error })
    throw error
  }
}

/**
 * 把上游响应归一化成快照。
 * @param raw - 上游 JSON，未经信任。
 * @param accountTag - 账本作用域标识。
 * @param now - 抓取时刻。
 * @returns 不可变快照。
 * @throws {ShapeError} 结构不符。
 * @throws {ParseError} 金额不是十进制定点。
 */
export function normalize(raw: unknown, accountTag: string, now: number): BalanceSnapshot {
  if (raw === null || typeof raw !== 'object') throw new ShapeError('response is not an object')
  const body = raw as Partial<RawBalanceResponse>
  if (typeof body.is_available !== 'boolean') throw new ShapeError('is_available is not a boolean')
  if (!Array.isArray(body.balance_infos)) throw new ShapeError('balance_infos is not an array')

  return {
    snapshotId: nextSnapshotId(now),
    accountTag,
    fetchedAt: now,
    isAvailable: body.is_available,
    balances: body.balance_infos.map((entry, index) => toBalanceInfo(entry, index)),
    source: 'deepseek-http',
    raw,
  }
}

/** 从错误体里抽出的可读信息。 */
export interface ParsedErrorBody {
  code?: string
  message?: string
}

/**
 * 容错解析上游错误体。
 *
 * 官方未文档化，实测至少三种形状，逐条尝试后兜底成截断的原文。
 * @param text - 响应正文。
 * @returns 尽力抽出的 code 与 message。
 */
export function parseErrorBody(text: string): ParsedErrorBody {
  const trimmed = text.trim()
  if (trimmed === '') return {}

  let body: unknown
  try {
    body = JSON.parse(trimmed)
  } catch {
    return { message: trimmed.slice(0, 200) }
  }

  if (body === null || typeof body !== 'object') return { message: String(body).slice(0, 200) }
  const record = body as Record<string, unknown>

  const nested = record.error
  if (nested !== null && typeof nested === 'object') {
    const inner = nested as Record<string, unknown>
    const code = inner.type ?? inner.code
    const message = inner.message
    return {
      ...(typeof code === 'string' && code !== '' ? { code } : {}),
      ...(typeof message === 'string' ? { message } : {}),
    }
  }

  if (typeof record.detail === 'string') return { message: record.detail }
  if (typeof record.message === 'string') return { message: record.message }
  return { message: JSON.stringify(body).slice(0, 200) }
}

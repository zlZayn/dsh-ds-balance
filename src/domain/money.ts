/**
 * 定点金额。
 *
 * 全程 `bigint`，绝不经过浮点 —— 合约要求金额是字符串、比较与累加只在后端做。
 * @module dsh-ds-balance/domain/money
 */

import { ParseError } from './errors.js'

/** 1 个货币单位对应的最小单位数（8 位小数）。 */
export const MONEY_SCALE = 100_000_000n

/** 契约规定的小数位数。 */
export const MONEY_DECIMALS = 8

/** 金额的最小单位表示。 */
export type Units = bigint

/** 只接受十进制定点：可选负号、整数部分、可选小数部分。不接受科学计数法。 */
const MONEY_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/

/**
 * 把契约里的金额字符串解析成最小单位。
 *
 * 超过 {@link MONEY_DECIMALS} 位的小数**截断，不四舍五入**；解析失败抛
 * {@link ParseError}，绝不静默归 0。
 * @param input - 金额字符串或数字（数字会被先转成字符串）。
 * @returns 最小单位金额。
 * @throws {ParseError} 当文本不是十进制定点。
 */
export function parseMoney(input: string | number): Units {
  const text = String(input).trim()
  const match = MONEY_PATTERN.exec(text)
  if (match === null) {
    throw new ParseError(`not a decimal amount: ${JSON.stringify(text.slice(0, 40))}`)
  }
  const sign = match[1] ?? ''
  const whole = match[2] ?? '0'
  const fraction = match[3] ?? ''
  const scaled = (fraction + '00000000').slice(0, MONEY_DECIMALS)
  const magnitude = BigInt(whole) * MONEY_SCALE + BigInt(scaled)
  return sign === '-' ? -magnitude : magnitude
}

/**
 * 把最小单位格式化成定点字符串。
 * @param units - 最小单位金额。
 * @param decimals - 保留几位小数，0..{@link MONEY_DECIMALS}；默认 8（给 API），UI 用 2。
 * @returns 定点字符串，超出的位数直接截断。
 * @throws {RangeError} 当 `decimals` 越界。
 */
export function formatMoney(units: Units, decimals: number = MONEY_DECIMALS): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MONEY_DECIMALS) {
    throw new RangeError(`decimals must be an integer in 0..${MONEY_DECIMALS}`)
  }
  const negative = units < 0n
  const magnitude = negative ? -units : units
  const whole = (magnitude / MONEY_SCALE).toString()
  const fraction = (magnitude % MONEY_SCALE).toString().padStart(MONEY_DECIMALS, '0')
  const body = decimals === 0 ? whole : `${whole}.${fraction.slice(0, decimals)}`
  return negative ? `-${body}` : body
}

/** 加法。 */
export function addMoney(left: Units, right: Units): Units {
  return left + right
}

/** 减法。 */
export function subMoney(left: Units, right: Units): Units {
  return left - right
}

/** 三路比较：-1 / 0 / 1。 */
export function cmpMoney(left: Units, right: Units): -1 | 0 | 1 {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/** 是否为零。 */
export function isZeroMoney(value: Units): boolean {
  return value === 0n
}

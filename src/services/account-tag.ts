/**
 * 账本作用域标识。
 *
 * `accountTag` 只用于把快照按凭据分组，**不含明文**，也不可逆推出密钥。
 * @module dsh-ds-balance/services/account-tag
 */

import { createHmac } from 'node:crypto'

/** 取前多少位十六进制。够区分账本，又不至于过长。 */
export const ACCOUNT_TAG_LENGTH = 32

/** 日志里只记前 8 位。 */
export const ACCOUNT_TAG_LOG_LENGTH = 8

/**
 * 计算账本标识。
 * @param salt - 进程内稳定的服务端盐。
 * @param apiKey - 明文密钥；**只在内存里流转**。
 * @returns 32 位十六进制标识。
 */
export function computeAccountTag(salt: string, apiKey: string): string {
  return createHmac('sha256', salt).update(apiKey).digest('hex').slice(0, ACCOUNT_TAG_LENGTH)
}

/**
 * 日志用的短标识。
 * @param accountTag - {@link computeAccountTag} 的产物。
 * @returns 前 8 位。
 */
export function accountTag8(accountTag: string): string {
  return accountTag.slice(0, ACCOUNT_TAG_LOG_LENGTH)
}

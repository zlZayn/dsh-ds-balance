/**
 * 密钥解析。
 *
 * 解析链（优先级从高到低）：配置 `apiKey` → `credentials.resolve(apiKeyRef)` →
 * `process.env[apiKeyRef]` → 抛 {@link NoKeyError}。
 *
 * **无 credentials seam 时不抛错**：吞掉后继续往下走，让 env 层有机会接手。
 * @module dsh-ds-balance/services/key-resolver
 */

import { NoKeyError } from '../domain/errors.js'
import type { Credentials } from '../ports/credentials.js'
import type { Logger } from '../ports/logger.js'

/** 每次解析时现读的配置切片。 */
export interface KeyResolverConfig {
  apiKey: string
  apiKeyRef: string
}

/** 构造参数。 */
export interface KeyResolverOptions {
  /** 现读配置。**不许缓存** —— 用户改了要立刻生效。 */
  readConfig: () => KeyResolverConfig
  /** 凭据服务；装配里可能没有。 */
  credentials?: Credentials | undefined
  /** 环境变量表；默认 `process.env`。 */
  env?: Record<string, string | undefined>
  logger?: Logger | undefined
  /** 引用名合法性校验；默认用契约里的正则。 */
  isValidRef?: (ref: string) => boolean
}

/** 契约要求的引用名形状。 */
export const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 把未知异常压成一行。 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 解析当前可用的明文密钥。 */
export class KeyResolver {
  private readonly options: KeyResolverOptions

  constructor(options: KeyResolverOptions) {
    this.options = options
  }

  /**
   * 走完整条解析链。
   * @returns 明文密钥。**调用方负责不把它写进日志或消息。**
   * @throws {NoKeyError} 整条链都没取到值。
   */
  async resolve(): Promise<string> {
    const config = this.options.readConfig()

    const override = config.apiKey.trim()
    if (override !== '') return override

    const ref = config.apiKeyRef.trim()
    if (ref === '') throw new NoKeyError('no API key: both apiKey and apiKeyRef are empty')

    const isValid = this.options.isValidRef ?? ((value: string): boolean => CREDENTIAL_REF_PATTERN.test(value))
    if (!isValid(ref)) {
      throw new NoKeyError(`no API key: apiKeyRef ${JSON.stringify(ref)} is not a valid credential reference`)
    }

    if (this.options.credentials !== undefined) {
      try {
        const resolved = await this.options.credentials.resolve(ref)
        const value = (resolved?.value ?? '').trim()
        if (value !== '') return value
      } catch (error) {
        // 没有 seam、引用名不存在、远程拒绝 —— 都只是「这一档没取到」，继续往下走。
        this.options.logger?.debug('ds-balance: credentials.resolve did not yield a key, falling back to env', {
          ref,
          error: describe(error),
        })
      }
    }

    const env = this.options.env ?? process.env
    const fromEnv = (env[ref] ?? '').trim()
    if (fromEnv !== '') return fromEnv

    throw new NoKeyError(`no API key: ${ref} is not configured`)
  }
}

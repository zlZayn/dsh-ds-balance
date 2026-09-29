/**
 * 宿主账号服务 → {@link AccountSource}。
 *
 * 这是**可选**接缝：`apply` 里由 `ctx.inject(['deepseekAccount'], …)` 把门，服务缺席时整个对象
 * 不存在，插件退回只看 API Key。
 *
 * 服务面用**鸭子类型**收窄而不是 import 宿主类型：`ctx.deepseekAccount` 的类型来自
 * `@deepseek-ai/dsh-deepseek-account`，而运行时提供方是 `-account-platform` —— 引类型要多挂一个包，
 * 而这里只用到三个方法。运行期关系由 `ctx.inject` 表达，声明面由 `peerDependencies` 表达。
 * @module dsh-ds-balance/adapters/host-account
 */

import type { AccountBalance, AccountWallet } from '../domain/account.js'
import { UpstreamError, describeError } from '../domain/errors.js'
import type { AccountSource } from '../ports/account.js'
import type { Logger } from '../ports/logger.js'

/** 宿主单次余额查询的结果形状（对齐 `AccountDetails['balance']`）。 */
export type HostAccountBalance =
  | {
      readonly status: 'ready'
      readonly value: readonly AccountWallet[]
      readonly bonusWallets: readonly AccountWallet[]
    }
  | { readonly status: 'failed' }

/** 宿主为这次调用要的客户端标识（对齐 `AccountClientMetadata`）。 */
export interface HostAccountClient {
  readonly version: string
  readonly locale: string
  readonly timezoneOffsetSeconds: number
}

/**
 * 宿主账号服务的最小面。
 *
 * 三个方法的语义逐字对齐宿主 `DeepSeekAccount` 的公开面；`null` 一律表示**此刻没有可用账号**
 * （未登录，或凭据在查询途中被换掉），不是「余额为零」。
 */
export interface HostAccountFace {
  getState(): Promise<{ readonly status?: string } | undefined>
  getBalance(client: HostAccountClient): Promise<HostAccountBalance | null>
  getPlatformSession(): Promise<{ readonly userId?: string | null } | null>
}

/** 构造参数。 */
export interface HostAccountOptions {
  service: HostAccountFace
  /** 上报给 Platform 的客户端版本；用插件版本，与响应里回传的那个同源。 */
  version: string
  /** 上报给 Platform 的语言；只选服务端文案，界面文案由本插件自己的词典给。 */
  locale?: string
  /** 上报给 Platform 的时区偏移（秒，东为正）。 */
  timezoneOffsetSeconds?: () => number
  logger?: Logger | undefined
}

/**
 * 把宿主账号服务收窄成 {@link AccountSource}。
 *
 * `readBalance` 的三种结果各有去处，**不合并**：
 * - `null` → 回 `null`，上层回落另一条取数路；
 * - `failed` → 抛 `UpstreamError`，**不回落**（回落只会把真因换成更难懂的 `NO_KEY`）；
 * - `ready` → 原样交出去。
 * @param options - 宿主服务与客户端标识。
 * @returns 端口实现。
 */
export function createAccountSource(options: HostAccountOptions): AccountSource {
  const { service } = options
  const client = (): HostAccountClient => ({
    version: options.version,
    locale: options.locale ?? 'zh-CN',
    timezoneOffsetSeconds: options.timezoneOffsetSeconds?.() ?? 0,
  })

  return {
    async signedIn() {
      try {
        const state = await service.getState()
        return state?.status === 'credential-stored'
      } catch (error) {
        options.logger?.debug('ds-balance: account state unreadable', {
          error: describeError(error),
        })
        return false
      }
    },

    async accountId() {
      try {
        const session = await service.getPlatformSession()
        const id = session?.userId
        return typeof id === 'string' && id !== '' ? id : null
      } catch (error) {
        options.logger?.debug('ds-balance: account identity unreadable', {
          error: describeError(error),
        })
        return null
      }
    },

    async readBalance(): Promise<AccountBalance | null> {
      const result = await service.getBalance(client())
      if (result === null) return null
      if (result.status === 'failed') {
        // 502 只是给分类用的：账号服务的查询失败属于上游不可用，不是「没有额度」。
        throw new UpstreamError(502, 'account balance query failed')
      }
      return { wallets: result.value, bonusWallets: result.bonusWallets }
    },
  }
}

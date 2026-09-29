/**
 * 账号登录态端口。
 *
 * 宿主提供这条接缝（`ctx.deepseekAccount`）时才装配；**缺席时账号那条取数路整条不存在**，
 * 插件退回只看 API Key —— 与没有这条接缝之前逐字相同。
 * @module dsh-ds-balance/ports/account
 */

import type { AccountBalance } from '../domain/account.js'

/** 账号来源的只读面。没有写入口：余额只是读。 */
export interface AccountSource {
  /** 本地存着登录凭据（宿主原文：存储态，不代表服务端验过）。 */
  signedIn(): Promise<boolean>
  /**
   * 稳定账号 id：作为账号账本的派生输入。
   *
   * 拿不到时回 `null`（宿主本次进程还没读过 profile），调用方按「未知账号」处理。
   */
  accountId(): Promise<string | null>
  /**
   * 读一次钱包。
   *
   * `null` 表示**此刻没有可用账号**（未登录，或凭据在查询途中被换掉）——
   * 调用方据此回落另一条路，而不是把它当成零余额。
   */
  readBalance(): Promise<AccountBalance | null>
}

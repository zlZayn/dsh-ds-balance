/**
 * 快照存储端口。实现走 dsh 官方存储接缝，见 docs/backend-architecture.md §10。
 * @module dsh-ds-balance/ports/core-store
 */

import type { BalanceSnapshot } from '../domain/balance.js'

/** 端口健康。 */
export interface StoreHealth {
  ok: boolean
  detail?: string
}

/** 快照持久化。 */
export interface CoreStore {
  /** 追加一条快照。 */
  saveSnapshot(snapshot: BalanceSnapshot): Promise<void>

  /**
   * 读取该账本最近一条快照。
   *
   * **必须按 `accountTag` 过滤**：凭据轮换后 tag 会变，旧快照不得混用。
   * @param accountTag - 账本作用域标识。
   * @returns 最近一条快照，或 `null` 表示该账本还没有记录。
   */
  loadLatestSnapshot(accountTag: string): Promise<BalanceSnapshot | null>

  /** 端口自检。 */
  health(): Promise<StoreHealth>

  /** 释放存储句柄。**必须由调用方在 `ctx.effect` 的 disposer 里调用。** */
  close(): Promise<void>
}

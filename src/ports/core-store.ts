/**
 * 快照存储端口。实现走 dsh 官方存储接缝，见 docs/BACKEND-CONTRACTS.md §10。
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

  /**
   * 只保留该账本最近 `keepN` 条快照，删掉更旧的。
   *
   * 与 {@link loadLatestSnapshot} 同构：两个都是 **tag 作用域**的操作 ——
   * 「按账本分桶、只动自己那个桶」这条语义由本端口统一承担，调用方不必知道记录怎么组织。
   *
   * **`keepN` 由调用方（领域层）传入**：端口只执行「留几条」，不决定该留几条 ——
   * 那是领域层的策略。端口也不暴露实现步骤（分几批删、批间隔多久、怎么排序）。
   *
   * **只动 `accountTag` 这一个桶**：别的账本一条都不许碰。
   * @param accountTag - 要修剪的账本。
   * @param keepN - 该账本要保留的条数（新到旧）。
   * @returns 实际删掉的条数；`0` 表示本来就没超期（**必须是零写入的幂等操作**）。
   */
  pruneByTag(accountTag: string, keepN: number): Promise<number>

  /** 端口自检。 */
  health(): Promise<StoreHealth>

  /** 释放存储句柄。**必须由调用方在 `ctx.effect` 的 disposer 里调用。** */
  close(): Promise<void>
}

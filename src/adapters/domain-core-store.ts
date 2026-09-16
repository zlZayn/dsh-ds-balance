/**
 * 用 dsh 官方存储接缝实现 {@link CoreStore}。
 *
 * 关键约束（见 docs/backend-architecture.md §10）：
 * - `open` 每进程只能一次，重名抛 `already-open`；
 * - **`close()` 必须由调用方在 `ctx.effect` 的 disposer 里调用**，否则热重挂会锁死；
 * - 打开失败要**降级**而不是抛出去 —— 未观察的 rejection 曾把宿主整个拖下水。
 * @module dsh-ds-balance/adapters/domain-core-store
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { BalanceInfo, BalanceSnapshot } from '../domain/balance.js'
import { StorageError } from '../domain/errors.js'
import { formatMoney, parseMoney } from '../domain/money.js'
import type { CoreStore, StoreHealth } from '../ports/core-store.js'
import type { Logger } from '../ports/logger.js'

/** 域里的表名。 */
export const SNAPSHOT_TABLE = 'snapshots'

/** 域记录：JSON 安全形状，金额存字符串最小单位。 */
export interface StoredSnapshot {
  snapshotId: string
  accountTag: string
  fetchedAt: number
  isAvailable: boolean
  balances: Array<{ currency: string; total: string; granted: string; toppedUp: string }>
  source: 'deepseek-http'
}

const storedBalanceSchema = z.object({
  currency: z.string(),
  total: z.string(),
  granted: z.string(),
  toppedUp: z.string(),
})

const storedSnapshotSchema = z.object({
  snapshotId: z.string(),
  accountTag: z.string(),
  fetchedAt: z.number(),
  isAvailable: z.boolean(),
  balances: z.array(storedBalanceSchema),
  source: z.literal('deepseek-http'),
})

/**
 * 域声明。
 *
 * `backend` **不写**：路由归部署方（默认组合只有 json 后端），插件无权指定。
 */
export const DS_BALANCE_DOMAIN = defineDomain({
  name: 'ds_balance',
  version: 1,
  tables: {
    [SNAPSHOT_TABLE]: domainTable<string, StoredSnapshot>(storedSnapshotSchema as unknown as z.ZodType<StoredSnapshot>),
  },
})

/** 表句柄的最小结构化面；测试用替身实现它。 */
export interface KvTableLike {
  get(key: string): StoredSnapshot | undefined
  keys(): IterableIterator<string>
  put(key: string, value: StoredSnapshot): Promise<void>
}

/** 域句柄的最小结构化面。 */
export interface DomainLike {
  table(name: string): KvTableLike
  close(): Promise<void>
}

/** 打开域的函数；生产里传 `(spec) => ctx.storageDomain.open(spec)`。 */
export type DomainOpener = (spec: typeof DS_BALANCE_DOMAIN) => Promise<DomainLike>

/** 构造参数。 */
export interface DomainCoreStoreOptions {
  open: DomainOpener
  logger?: Logger
}

/** 把领域快照转成可 JSON 化的记录。 */
export function toStored(snapshot: BalanceSnapshot): StoredSnapshot {
  return {
    snapshotId: snapshot.snapshotId,
    accountTag: snapshot.accountTag,
    fetchedAt: snapshot.fetchedAt,
    isAvailable: snapshot.isAvailable,
    balances: snapshot.balances.map((item) => ({
      currency: item.currency,
      total: formatMoney(item.total),
      granted: formatMoney(item.granted),
      toppedUp: formatMoney(item.toppedUp),
    })),
    source: snapshot.source,
  }
}

/** 把记录还原成领域快照。金额坏掉时抛 `ParseError`，绝不静默归零。 */
export function fromStored(record: StoredSnapshot): BalanceSnapshot {
  const balances: BalanceInfo[] = record.balances.map((item) => ({
    currency: item.currency,
    total: parseMoney(item.total),
    granted: parseMoney(item.granted),
    toppedUp: parseMoney(item.toppedUp),
  }))
  return {
    snapshotId: record.snapshotId,
    accountTag: record.accountTag,
    fetchedAt: record.fetchedAt,
    isAvailable: record.isAvailable,
    balances,
    source: record.source,
    raw: undefined,
  }
}

/** 把未知异常压成一行可读文本。 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 官方存储接缝上的快照存储。
 *
 * 构造期**永不抛错**：打开失败被吸收成降级状态，之后每次操作按调用返回
 * {@link StorageError}。这样 `ready` 永远 resolve，await 它本身不会变成
 * 那个把宿主拖下水的未观察 rejection。
 */
export class DomainCoreStore implements CoreStore {
  private readonly options: DomainCoreStoreOptions
  private readonly ready: Promise<void>
  private handle: DomainLike | null = null
  private table: KvTableLike | null = null
  private openError: unknown
  private closed = false

  constructor(options: DomainCoreStoreOptions) {
    this.options = options
    this.ready = this.initialize().catch((error: unknown) => {
      this.openError = error
      options.logger?.error('ds-balance: storage domain unavailable, running degraded', { error: describe(error) })
    })
  }

  private async initialize(): Promise<void> {
    const handle = await this.options.open(DS_BALANCE_DOMAIN)
    this.handle = handle
    this.table = handle.table(SNAPSHOT_TABLE)
  }

  /** 拿到可用表，或在降级状态下抛出可读错误。 */
  private async requireTable(): Promise<KvTableLike> {
    await this.ready
    if (this.openError !== undefined) {
      throw new StorageError(`storage domain unavailable: ${describe(this.openError)}`, { cause: this.openError })
    }
    if (this.table === null) throw new StorageError('storage domain is not open')
    return this.table
  }

  async saveSnapshot(snapshot: BalanceSnapshot): Promise<void> {
    const table = await this.requireTable()
    await table.put(snapshot.snapshotId, toStored(snapshot))
  }

  /**
   * 读该账本最近一条快照。
   *
   * **按 `accountTag` 过滤**：凭据轮换后 tag 会变，旧快照不得混用。
   * 用 `snapshotId`（单调可排序）决定新旧，不依赖 `fetchedAt`。
   */
  async loadLatestSnapshot(accountTag: string): Promise<BalanceSnapshot | null> {
    const table = await this.requireTable()
    let newest: StoredSnapshot | null = null
    for (const key of table.keys()) {
      const record = table.get(key)
      if (record === undefined || record.accountTag !== accountTag) continue
      if (newest === null || record.snapshotId > newest.snapshotId) newest = record
    }
    return newest === null ? null : fromStored(newest)
  }

  async health(): Promise<StoreHealth> {
    await this.ready
    return this.openError === undefined ? { ok: true } : { ok: false, detail: describe(this.openError) }
  }

  /** 幂等关闭。**必须挂在 `ctx.effect` 的 disposer 上。** */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.ready
    const handle = this.handle
    this.handle = null
    this.table = null
    if (handle !== null) await handle.close()
  }
}

/**
 * 用 dsh 官方存储接缝实现 {@link CoreStore}。
 *
 * 关键约束（见 docs/BACKEND-ARCHITECTURE.md §10）：
 * - `open` 每进程只能一次，重名抛 `already-open`；
 * - **`close()` 必须由调用方在 `ctx.effect` 的 disposer 里调用**，否则热重挂会锁死；
 * - 打开失败要**降级**而不是抛出去 —— 未观察的 rejection 曾把宿主整个拖下水。
 * @module dsh-ds-balance/adapters/domain-core-store
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  SNAPSHOT_KEEP_N,
  type BalanceInfo,
  type BalanceSnapshot,
  type BalanceSource,
} from '../domain/balance.js'
import { StorageError, describeError } from '../domain/errors.js'
import { formatMoney, parseMoney } from '../domain/money.js'
import type { CoreStore, StoreHealth } from '../ports/core-store.js'
import type { Logger } from '../ports/logger.js'

/** 域里的表名。 */
export const SNAPSHOT_TABLE = 'snapshots'

/**
 * 修剪时每批删多少条，之后让出一次事件循环。
 *
 * **实现细节，不上端口**：领域层只调一次 `pruneByTag`，不需要知道分了几批。
 * 取值只是「别让一批太大」的粗界，真实瓶颈是单布局下的整份重写次数，
 * 所以调大调小不影响正确性，只影响同进程别的活被挤住多久。
 */
const PRUNE_BATCH_SIZE = 40

/**
 * 单次修剪最多删多少条，**之后剩下的交给后续启动或写入路径**。
 *
 * **为什么需要上界**：`single` 布局下每次 `delete` 都要原子重写整份单元文件，
 * 而「删掉一批」的开销随文件体积线性涨。首次升级时存量可能很大（本机实测 9000 条 /
 * 3.8 MB），若一次性清空就是数千次整份重写，**会把宿主连同 Agent 一起卡死**
 * —— 实测现象是侧栏无限转圈、Agent 停止响应，清空数据后立刻恢复。
 *
 * 这个数是**实现约束**不是领域策略：领域层只说「留几条」，「一次最多删多少」
 * 属于「别把自己卡死」的工程判断，所以不上端口（与批次大小同理）。
 *
 * 取 500 的依据：配合 {@link PRUNE_BATCH_SIZE} 是 12.5 批，批次边界清晰；
 * 收敛靠**多次启动叠加**而不是一次删完 —— 清到 20 条这个终态是幂等的，
 * 每次启动删一批，未删完的下次继续。
 */
const PRUNE_MAX_PER_CALL = 500

/** 域记录：JSON 安全形状，金额存字符串最小单位。 */
export interface StoredSnapshot {
  snapshotId: string
  accountTag: string
  fetchedAt: number
  isAvailable: boolean
  balances: Array<{ currency: string; total: string; granted: string; toppedUp: string }>
  source: BalanceSource
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
  // **取值只增不改**：域版本一动，已落盘的账本会在 open 时直接 `version-mismatch` 拒开。
  // 旧记录里只有 `deepseek-http`，它必须一直是合法值。
  source: z.enum(['deepseek-http', 'deepseek-account']),
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
    [SNAPSHOT_TABLE]: domainTable<string, StoredSnapshot>(
      storedSnapshotSchema as unknown as z.ZodType<StoredSnapshot>,
    ),
  },
})

/** 表句柄的最小结构化面；测试用替身实现它。 */
export interface KvTableLike {
  get(key: string): StoredSnapshot | undefined
  /** 一次迭代同时拿到 `[key, record]`；比 `keys()` +逐键 `get()` 少一轮查找。 */
  entries(): IterableIterator<[string, StoredSnapshot]>
  keys(): IterableIterator<string>
  put(key: string, value: StoredSnapshot): Promise<void>
  delete(key: string): Promise<boolean>
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

/**
 * 官方存储接缝上的快照存储。
 *
 * 构造期**永不抛错**，而且**打开是懒的、失败可重试**：
 *
 * - **懒打开**：`storageDomain` 可能在插件装载之后才就绪；构造期就打开会把一次
 *   过早的失败永久钉死。第一次用到时才开。
 * - **失败可重试**：一轮打开失败只记一次 error，之后每次操作重新试一次；
 *   服务后到了就自动接上，不必重挂插件。
 * - **永不产生未观察的 rejection**：`ensureOpen` 返回的 promise 永远 resolve，
 *   错误记在 `openError` 上，由调用方按需翻成 {@link StorageError}。
 *   已装插件的注释说，逃出去的 rejection 曾经能把整个宿主拖下水。
 */
export class DomainCoreStore implements CoreStore {
  private readonly options: DomainCoreStoreOptions
  /** 正在进行的这一轮打开；成功后常驻，失败后置回 `null` 以便重试。 */
  private ready: Promise<void> | null = null
  private handle: DomainLike | null = null
  private table: KvTableLike | null = null
  private openError: unknown
  /** 打开失败只记一次日志，免得每次操作都刷屏。 */
  private openFailureLogged = false
  private closed = false

  constructor(options: DomainCoreStoreOptions) {
    this.options = options
  }

  /** 确保域已打开。**永不 reject。** */
  private ensureOpen(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.ready === null) {
      const attempt = this.initialize().catch((error: unknown) => {
        this.openError = error
        this.handle = null
        this.table = null
        this.ready = null
        if (!this.openFailureLogged) {
          this.openFailureLogged = true
          this.options.logger?.error('ds-balance: storage domain unavailable, running degraded', {
            error: describeError(error),
          })
        }
      })
      this.ready = attempt
    }
    return this.ready
  }

  private async initialize(): Promise<void> {
    const handle = await this.options.open(DS_BALANCE_DOMAIN)
    this.handle = handle
    this.table = handle.table(SNAPSHOT_TABLE)
    this.openError = undefined
    // 首次升级的一次性清理：必须在**任何读取之前**做，否则首次
    // loadLatestSnapshot 仍要面对存量的大文件。等下一次抓取再清太晚 ——
    // 那正是「保留策略只在稳态有效、首次升级要等两小时」那个盲区。
    await this.pruneAllLedgersOnOpen(SNAPSHOT_KEEP_N)
  }

  /** 拿到可用表，或在降级状态下抛出可读错误。 */
  private async requireTable(): Promise<KvTableLike> {
    await this.ensureOpen()
    if (this.openError !== undefined) {
      throw new StorageError(`storage domain unavailable: ${describeError(this.openError)}`, {
        cause: this.openError,
      })
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
   *
   * **走 `entries()` 而不是 `keys()` + 逐键 `get()`**：后者是每条记录两次查找，
   * 记录数涨上去（保留策略落地前实测过千条）时白费一大半；`entries()` 一次迭代给全。
   */
  async loadLatestSnapshot(accountTag: string): Promise<BalanceSnapshot | null> {
    const table = await this.requireTable()
    let newest: StoredSnapshot | null = null
    for (const [, record] of table.entries()) {
      if (record.accountTag !== accountTag) continue
      if (newest === null || record.snapshotId > newest.snapshotId) newest = record
    }
    return newest === null ? null : fromStored(newest)
  }

  /**
   * 只保留该账本最近 `keepN` 条，删掉更旧的（跨账本不动）。
   *
   * **批间让出事件循环的理由是摊平写放大，不是防限流**：宿主 json 后端默认 `single`
   * 布局，每次 `delete` 都要原子重写整份单元文件。删几十条若挤在同一个 tick 上，
   * 会连带把同一进程里的取数与轮询一起拖住。所以内部**分批 + 每批之后让出一次** ——
   * 批次大小与间隔属于实现细节，不上端口（领域层只调一次，不需要知道分了几批）。
   *
   * **单次最多删 {@link PRUNE_MAX_PER_CALL} 条**：超出部分留给后续启动或写入路径，
   * 保证任何一次调用的耗时都有确定上界（理由见那个常量）。
   *
   * **零写入的幂等**：没超期时一条都不删、返回 0（超期判定先做完再动手）。
   *
   * @param accountTag - 要修剪的账本。
   * @param keepN - 保留条数（新到旧）。
   * @returns 本次**实际**删掉的条数（可能小于超期总数，因为有单次上限）。
   */
  async pruneByTag(accountTag: string, keepN: number): Promise<number> {
    const table = await this.requireTable()
    return this.pruneOwned(table, accountTag, keepN)
  }

  /**
   * 修剪一个账本的内部实现（不重复 `requireTable` 的开表开销）。
   */
  private async pruneOwned(table: KvTableLike, accountTag: string, keepN: number): Promise<number> {
    if (keepN < 0) return 0
    const owned = this.collectOwned(table, accountTag)
    if (owned.length <= keepN) return 0
    // 先按 snapshotId 排好序再决定删哪些：留下的必然是「最新的 keepN 条」，
    // 而刚写入的那条 id 单调最大，所以永远在保留集里。
    const ordered = owned
      .slice()
      .sort((a, b) => (a.snapshotId < b.snapshotId ? -1 : a.snapshotId > b.snapshotId ? 1 : 0))
    const doomed = ordered.slice(0, ordered.length - keepN).slice(0, PRUNE_MAX_PER_CALL)
    await this.deleteInBatches(table, doomed)
    return doomed.length
  }

  /**
   * 启动时的一次性清理：把**所有**账本桶各修剪一次。
   *
   * 为什么扫全表而不是只清「当前那个账本」：启动这一刻还不知道会用哪个 `accountTag`
   * （要等 reader 给），而首次升级的迁移诉求是「把所有攒下来的桶都收一遍」——
   * 只清一个桶的话，凭据轮换出来的旧桶永远清不掉，文件就一直大。
   *
   * **失败绝不影响 open**：清理抛错只记一条 warn。这里抛出去会让
   * `ensureOpen` 判成打开失败，整个存储被打成降级 —— 那比慢更糟。
   * 删到一半也是安全的：清理幂等，下次启动继续。
   */
  private async pruneAllLedgersOnOpen(keepN: number): Promise<void> {
    const table = this.table
    if (table === null) return
    try {
      const buckets = new Map<string, StoredSnapshot[]>()
      for (const [, record] of table.entries()) {
        const bucket = buckets.get(record.accountTag)
        if (bucket === undefined) buckets.set(record.accountTag, [record])
        else bucket.push(record)
      }
      let removed = 0
      let remaining = 0
      for (const accountTag of buckets.keys()) {
        removed += await this.pruneOwned(table, accountTag, keepN)
      }
      for (const bucket of buckets.values()) remaining += Math.min(bucket.length, keepN)
      if (removed > 0) {
        // 进度日志：删了多少、之后大约还剩多少（每次启动还会再删一批，直到收敛）。
        // 没有它，使用者只会看到「数据怎么还在变多」，无从判断清理是否在推进。
        this.options.logger?.debug('ds-balance: pruned stored snapshots on open', {
          removed,
          remainingApprox: remaining,
          buckets: buckets.size,
          keepN,
        })
      }
    } catch (error) {
      // 刻意只记一条 warn：清理是尽力而为，不该把存储打成降级。
      this.options.logger?.warn('ds-balance: startup snapshot prune failed, continuing', {
        error: describeError(error),
      })
    }
  }

  /** 取出属于该账本的全部记录。 */
  private collectOwned(table: KvTableLike, accountTag: string): StoredSnapshot[] {
    const owned: StoredSnapshot[] = []
    for (const [, record] of table.entries()) {
      if (record.accountTag === accountTag) owned.push(record)
    }
    return owned
  }

  /** 分批删除，每批之后让出一次事件循环。 */
  private async deleteInBatches(table: KvTableLike, doomed: StoredSnapshot[]): Promise<void> {
    for (let offset = 0; offset < doomed.length; offset += PRUNE_BATCH_SIZE) {
      const batch = doomed.slice(offset, offset + PRUNE_BATCH_SIZE)
      for (const record of batch) await table.delete(record.snapshotId)
      // 让出一次事件循环：把同 tick 的连续原子重写摊开，别挤住同进程的别的活。
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  async health(): Promise<StoreHealth> {
    if (this.closed) return { ok: false, detail: 'closed' }
    await this.ensureOpen()
    return this.openError === undefined
      ? { ok: true }
      : { ok: false, detail: describeError(this.openError) }
  }

  /** 幂等关闭。**必须挂在 `ctx.effect` 的 disposer 上。** */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const pending = this.ready
    if (pending !== null) await pending
    const handle = this.handle
    this.handle = null
    this.table = null
    if (handle !== null) await handle.close()
  }
}

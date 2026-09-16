import { describe, expect, it, vi } from 'vitest'
import {
  DomainCoreStore,
  SNAPSHOT_TABLE,
  fromStored,
  toStored,
  type DomainLike,
  type KvTableLike,
  type StoredSnapshot,
} from '../src/adapters/domain-core-store.ts'
import { StorageError } from '../src/domain/errors.ts'
import { parseMoney } from '../src/domain/money.ts'
import type { BalanceSnapshot } from '../src/domain/balance.ts'

/** 内存表替身。 */
function fakeTable(): KvTableLike & { rows: Map<string, StoredSnapshot> } {
  const rows = new Map<string, StoredSnapshot>()
  return {
    rows,
    get: (key) => rows.get(key),
    keys: () => rows.keys(),
    put: async (key, value) => { rows.set(key, value) },
  }
}

function fakeDomain(table: KvTableLike): DomainLike & { closed: boolean } {
  let closed = false
  return {
    get closed() { return closed },
    table: (name) => {
      if (name !== SNAPSHOT_TABLE) throw new Error(`unexpected table ${name}`)
      return table
    },
    close: async () => { closed = true },
  }
}

function snapshot(patch: Partial<BalanceSnapshot> = {}): BalanceSnapshot {
  return {
    snapshotId: 'id-1',
    accountTag: 'tag-a',
    fetchedAt: 1000,
    isAvailable: true,
    balances: [{ currency: 'CNY', total: parseMoney('110'), granted: parseMoney('10'), toppedUp: parseMoney('100') }],
    source: 'deepseek-http',
    raw: { anything: true },
    ...patch,
  }
}

describe('记录往返', () => {
  it('金额序列化成字符串最小单位', () => {
    const stored = toStored(snapshot())
    expect(stored.balances[0]).toEqual({
      currency: 'CNY', total: '110.00000000', granted: '10.00000000', toppedUp: '100.00000000',
    })
  })

  it('还原回 bigint', () => {
    const restored = fromStored(toStored(snapshot()))
    expect(restored.balances[0]!.total).toBe(parseMoney('110'))
    expect(restored.accountTag).toBe('tag-a')
  })

  it('记录里不带 raw（不入库大对象）', () => {
    expect(Object.keys(toStored(snapshot()))).not.toContain('raw')
  })
})

describe('DomainCoreStore', () => {
  it('存取往返', async () => {
    const table = fakeTable()
    const store = new DomainCoreStore({ open: async () => fakeDomain(table) })
    await store.saveSnapshot(snapshot())
    const loaded = await store.loadLatestSnapshot('tag-a')
    expect(loaded?.snapshotId).toBe('id-1')
    expect(loaded?.balances[0]!.total).toBe(parseMoney('110'))
  })

  it('没有记录时返回 null', async () => {
    const store = new DomainCoreStore({ open: async () => fakeDomain(fakeTable()) })
    await expect(store.loadLatestSnapshot('tag-a')).resolves.toBeNull()
  })

  it('按 accountTag 过滤，不混用别的账本', async () => {
    const table = fakeTable()
    const store = new DomainCoreStore({ open: async () => fakeDomain(table) })
    await store.saveSnapshot(snapshot({ snapshotId: 'id-1', accountTag: 'tag-a' }))
    await store.saveSnapshot(snapshot({ snapshotId: 'id-2', accountTag: 'tag-b' }))
    expect((await store.loadLatestSnapshot('tag-b'))?.snapshotId).toBe('id-2')
    expect((await store.loadLatestSnapshot('tag-c'))).toBeNull()
  })

  it('取新建的那条，与写入顺序无关', async () => {
    const table = fakeTable()
    const store = new DomainCoreStore({ open: async () => fakeDomain(table) })
    await store.saveSnapshot(snapshot({ snapshotId: 'a-2' }))
    await store.saveSnapshot(snapshot({ snapshotId: 'a-1' }))
    await store.saveSnapshot(snapshot({ snapshotId: 'a-3' }))
    expect((await store.loadLatestSnapshot('tag-a'))?.snapshotId).toBe('a-3')
  })

  it('health 在正常态报 ok', async () => {
    const store = new DomainCoreStore({ open: async () => fakeDomain(fakeTable()) })
    await expect(store.health()).resolves.toEqual({ ok: true })
  })

  it('close 关闭句柄且幂等', async () => {
    const domain = fakeDomain(fakeTable())
    const closeSpy = vi.spyOn(domain, 'close')
    const store = new DomainCoreStore({ open: async () => domain })
    await store.saveSnapshot(snapshot())
    await store.close()
    await store.close()
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(domain.closed).toBe(true)
  })
})

describe('降级模式', () => {
  it('打开失败不抛错，health 报 not ok', async () => {
    const store = new DomainCoreStore({ open: async () => { throw new Error('already-open') } })
    await expect(store.health()).resolves.toEqual({ ok: false, detail: 'already-open' })
  })

  it('降级时每次操作抛 StorageError 而不是未观察的 rejection', async () => {
    const store = new DomainCoreStore({ open: async () => { throw new Error('already-open') } })
    await expect(store.saveSnapshot(snapshot())).rejects.toBeInstanceOf(StorageError)
    await expect(store.loadLatestSnapshot('tag-a')).rejects.toBeInstanceOf(StorageError)
  })

  it('降级时 close 不抛错', async () => {
    const store = new DomainCoreStore({ open: async () => { throw new Error('boom') } })
    await expect(store.close()).resolves.toBeUndefined()
  })

  it('打开失败会记一条 error 日志', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const store = new DomainCoreStore({ open: async () => { throw new Error('already-open') }, logger })
    await store.health()
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls[0]![1]).toEqual({ error: 'already-open' })
  })
})

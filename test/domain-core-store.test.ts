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

/** 内存表替身。`deleteCount` 用来断言「零写入的幂等」——没超期时一条都不该动。 */
function fakeTable(): KvTableLike & {
  rows: Map<string, StoredSnapshot>
  deleteCount: number
} {
  const rows = new Map<string, StoredSnapshot>()
  const table = {
    rows,
    deleteCount: 0,
    get: (key: string) => rows.get(key),
    entries: () => rows.entries(),
    keys: () => rows.keys(),
    put: async (key: string, value: StoredSnapshot) => {
      rows.set(key, value)
    },
    delete: async (key: string) => {
      table.deleteCount += 1
      return rows.delete(key)
    },
  }
  return table
}

function fakeDomain(table: KvTableLike): DomainLike & { closed: boolean } {
  let closed = false
  return {
    get closed() {
      return closed
    },
    table: (name) => {
      if (name !== SNAPSHOT_TABLE) throw new Error(`unexpected table ${name}`)
      return table
    },
    close: async () => {
      closed = true
    },
  }
}

function snapshot(patch: Partial<BalanceSnapshot> = {}): BalanceSnapshot {
  return {
    snapshotId: 'id-1',
    accountTag: 'tag-a',
    fetchedAt: 1000,
    isAvailable: true,
    balances: [
      {
        currency: 'CNY',
        total: parseMoney('110'),
        granted: parseMoney('10'),
        toppedUp: parseMoney('100'),
      },
    ],
    source: 'deepseek-http',
    raw: { anything: true },
    ...patch,
  }
}

describe('记录往返', () => {
  it('金额序列化成字符串最小单位', () => {
    const stored = toStored(snapshot())
    expect(stored.balances[0]).toEqual({
      currency: 'CNY',
      total: '110.00000000',
      granted: '10.00000000',
      toppedUp: '100.00000000',
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
    expect(await store.loadLatestSnapshot('tag-c')).toBeNull()
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

describe('DomainCoreStore.pruneByTag', () => {
  it('只留最新的 keepN 条，删掉更旧的', async () => {
    const store = new DomainCoreStore({ open: async () => fakeDomain(fakeTable()) })
    for (const id of ['a-1', 'a-2', 'a-3', 'a-4', 'a-5']) {
      await store.saveSnapshot(snapshot({ snapshotId: id }))
    }
    await expect(store.pruneByTag('tag-a', 2)).resolves.toBe(3)
    // 留下的必然是最新两条 —— 刚写入的那条 id 单调最大，永远在保留集里。
    expect((await store.loadLatestSnapshot('tag-a'))?.snapshotId).toBe('a-5')
  })

  it('跨账本语义：修剪一个桶，另一个桶一条都不许动', async () => {
    // 这是分桶语义的核心断言：两个 SourceLedger 共享同一个 store 实例，
    // 一条路的保留策略绝不能删掉另一条路的快照。
    const table = fakeTable()
    const store = new DomainCoreStore({ open: async () => fakeDomain(table) })
    for (const id of ['a-1', 'a-2', 'a-3']) {
      await store.saveSnapshot(snapshot({ snapshotId: id, accountTag: 'tag-a' }))
    }
    for (const id of ['b-1', 'b-2']) {
      await store.saveSnapshot(snapshot({ snapshotId: id, accountTag: 'tag-b' }))
    }
    await expect(store.pruneByTag('tag-a', 1)).resolves.toBe(2)
    // tag-a 只剩最新那条；tag-b 原封不动。
    expect((await store.loadLatestSnapshot('tag-a'))?.snapshotId).toBe('a-3')
    expect((await store.loadLatestSnapshot('tag-b'))?.snapshotId).toBe('b-2')
    expect([...table.rows.values()].filter((r) => r.accountTag === 'tag-b')).toHaveLength(2)
  })

  it('没超期时零写入（幂等边界）', async () => {
    const table = fakeTable()
    const store = new DomainCoreStore({ open: async () => fakeDomain(table) })
    for (const id of ['a-1', 'a-2']) {
      await store.saveSnapshot(snapshot({ snapshotId: id }))
    }
    await expect(store.pruneByTag('tag-a', 5)).resolves.toBe(0)
    await expect(store.pruneByTag('tag-a', 2)).resolves.toBe(0)
    // 断言的是「一条都没删」：single 布局下每次 delete 都会重写整份文件。
    expect(table.deleteCount).toBe(0)
  })

  it('空账本与不存在的桶都是零删除', async () => {
    const table = fakeTable()
    const store = new DomainCoreStore({ open: async () => fakeDomain(table) })
    await store.saveSnapshot(snapshot({ snapshotId: 'a-1', accountTag: 'tag-a' }))
    await expect(store.pruneByTag('tag-z', 1)).resolves.toBe(0)
    expect(table.deleteCount).toBe(0)
  })

  it('排序不依赖写入顺序', async () => {
    const store = new DomainCoreStore({ open: async () => fakeDomain(fakeTable()) })
    for (const id of ['a-3', 'a-1', 'a-4', 'a-2']) {
      await store.saveSnapshot(snapshot({ snapshotId: id }))
    }
    await store.pruneByTag('tag-a', 2)
    expect((await store.loadLatestSnapshot('tag-a'))?.snapshotId).toBe('a-4')
  })
})

describe('降级模式', () => {
  it('打开失败不抛错，health 报 not ok', async () => {
    const store = new DomainCoreStore({
      open: async () => {
        throw new Error('already-open')
      },
    })
    await expect(store.health()).resolves.toEqual({ ok: false, detail: 'already-open' })
  })

  it('降级时每次操作抛 StorageError 而不是未观察的 rejection', async () => {
    const store = new DomainCoreStore({
      open: async () => {
        throw new Error('already-open')
      },
    })
    await expect(store.saveSnapshot(snapshot())).rejects.toBeInstanceOf(StorageError)
    await expect(store.loadLatestSnapshot('tag-a')).rejects.toBeInstanceOf(StorageError)
  })

  it('降级时 close 不抛错', async () => {
    const store = new DomainCoreStore({
      open: async () => {
        throw new Error('boom')
      },
    })
    await expect(store.close()).resolves.toBeUndefined()
  })

  it('打开失败会记一条 error 日志', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const store = new DomainCoreStore({
      open: async () => {
        throw new Error('already-open')
      },
      logger,
    })
    await store.health()
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls[0]![1]).toEqual({ error: 'already-open' })
  })
})

describe('懒打开与重试', () => {
  it('构造期不打开：只有用到时才碰 open', async () => {
    const open = vi.fn(async () => fakeDomain(fakeTable()))
    const store = new DomainCoreStore({ open })
    expect(open).not.toHaveBeenCalled()
    await store.loadLatestSnapshot('tag-a')
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('打开失败后重试：服务后到了就自动接上', async () => {
    let attempts = 0
    const table = fakeTable()
    const store = new DomainCoreStore({
      open: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('not ready yet')
        return fakeDomain(table)
      },
    })
    await expect(store.health()).resolves.toEqual({ ok: false, detail: 'not ready yet' })
    await store.saveSnapshot(snapshot())
    await expect(store.health()).resolves.toEqual({ ok: true })
    expect(attempts).toBe(2)
    expect((await store.loadLatestSnapshot('tag-a'))?.snapshotId).toBe('id-1')
  })

  it('打开失败只记一次 error 日志，不随每次操作刷屏', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const store = new DomainCoreStore({
      open: async () => {
        throw new Error('nope')
      },
      logger,
    })
    await store.health()
    await store.health()
    await expect(store.saveSnapshot(snapshot())).rejects.toBeInstanceOf(StorageError)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('close 之后不再尝试打开，health 报 closed', async () => {
    const open = vi.fn(async () => fakeDomain(fakeTable()))
    const store = new DomainCoreStore({ open })
    await store.close()
    await expect(store.health()).resolves.toEqual({ ok: false, detail: 'closed' })
    expect(open).not.toHaveBeenCalled()
  })
})

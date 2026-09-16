import { describe, expect, it, vi } from 'vitest'
import { BalanceService } from '../src/services/balance-service.ts'
import { ConfigService } from '../src/services/config-service.ts'
import { KeyResolver } from '../src/services/key-resolver.ts'
import type { Config } from '../src/config.ts'
import type { BalanceSnapshot } from '../src/domain/balance.ts'
import type { Clock } from '../src/ports/clock.ts'
import type { CoreStore } from '../src/ports/core-store.ts'
import type { DeepSeekClient } from '../src/ports/deepseek-client.ts'
import { NetworkError, UpstreamError } from '../src/domain/errors.ts'

const SALT = 'test-salt'

const defaults: Config = {
  apiKey: '', apiKeyRef: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com',
  serverRefreshSeconds: 60, clientPollSeconds: 30, manualRefreshCooldownSeconds: 30,
  displayCurrency: 'auto', cnyWarn: 10, cnyCritical: 5, usdWarn: 2, usdCritical: 1,
}

const goodRaw = {
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '110.00000000', granted_balance: '10.00000000', topped_up_balance: '100.00000000' },
  ],
}

function harness(configPatch: Partial<Config> = {}, key = 'sk-test') {
  let now = 1_000_000
  const clock: Clock = { now: () => now, timezone: () => 'Asia/Shanghai' }
  const config = new ConfigService({ source: { get: () => ({ ...defaults, ...configPatch }), watch: () => () => {} }, env: {} })
  const keys = new KeyResolver({ readConfig: () => ({ apiKey: key, apiKeyRef: 'DEEPSEEK_API_KEY' }), env: {} })
  const client: DeepSeekClient = {
    fetchBalance: vi.fn().mockResolvedValue(goodRaw),
    testConnection: vi.fn(),
  }
  const store: CoreStore = {
    saveSnapshot: vi.fn().mockResolvedValue(undefined),
    loadLatestSnapshot: vi.fn().mockResolvedValue(null),
    health: vi.fn().mockResolvedValue({ ok: true }),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const service = new BalanceService({ client, store, keys, config, clock, salt: SALT })
  return { service, client, store, clock, setNow: (value: number) => { now = value }, getNow: () => now }
}

describe('成功路径', () => {
  it('拉一次得到 ok 视图', async () => {
    const { service } = harness()
    const view = await service.getView()
    expect(view.state).toBe('ok')
    expect(view.stale).toBe(false)
    expect(view.severity).toBe('ok')
    expect(view.isAvailable).toBe(true)
    expect(view.selected?.currency).toBe('CNY')
    expect(view.selected?.total).toBe(110n * 100_000_000n)
    expect(view.error).toBeNull()
    expect(view.ageMs).toBe(0)
  })

  it('落一条快照到存储', async () => {
    const { service, store } = harness()
    await service.getView()
    expect(store.saveSnapshot).toHaveBeenCalledTimes(1)
  })

  it('阈值随视图一起下发', async () => {
    const { service } = harness({ cnyWarn: 20 })
    const view = await service.getView()
    expect(view.thresholds.CNY!.warn).toBe(20n * 100_000_000n)
  })

  it('窗口内不再打第二次请求', async () => {
    const { service, client } = harness()
    await service.getView()
    await service.getView()
    expect(client.fetchBalance).toHaveBeenCalledTimes(1)
  })

  it('force 会再打一次', async () => {
    const { service, client } = harness()
    await service.getView()
    await service.getView({ force: true })
    expect(client.fetchBalance).toHaveBeenCalledTimes(2)
  })

  it('超过窗口会重拉', async () => {
    const h = harness()
    await h.service.getView()
    h.setNow(h.getNow() + 61_000)
    await h.service.getView()
    expect(h.client.fetchBalance).toHaveBeenCalledTimes(2)
  })

  it('并发调用合并成一次请求', async () => {
    const h = harness()
    const [a, b] = await Promise.all([h.service.getView(), h.service.getView()])
    expect(h.client.fetchBalance).toHaveBeenCalledTimes(1)
    expect(a.state).toBe(b.state)
  })
})

describe('失败路径', () => {
  it('没有快照时是 error', async () => {
    const h = harness()
    ;(h.client.fetchBalance as ReturnType<typeof vi.fn>).mockRejectedValue(new NetworkError('offline'))
    const view = await h.service.getView()
    expect(view.state).toBe('error')
    expect(view.stale).toBe(false)
    expect(view.severity).toBe('unknown')
    expect(view.error?.code).toBe('NO_NETWORK')
    expect(view.error?.retryable).toBe(true)
  })

  it('有快照时转 stale，severity 仍按快照算', async () => {
    const h = harness()
    await h.service.getView()
    ;(h.client.fetchBalance as ReturnType<typeof vi.fn>).mockRejectedValue(new NetworkError('offline'))
    const view = await h.service.getView({ force: true })
    expect(view.state).toBe('stale')
    expect(view.stale).toBe(true)
    expect(view.severity).toBe('ok')
    expect(view.selected?.total).toBe(110n * 100_000_000n)
  })

  it('缺密钥给出 NO_KEY', async () => {
    const h = harness({}, '')
    const view = await h.service.getView()
    expect(view.state).toBe('error')
    expect(view.error?.code).toBe('NO_KEY')
    expect(view.error?.retryable).toBe(false)
  })

  it('连续失败会累加计数', async () => {
    const h = harness()
    ;(h.client.fetchBalance as ReturnType<typeof vi.fn>).mockRejectedValue(new NetworkError('offline'))
    await h.service.getView()
    await h.service.getView({ force: true })
    expect(h.service.status().consecutiveFailures).toBe(2)
  })

  it('成功后计数归零', async () => {
    const h = harness()
    ;(h.client.fetchBalance as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new NetworkError('offline'))
    await h.service.getView()
    expect(h.service.status().consecutiveFailures).toBe(1)
    await h.service.getView({ force: true })
    expect(h.service.status().consecutiveFailures).toBe(0)
  })

  it('429 的 Retry-After 进 status', async () => {
    const h = harness()
    ;(h.client.fetchBalance as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UpstreamError(429, 'slow down', { headers: new Headers({ 'retry-after': '7' }) }),
    )
    await h.service.getView()
    expect(h.service.status().retryAfterMs).toBe(7000)
  })

  it('永不抛错', async () => {
    const h = harness()
    ;(h.client.fetchBalance as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'))
    await expect(h.service.getView()).resolves.toBeTruthy()
  })
})

describe('forceRefresh', () => {
  it('冷却期内不触发', async () => {
    const h = harness()
    await h.service.getView()
    const result = await h.service.forceRefresh('manual')
    expect(result.triggered).toBe(false)
    expect(result.cooldownMs).toBe(30_000)
    expect(h.client.fetchBalance).toHaveBeenCalledTimes(1)
  })

  it('冷却期过后触发', async () => {
    const h = harness()
    await h.service.getView()
    h.setNow(h.getNow() + 31_000)
    const result = await h.service.forceRefresh('manual')
    expect(result.triggered).toBe(true)
    expect(result.joined).toBe(false)
    expect(h.client.fetchBalance).toHaveBeenCalledTimes(2)
  })

  it('没有快照时不受冷却限制', async () => {
    const h = harness()
    ;(h.client.fetchBalance as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new NetworkError('offline'))
    await h.service.getView()
    const result = await h.service.forceRefresh('manual')
    expect(result.triggered).toBe(true)
  })
})

describe('restore', () => {
  const snapshot: BalanceSnapshot = {
    snapshotId: 'x', accountTag: 'whatever', fetchedAt: 1_000_000, isAvailable: true,
    balances: [{ currency: 'CNY', total: 1n, granted: 0n, toppedUp: 1n }],
    source: 'deepseek-http', raw: undefined,
  }

  it('命中且在窗口内是 ok', async () => {
    const h = harness()
    ;(h.store.loadLatestSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(snapshot)
    await h.service.restore()
    expect(h.service.status().state).toBe('ok')
    expect(h.service.status().hasSnapshot).toBe(true)
  })

  it('命中但超窗是 stale', async () => {
    const h = harness()
    ;(h.store.loadLatestSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(snapshot)
    h.setNow(2_000_000)
    await h.service.restore()
    expect(h.service.status().state).toBe('stale')
  })

  it('按账本过滤，命中不了就保持空', async () => {
    const h = harness()
    await h.service.restore()
    expect(h.service.status().state).toBe('empty')
    expect(h.store.loadLatestSnapshot).toHaveBeenCalledWith(expect.any(String))
  })

  it('没有密钥时静默跳过', async () => {
    const h = harness({}, '')
    await expect(h.service.restore()).resolves.toBeUndefined()
    expect(h.store.loadLatestSnapshot).not.toHaveBeenCalled()
  })
})

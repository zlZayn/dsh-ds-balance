import { describe, expect, it, vi } from 'vitest'
import { BalanceService } from '../src/services/balance-service.ts'
import { SourceLedger } from '../src/services/balance-source.ts'
import { accountReader, keyReader } from '../src/services/source-readers.ts'
import { ConfigService } from '../src/services/config-service.ts'
import { KeyResolver } from '../src/services/key-resolver.ts'
import type { Config } from '../src/config.ts'
import type { BalanceSnapshot, BalanceSource } from '../src/domain/balance.ts'
import type { Clock } from '../src/ports/clock.ts'
import type { AccountSource } from '../src/ports/account.ts'
import type { CoreStore } from '../src/ports/core-store.ts'
import type { DeepSeekClient } from '../src/ports/deepseek-client.ts'
import { NetworkError, UpstreamError } from '../src/domain/errors.ts'
import { formatMoney } from '../src/domain/money.ts'
import { ACCOUNT_PROVIDER, DEFAULT_SOURCE, KEY_PROVIDER } from '../src/services/source-selector.ts'
import { MemoryMetrics } from '../src/adapters/memory-metrics.ts'

const SALT = 'test-salt'

const defaults: Config = {
  apiKey: '',
  apiKeyRef: 'DEEPSEEK_API_KEY',
  baseUrl: 'https://api.deepseek.com',
  serverRefreshSeconds: 60,
  clientPollSeconds: 30,
  manualRefreshCooldownSeconds: 30,
  displayCurrency: 'auto',
  cnyWarn: 10,
  cnyCritical: 5,
  usdWarn: 2,
  usdCritical: 1,
}

const goodRaw = {
  is_available: true,
  balance_infos: [
    {
      currency: 'CNY',
      total_balance: '110.00000000',
      granted_balance: '10.00000000',
      topped_up_balance: '100.00000000',
    },
  ],
}

function harness(
  configPatch: Partial<Config> = {},
  key = 'sk-test',
  options: { route?: string | null } = {},
) {
  let now = 1_000_000
  const clock: Clock = { now: () => now, timezone: () => 'Asia/Shanghai' }
  const config = new ConfigService({
    source: { get: () => ({ ...defaults, ...configPatch }), watch: () => () => {} },
    env: {},
  })
  const keys = new KeyResolver({
    readConfig: () => ({ apiKey: key, apiKeyRef: 'DEEPSEEK_API_KEY' }),
    env: {},
  })
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
  /** 账号那条路默认「未登录」：多数用例走 Key，账号用例自己翻这个替身。 */
  const account: AccountSource = {
    signedIn: async () => false,
    accountId: async () => null,
    readBalance: async () => null,
  }
  const ledgers = new Map<BalanceSource, SourceLedger>([
    [
      'deepseek-http',
      new SourceLedger({
        source: 'deepseek-http',
        reader: keyReader({ keys, client, config, salt: SALT }),
        store,
        config,
        clock,
      }),
    ],
    [
      'deepseek-account',
      new SourceLedger({
        source: 'deepseek-account',
        reader: accountReader({ account: () => account, salt: SALT }),
        store,
        config,
        clock,
      }),
    ],
  ])
  // 路由读不到 → 固定顺序（Key 优先），这正是多数用例要的那条路。
  // 指标接上 MemoryMetrics：来源切换计数器是「界面刻意不提示」那条决策的唯一观测出口，
  // 所以它得真的能被断言到（见 mark() 与 .agents/notes/2026-10-01-boundaries-left-as-is.md）。
  const metrics = new MemoryMetrics()
  const service = new BalanceService({
    ledgers,
    routeProvider: () => options.route ?? null,
    metrics,
  })
  return {
    service,
    client,
    store,
    clock,
    account,
    metrics,
    ledgers,
    /** 翻账号那条路的替身：多数用例不关心它，选源用例自己设。 */
    setAccount: (patch: Partial<AccountSource>) => {
      Object.assign(account, patch)
    },
    setNow: (value: number) => {
      now = value
    },
    getNow: () => now,
  }
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
    ;(h.client.fetchBalance as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NetworkError('offline'),
    )
    const view = await h.service.getView()
    expect(view.state).toBe('error')
    expect(view.stale).toBe(false)
    // 「接入了但出错」画叉（unavailable），文案是「读不到余额」—— 与「没接入」分开。
    expect(view.severity).toBe('unavailable')
    expect(view.error?.code).toBe('NO_NETWORK')
    expect(view.error?.retryable).toBe(true)
  })

  it('**两条都抓不到**时一轮最多各打一次 —— 不来回重试（ping-pong）', async () => {
    let accountCalls = 0
    const h = harness({}, 'sk-test')
    vi.mocked(h.client.fetchBalance).mockRejectedValue(new NetworkError('offline'))
    h.setAccount({
      ...signedIn,
      readBalance: async () => {
        accountCalls += 1
        throw new NetworkError('account down')
      },
    })
    await h.service.getView()
    expect(h.client.fetchBalance).toHaveBeenCalledTimes(1)
    expect(accountCalls).toBe(1)
    // 都没有 → 回到默认那条，由它报错（此时才画叉）。
    expect(h.service.activeSource()).toBe(DEFAULT_SOURCE)
  })

  it('手动刷新刷**用户看到的那条**：首选没数据时刷兜底那条', async () => {
    let accountCalls = 0
    const h = harness({}, 'sk-test')
    vi.mocked(h.client.fetchBalance).mockRejectedValue(new NetworkError('offline'))
    h.setAccount({
      ...signedIn,
      readBalance: async () => {
        accountCalls += 1
        return { wallets: [{ currency: 'CNY', balance: '50' }], bonusWallets: [] }
      },
    })
    await h.service.getView() // 展示的是账号那条（兜底）
    expect(h.service.activeSource()).toBe('deepseek-account')
    const before = accountCalls

    const result = await h.service.forceRefresh('manual')
    expect(result.triggered).toBe(true)
    expect(accountCalls).toBe(before + 1) // 刷的是账号
    expect(h.client.fetchBalance).toHaveBeenCalledTimes(1) // Key 那条没有被重复刷
  })

  it('兜底展示之后，调度接着刷**展示的那条** —— 数字才不会停在旧快照', async () => {
    let accountCalls = 0
    const h = harness({}, 'sk-test')
    vi.mocked(h.client.fetchBalance).mockRejectedValue(new NetworkError('offline'))
    h.setAccount({
      ...signedIn,
      readBalance: async () => {
        accountCalls += 1
        return { wallets: [{ currency: 'CNY', balance: '50' }], bonusWallets: [] }
      },
    })
    await h.service.getView()
    const before = accountCalls
    await h.service.refreshActive()
    expect(accountCalls).toBe(before + 1)
    expect(h.service.status().source).toBe('deepseek-account')
  })

  it('**没接入**与**接入了但出错**不是同一个环：没接入是灰环 + ＋', async () => {
    // 一条凭据都没有 → 处境 no-credential（灰环 + 中心＋），文案是「尚未配置凭据」。
    // 注意这里的 `severity === 'unknown'` 只是**契约字段**的值，不再直接决定环的形态：
    // 收起态的环由处境定死（见 client/situation.ts 的形态表），`severity` 只给 gauge 族上色。
    const h = harness({}, '')
    const view = await h.service.getView()
    expect(view.error?.code).toBe('NO_KEY')
    expect(view.severity).toBe('unknown')
    expect(view.source).toBe('deepseek-http')
  })

  it('有快照时转 stale，severity 仍按快照算', async () => {
    const h = harness()
    await h.service.getView()
    ;(h.client.fetchBalance as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NetworkError('offline'),
    )
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
    ;(h.client.fetchBalance as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NetworkError('offline'),
    )
    await h.service.getView()
    await h.service.getView({ force: true })
    expect(h.service.status().consecutiveFailures).toBe(2)
  })

  it('成功后计数归零', async () => {
    const h = harness()
    ;(h.client.fetchBalance as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new NetworkError('offline'),
    )
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
  it('自动抓取不占用手动冷却：点了就真的抓', async () => {
    // 锚点曾经是 `snapshot.fetchedAt`，于是调度每 60 秒一次的自动刷新会把用户刚按下的一下吞掉 ——
    // 界面转了圈、倒计时也走了，上游一次没打。
    const h = harness()
    await h.service.getView()
    const result = await h.service.forceRefresh('manual')
    expect(result.triggered).toBe(true)
    expect(h.client.fetchBalance).toHaveBeenCalledTimes(2)
  })

  it('手动刷新自己占冷却：连点第二下不触发', async () => {
    const h = harness()
    const first = await h.service.forceRefresh('manual')
    expect(first.triggered).toBe(true)
    const second = await h.service.forceRefresh('manual')
    expect(second.triggered).toBe(false)
    expect(second.cooldownMs).toBe(30_000)
    expect(h.client.fetchBalance).toHaveBeenCalledTimes(1)
  })

  it('剩余时间按「上一次手动刷新」算，不按上一次抓取', async () => {
    const h = harness()
    await h.service.forceRefresh('manual')
    h.setNow(h.getNow() + 10_000)
    const result = await h.service.forceRefresh('manual')
    expect(result.triggered).toBe(false)
    expect(result.cooldownMs).toBe(20_000)
  })

  it('冷却期过后触发', async () => {
    const h = harness()
    await h.service.forceRefresh('manual')
    h.setNow(h.getNow() + 31_000)
    const result = await h.service.forceRefresh('manual')
    expect(result.triggered).toBe(true)
    expect(result.joined).toBe(false)
    expect(h.client.fetchBalance).toHaveBeenCalledTimes(2)
  })

  it('第一次手动刷新不受冷却限制（失败态也一样）', async () => {
    const h = harness()
    ;(h.client.fetchBalance as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new NetworkError('offline'),
    )
    await h.service.getView()
    const result = await h.service.forceRefresh('manual')
    expect(result.triggered).toBe(true)
  })
})

/** 账号那条路的替身：已登录、有 50 元充值。 */
const signedIn = {
  signedIn: async () => true,
  accountId: async () => 'user-1',
  readBalance: async () => ({
    wallets: [{ currency: 'CNY', balance: '50.00000000' }],
    bonusWallets: [],
  }),
}

describe('选源', () => {
  it('路由点名账号、账号已登录 → 这一份数字来自账号', async () => {
    const h = harness({}, 'sk-test', { route: ACCOUNT_PROVIDER })
    h.setAccount(signedIn)
    const view = await h.service.getView()
    expect(view.source).toBe('deepseek-account')
    expect(h.service.activeSource()).toBe('deepseek-account')
    // 账号那条路不打官方余额端点。
    expect(h.client.fetchBalance).not.toHaveBeenCalled()
    expect(formatMoney(view.selected!.total, 2)).toBe('50.00')
  })

  it('路由点名账号、但账号没登录 → 回落 Key，不空转', async () => {
    const h = harness({}, 'sk-test', { route: ACCOUNT_PROVIDER })
    const view = await h.service.getView()
    expect(view.source).toBe('deepseek-http')
    expect(h.client.fetchBalance).toHaveBeenCalledTimes(1)
  })

  it('别家供应商 → 固定顺序：Key 优先，哪怕账号也在', async () => {
    const h = harness({}, 'sk-test', { route: 'opencode-go' })
    h.setAccount(signedIn)
    const view = await h.service.getView()
    expect(view.source).toBe('deepseek-http')
  })

  it('会话提示优先于全局默认路由，且切提示就切来源', async () => {
    const h = harness({}, 'sk-test', { route: 'other' })
    h.setAccount(signedIn)
    expect((await h.service.getView({ providerHint: ACCOUNT_PROVIDER })).source).toBe(
      'deepseek-account',
    )
    expect((await h.service.getView({ providerHint: KEY_PROVIDER })).source).toBe('deepseek-http')
    expect(h.service.activeSource()).toBe('deepseek-http')
  })

  it('两条路各记各的状态：一条失败不影响另一条', async () => {
    const h = harness({}, 'sk-test', { route: ACCOUNT_PROVIDER })
    h.setAccount(signedIn)
    await h.service.getView()
    expect(h.service.status().state).toBe('ok')
    // 切回 Key 那条：它自己的状态还是空的，不该继承账号那条的 ok。
    await h.service.getView({ providerHint: KEY_PROVIDER })
    expect(h.service.status().hasSnapshot).toBe(true)
    expect(h.service.status().source).toBe('deepseek-http')
  })

  it('定时刷新只刷当前活跃来源，不重新解析', async () => {
    const h = harness({}, 'sk-test', { route: ACCOUNT_PROVIDER })
    h.setAccount(signedIn)
    await h.service.getView({ providerHint: ACCOUNT_PROVIDER })
    await h.service.refreshActive()
    expect(h.service.activeSource()).toBe('deepseek-account')
    expect(h.client.fetchBalance).not.toHaveBeenCalled()
  })

  it('来源还没定过时，调度自己解析一次', async () => {
    const h = harness({}, 'sk-test', { route: ACCOUNT_PROVIDER })
    h.setAccount(signedIn)
    await h.service.refreshActive()
    expect(h.service.activeSource()).toBe('deepseek-account')
  })

  it('服务晚到：作废「已定」之后再刷就切到刚到位的那条', async () => {
    // 宿主刚起来时账号服务还没到，那次解析只能按兜底走（这台机器没有 Key → 报 NO_KEY）；
    // 服务到齐后装配处会 invalidateSource() + 重排一轮，这里守的就是那一步。
    const h = harness({}, '', { route: ACCOUNT_PROVIDER })
    await h.service.refreshActive()
    expect(h.service.activeSource()).toBe('deepseek-http')
    h.setAccount(signedIn)
    h.service.invalidateSource()
    await h.service.refreshActive()
    expect(h.service.activeSource()).toBe('deepseek-account')
  })

  it('服务晚到：不作废也会自愈 —— 下一轮发现活跃来源不可用就重判', async () => {
    // 真机上「账号服务已注册、凭据还没读出来」是常态：那一刻 signedIn() 还是 false。
    // 所以自愈不能只靠到达事件，必须落在每一轮的判据上。
    const h = harness({}, '', { route: ACCOUNT_PROVIDER })
    await h.service.refreshActive()
    expect(h.service.activeSource()).toBe('deepseek-http')
    h.setAccount(signedIn)
    await h.service.refreshActive()
    expect(h.service.activeSource()).toBe('deepseek-account')
  })

  it('来源切换记一个计数器 —— 界面刻意不提示，这是唯一观测出口', async () => {
    const h = harness({}, '', { route: ACCOUNT_PROVIDER })
    // 首轮：路由指账号但账号不可用 → 落 Key 那条（从默认值切过去，记一笔）。
    await h.service.refreshActive()
    expect(h.service.activeSource()).toBe('deepseek-http')
    h.setAccount(signedIn)
    await h.service.refreshActive()
    expect(h.service.activeSource()).toBe('deepseek-account')
    // 标签按键名排序，所以键的形状是确定的。
    const counters = h.metrics.snapshot().counters
    const key = 'balance_source_switch_total{from=deepseek-http,to=deepseek-account}'
    expect(counters[key], Object.keys(counters).join(' | ')).toBe(1)
  })

  it('没切换就不记 —— 计数器不能变成「每轮都涨」', async () => {
    const h = harness()
    await h.service.refreshActive()
    await h.service.refreshActive()
    const switches = Object.keys(h.metrics.snapshot().counters).filter((k) =>
      k.startsWith('balance_source_switch_total'),
    )
    expect(switches).toEqual([])
  })
})

describe('restore', () => {
  const snapshot: BalanceSnapshot = {
    snapshotId: 'x',
    accountTag: 'whatever',
    fetchedAt: 1_000_000,
    isAvailable: true,
    balances: [{ currency: 'CNY', total: 1n, granted: 0n, toppedUp: 1n }],
    source: 'deepseek-http',
    raw: undefined,
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

  it('账本标识拿不到（tag() 抛错）时静默跳过，不查存储、不影响后续', async () => {
    // 这条守的是 accountId 读不到时的路径：tag() 抛 NoKeyError → restore() 吸收 →
    // 不去查存储、状态保持 empty，且账本仍能正常走下一次抓取。
    const h = harness()
    const ledger = h.ledgers.get('deepseek-account')
    expect(ledger).toBeDefined()
    await expect(ledger?.restore()).resolves.toBeUndefined()
    expect(h.service.status().state).toBe('empty')
    // 关键：吸收之后这条账本没被卡死，下一轮照常取数。
    const view = await h.service.getView()
    expect(view.state).toBe('ok')
  })
})

describe('存储降级', () => {
  it('落盘失败不算抓取失败：快照留在内存，状态仍是 ok', async () => {
    const h = harness()
    vi.mocked(h.store.saveSnapshot).mockRejectedValue(new Error('storage down'))
    const view = await h.service.getView()
    expect(h.store.saveSnapshot).toHaveBeenCalledTimes(1)
    expect(view.state).toBe('ok')
    expect(view.error).toBeNull()
    expect(view.balances[0]?.currency).toBe('CNY')
    expect(view.selected?.total).toBe(110n * 100_000_000n)
  })

  it('落盘失败后仍在窗口内命中缓存，不因为存储坏了就每轮重拉', async () => {
    const h = harness()
    vi.mocked(h.store.saveSnapshot).mockRejectedValue(new Error('storage down'))
    await h.service.getView()
    await h.service.getView()
    expect(h.client.fetchBalance).toHaveBeenCalledTimes(1)
  })
})

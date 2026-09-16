import { describe, expect, it } from 'vitest'
import { CONFIG_FIELDS, DEFAULT_TIMEOUT_MS, type Config } from '../src/config.ts'
import type { BalanceSnapshot, RawBalanceResponse } from '../src/domain/balance.ts'
import type { Clock } from '../src/ports/clock.ts'
import type { CoreStore } from '../src/ports/core-store.ts'
import type { DeepSeekClient, TestConnectionResult } from '../src/ports/deepseek-client.ts'
import type { Metrics } from '../src/ports/metrics.ts'
import { MemoryMetrics } from '../src/adapters/memory-metrics.ts'
import { BalanceService } from '../src/services/balance-service.ts'
import { ConfigService, type ConfigSource } from '../src/services/config-service.ts'
import { KeyResolver } from '../src/services/key-resolver.ts'
import { Scheduler } from '../src/services/scheduler.ts'
import { PLUGIN_VERSION } from '../src/version.ts'
import {
  handleBalance,
  handleConfigGet,
  handleConfigUpdate,
  handleHealthz,
  handleRefresh,
  handleTestConnection,
  type HttpDeps,
} from '../src/http/handlers.ts'

const NOW = 1_760_000_000_000
/** 处理只解析 URL，不真的连出去，所以用哪个源都行。 */
const BASE_URL = 'http://localhost'

/** 固定时刻的时钟：断言里不出现真实时间。 */
const clock: Clock = { now: () => NOW, timezone: () => 'Asia/Shanghai' }

/** 配置基线；与 schema 默认值一致。 */
const baseConfig: Config = {
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

/** 造一份上游响应。 */
function raw(
  items: Array<{ currency: string; total: string; granted?: string; toppedUp?: string }>,
  isAvailable = true,
): RawBalanceResponse {
  return {
    is_available: isAvailable,
    balance_infos: items.map((item) => ({
      currency: item.currency,
      total_balance: item.total,
      granted_balance: item.granted ?? '0.00000000',
      topped_up_balance: item.toppedUp ?? item.total,
    })),
  }
}

/** 一个 GET 请求。 */
function get(path: string): Request {
  return new Request(BASE_URL + path)
}

/** 一个 POST 请求；body 省略时不带请求体。 */
function post(path: string, body?: unknown): Request {
  if (body === undefined) return new Request(BASE_URL + path, { method: 'POST' })
  return new Request(BASE_URL + path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

/** 读 JSON 响应体。字段名在测试里动态取，所以放宽到 any。 */
async function readJson(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>
}

interface HarnessOptions {
  config?: Partial<Config>
  /** `null` 表示整条密钥解析链都取不到值。 */
  key?: string | null
  respond?: () => Promise<RawBalanceResponse>
  testResult?: TestConnectionResult
  metrics?: Metrics
}

interface Harness {
  deps: HttpDeps
  setConfig(patch: Partial<Config>): void
  balanceCalls(): number
  updates(): Array<Record<string, unknown>>
}

/**
 * 用真实服务 + 替身端口搭一套 handler 依赖。
 *
 * 刻意不 mock 服务层：handler 的契约（200 + state: error、现读配置）只有跑过
 * 真实的状态机才作数。
 */
function harness(options: HarnessOptions = {}): Harness {
  let current: Config = { ...baseConfig, ...options.config }
  const applied: Array<Record<string, unknown>> = []
  const source: ConfigSource = {
    get: () => current,
    watch: () => () => {},
    update: async (patch) => {
      // 模拟 schemastery 的范围校验：挑一个能稳定复现的字段。
      const seconds = Number(patch.serverRefreshSeconds)
      if ('serverRefreshSeconds' in patch && (!Number.isFinite(seconds) || seconds < 10)) {
        throw new Error('serverRefreshSeconds must be >= 10')
      }
      applied.push(patch)
      current = { ...current, ...patch } as Config
    },
  }
  const config = new ConfigService({ source, env: {} })
  const keys = new KeyResolver({
    readConfig: () => ({
      apiKey: options.key === null ? '' : options.key ?? 'test-key',
      apiKeyRef: 'DEEPSEEK_API_KEY',
    }),
    env: {},
  })
  let calls = 0
  const client: DeepSeekClient = {
    async fetchBalance() {
      calls += 1
      return await (options.respond ?? (async () => raw([{ currency: 'CNY', total: '110' }])))()
    },
    async testConnection() {
      return options.testResult ?? { ok: true, latencyMs: 7 }
    },
  }
  const store: CoreStore = {
    async saveSnapshot(_snapshot: BalanceSnapshot) {},
    async loadLatestSnapshot() {
      return null
    },
    async health() {
      return { ok: true }
    },
    async close() {},
  }
  const service = new BalanceService({
    client, store, keys, config, clock, salt: 'test-salt', metrics: options.metrics,
  })
  const scheduler = new Scheduler({
    target: { getView: (callOptions) => service.getView(callOptions), status: () => service.status() },
    timers: { set: () => 0, clear: () => {} },
    now: () => NOW,
  })
  return {
    deps: { service, config, keys, client, store, scheduler },
    setConfig: (patch) => {
      current = { ...current, ...patch }
    },
    balanceCalls: () => calls,
    updates: () => applied,
  }
}

describe('GET /api/v1/balance', () => {
  it('成功时 200，金额是八位小数字符串，selected 由后端给出', async () => {
    const h = harness()
    const response = await handleBalance(get('/api/v1/balance'), h.deps)
    expect(response.status).toBe(200)
    const json = await readJson(response)
    expect(json.state).toBe('ok')
    expect(json.schemaVersion).toBe(1)
    expect(json.balances).toEqual([
      { currency: 'CNY', total: '110.00000000', granted: '0.00000000', toppedUp: '110.00000000' },
    ])
    expect(json.selected).toEqual({ currency: 'CNY', total: '110.00000000' })
    expect(json.severity).toBe('ok')
    expect(json.accountTag8).toHaveLength(8)
    expect(json.todayUsage).toBeNull()
    expect(json.error).toBeNull()
    expect(json.thresholds.CNY).toEqual({ warn: '10.00000000', critical: '5.00000000' })
  })

  it('currency 查询参数覆盖配置里的 displayCurrency', async () => {
    const h = harness({
      config: { displayCurrency: 'CNY' },
      respond: async () => raw([{ currency: 'CNY', total: '110' }, { currency: 'USD', total: '20' }]),
    })
    expect((await readJson(await handleBalance(get('/api/v1/balance'), h.deps))).selected.currency).toBe('CNY')
    expect((await readJson(await handleBalance(get('/api/v1/balance?currency=USD'), h.deps))).selected.currency).toBe('USD')
  })

  it('上游失败仍然 200，业务错误走 state + error', async () => {
    const h = harness({
      respond: async () => {
        throw new Error('boom')
      },
    })
    const response = await handleBalance(get('/api/v1/balance'), h.deps)
    expect(response.status).toBe(200)
    const json = await readJson(response)
    expect(json.state).toBe('error')
    expect(json.severity).toBe('unknown')
    expect(json.error.retryable).toBe(true)
  })

  it('handler 内部异常不外抛（抛出去会被宿主包成 500）', async () => {
    const h = harness()
    const broken: HttpDeps = {
      ...h.deps,
      service: {
        getView: () => Promise.reject(new Error('exploded')),
        accountTag8: () => null,
      } as unknown as BalanceService,
    }
    const response = await handleBalance(get('/api/v1/balance'), broken)
    expect(response.status).toBe(200)
    expect((await readJson(response)).state).toBe('error')
  })

  it('每次请求现读配置：改 displayCurrency 后立刻生效', async () => {
    const h = harness({
      config: { displayCurrency: 'CNY' },
      respond: async () => raw([{ currency: 'CNY', total: '110' }, { currency: 'USD', total: '20' }]),
    })
    expect((await readJson(await handleBalance(get('/api/v1/balance'), h.deps))).selected.currency).toBe('CNY')
    h.setConfig({ displayCurrency: 'USD' })
    expect((await readJson(await handleBalance(get('/api/v1/balance'), h.deps))).selected.currency).toBe('USD')
  })
})

describe('POST /api/v1/balance/refresh', () => {
  it('回 triggered / joined / cooldownMs / state', async () => {
    const h = harness()
    const json = await readJson(await handleRefresh(post('/api/v1/balance/refresh', { reason: 'manual' }), h.deps))
    expect(json.triggered).toBe(true)
    expect(json.joined).toBe(false)
    expect(json.cooldownMs).toBe(0)
    expect(json.state).toBe('ok')
    expect(json.error).toBeNull()
  })

  it('没有请求体也能跑', async () => {
    const h = harness()
    expect((await handleRefresh(post('/api/v1/balance/refresh'), h.deps)).status).toBe(200)
  })
})

describe('GET /api/v1/config', () => {
  it('永不回传 apiKey 本身', async () => {
    const h = harness({ config: { apiKey: 'sk-super-secret' } })
    const response = await handleConfigGet(get('/api/v1/config'), h.deps)
    const text = await response.clone().text()
    expect(text).not.toContain('sk-super-secret')
    const json = await readJson(response)
    expect(json.config.apiKey).toBeUndefined()
    expect(json.apiKeyMasked).toBe('********')
  })

  it('未配置 apiKey 时掩码是空串', async () => {
    const h = harness({ config: { apiKey: '' } })
    expect((await readJson(await handleConfigGet(get('/api/v1/config'), h.deps))).apiKeyMasked).toBe('')
  })

  it('掩码是手动的：除 apiKey 外十个字段全在，超时不在 schema 里', async () => {
    const h = harness({ config: { apiKey: 'sk-x' } })
    const json = await readJson(await handleConfigGet(get('/api/v1/config'), h.deps))
    expect(Object.keys(json.config)).toHaveLength(CONFIG_FIELDS.length - 1)
    expect(json.config.displayCurrency).toBe('auto')
    expect(json.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })
})

describe('POST /api/v1/config', () => {
  it('合法补丁 200 且写进配置源', async () => {
    const h = harness({ config: { displayCurrency: 'auto' } })
    const response = await handleConfigUpdate(post('/api/v1/config', { displayCurrency: 'USD' }), h.deps)
    expect(response.status).toBe(200)
    expect(h.updates()).toEqual([{ displayCurrency: 'USD' }])
    expect((await readJson(response)).config.displayCurrency).toBe('USD')
  })

  it('未知字段 422，且不写入', async () => {
    const h = harness()
    const response = await handleConfigUpdate(post('/api/v1/config', { nope: 1 }), h.deps)
    expect(response.status).toBe(422)
    expect((await readJson(response)).error.code).toBe('VALIDATION')
    expect(h.updates()).toEqual([])
  })

  it('schema 拒绝越界值时 422', async () => {
    const h = harness()
    const response = await handleConfigUpdate(post('/api/v1/config', { serverRefreshSeconds: 1 }), h.deps)
    expect(response.status).toBe(422)
    expect((await readJson(response)).error.message).toContain('>= 10')
    expect(h.updates()).toEqual([])
  })

  it('请求体不是 JSON 对象时 422', async () => {
    const h = harness()
    expect((await handleConfigUpdate(post('/api/v1/config', [1, 2]), h.deps)).status).toBe(422)
    expect((await handleConfigUpdate(post('/api/v1/config'), h.deps)).status).toBe(422)
    expect((await handleConfigUpdate(post('/api/v1/config', 'nope'), h.deps)).status).toBe(422)
  })

  it('空对象是合法的空操作', async () => {
    const h = harness()
    const response = await handleConfigUpdate(post('/api/v1/config', {}), h.deps)
    expect(response.status).toBe(200)
    expect(h.updates()).toEqual([])
  })
})

describe('POST /api/v1/test-connection', () => {
  it('成功回延迟与余额预览', async () => {
    const h = harness({
      testResult: { ok: true, latencyMs: 42, isAvailable: true, balances: [{ currency: 'CNY', total: '110.00000000' }] },
    })
    const json = await readJson(await handleTestConnection(post('/api/v1/test-connection', {}), h.deps))
    expect(json.ok).toBe(true)
    expect(json.latencyMs).toBe(42)
    expect(json.balances).toEqual([{ currency: 'CNY', total: '110.00000000' }])
  })

  it('没有可用密钥时回 NO_KEY 而不是抛错', async () => {
    const h = harness({ key: null })
    const response = await handleTestConnection(post('/api/v1/test-connection', {}), h.deps)
    expect(response.status).toBe(200)
    const json = await readJson(response)
    expect(json.ok).toBe(false)
    expect(json.code).toBe('NO_KEY')
  })

  it('请求体里的 apiKey 优先于解析链', async () => {
    const h = harness({ key: null })
    expect((await readJson(await handleTestConnection(post('/api/v1/test-connection', { apiKey: 'sk-inline' }), h.deps))).ok).toBe(true)
  })

  it('不动活动缓存', async () => {
    const h = harness()
    await handleTestConnection(post('/api/v1/test-connection', {}), h.deps)
    expect(h.balanceCalls()).toBe(0)
  })
})

describe('GET /api/v1/healthz', () => {
  it('回状态、调度与存储健康', async () => {
    const h = harness()
    await handleBalance(get('/api/v1/balance'), h.deps)
    const json = await readJson(await handleHealthz(get('/api/v1/healthz'), h.deps))
    expect(json.state).toBe('ok')
    expect(json.consecutiveFailures).toBe(0)
    expect(json.lastSuccessAt).toBe(NOW)
    expect(json.store).toEqual({ ok: true, detail: null })
    expect(json.scheduler).toEqual({ running: false, nextRunAt: null })
    expect(json.version).toBe(PLUGIN_VERSION)
  })

  it('存储自检抛错也不外抛', async () => {
    const h = harness()
    const broken: HttpDeps = {
      ...h.deps,
      store: {
        ...h.deps.store,
        health: () => Promise.reject(new Error('db gone')),
      } as CoreStore,
    }
    const response = await handleHealthz(get('/api/v1/healthz'), broken)
    expect(response.status).toBe(200)
    expect((await readJson(response)).store.ok).toBe(false)
  })
})

describe('指标', () => {
  it('healthz 没接指标时回 null，而不是编一份空的', async () => {
    const h = harness()
    const json = await readJson(await handleHealthz(get('/api/v1/healthz'), h.deps))
    expect(json.metrics).toBeNull()
  })

  it('接了指标时 healthz 暴露聚合值', async () => {
    const metrics = new MemoryMetrics()
    const h = harness({ metrics })
    await handleBalance(get('/api/v1/balance'), h.deps)
    const json = await readJson(await handleHealthz(get('/api/v1/healthz'), { ...h.deps, metrics }))
    expect(json.metrics.counters['balance_fetch_total{result=ok}']).toBe(1)
    expect(json.metrics.gauges['cache_state{state=ok}']).toBe(1)
    expect(json.metrics.histograms['balance_fetch_duration_ms'].count).toBe(1)
  })
})

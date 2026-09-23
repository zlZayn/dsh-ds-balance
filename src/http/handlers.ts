/**
 * 六个端点的处理实现。
 *
 * 依赖全部构造注入、**不碰 `ctx`** —— 因此它能脱离宿主直接测。
 *
 * 铁律（见 docs/backend-architecture.md §19 第 3、4 条）：
 * - **任何 handler 都不许把异常抛出去**。抛出去会被宿主包成 500，前端就拿不到
 *   `error` 结构了。余额端点的业务错误一律走 `200 + state: error`。
 * - **每次请求现读配置**，不许在闭包里捕获旧值。
 * @module dsh-ds-balance/http/handlers
 */

import type { CacheState } from '../domain/balance.js'
import { classify, describeError } from '../domain/errors.js'
import type { CoreStore } from '../ports/core-store.js'
import type { DeepSeekClient } from '../ports/deepseek-client.js'
import type { Credentials } from '../ports/credentials.js'
import type { Logger } from '../ports/logger.js'
import type { ReadableMetrics } from '../ports/metrics.js'
import type { BalanceService } from '../services/balance-service.js'
import type { ConfigService } from '../services/config-service.js'
import type { KeyResolver } from '../services/key-resolver.js'
import type { Scheduler } from '../services/scheduler.js'
import { CONFIG_FIELDS, endpointOf, validateThresholds, type Config } from '../config.js'
import { PLUGIN_VERSION, SCHEMA_VERSION } from '../version.js'
import {
  newRequestId,
  toWireBalanceView,
  toWireError,
  type WireBalanceResponse,
  type WireCredentialInfo,
} from './wire.js'

/** 一套 handler 需要的全部依赖。 */
export interface HttpDeps {
  service: BalanceService
  config: ConfigService
  keys: KeyResolver
  client: DeepSeekClient
  store: CoreStore
  scheduler: Scheduler
  logger?: Logger | undefined
  /** 可读出聚合值的指标；没接线时返回 `null` 而不是编一份空的。 */
  metrics?: ReadableMetrics | undefined
  /** 凭据端口。只用来读「配没配 / 可不可写」，**永远不读值**。 */
  credentials?: Credentials | undefined
}

/** `testConnection` 超时的可接受区间；越界一律回落默认值。 */
const TEST_TIMEOUT_RANGE = { min: 1000, max: 60_000 } as const

/** 未配置 API Key 时回给「测试连接」的错误文案。 */
const NO_KEY_MESSAGE = 'no API key configured'

/** 统一的 JSON 响应头。 */
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const

/** 造一个 JSON 响应。 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

/** 是否是普通对象（数组与 `null` 都不算）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读一个查询参数；URL 坏掉时返回 `null`。 */
function queryParam(request: Request, name: string): string | null {
  try {
    return new URL(request.url).searchParams.get(name)
  } catch {
    return null
  }
}

/** 读一个 JSON 对象请求体；不是对象、不是 JSON、没有体一律 `null`。 */
async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    return isPlainObject(body) ? body : null
  } catch {
    return null
  }
}

/**
 * 空视图：任何 handler 在彻底失败时都回它，保证响应形状仍然合法。
 * @param requestId - 本次请求的标识。
 * @param error - 触发失败的异常。
 * @param state - 要报告的状态；余额端点固定 `error`。
 * @returns 契约 §8.3 的响应体。
 */
function failureView(requestId: string, error: unknown, state: CacheState = 'error'): WireBalanceResponse {
  return {
    requestId,
    schemaVersion: SCHEMA_VERSION,
    state,
    stale: false,
    fetchedAt: 0,
    ageMs: 0,
    isAvailable: false,
    accountTag8: '',
    balances: [],
    selected: null,
    severity: 'unknown',
    thresholds: {},
    todayUsage: null,
    error: toWireError(classify(error)),
  }
}

/** 从配置里挑出 `GET /api/v1/config` 要回传的字段。**`apiKey` 永不出现在这里。** */
function publicConfig(config: Config): Omit<Config, 'apiKey'> {
  const { apiKey: _secret, ...rest } = config
  return rest
}

/**
 * `apiKey` 的掩码。
 *
 * **不回传密钥的任何片段**：只回答「配没配」。回一个固定长度的星号串是为了让
 * 字段名 `apiKeyMasked` 名副其实，同时不给任何爆破线索。
 * @param value - 当前生效的 `apiKey`。
 * @returns 已配置时是固定长度的掩码串，未配置时是空串。
 */
function maskApiKey(value: string): string {
  return value.trim() === '' ? '' : '********'
}

/** `GET /api/v1/balance`。**状态码始终 200**，业务错误走 `state` + `error`。 */
export async function handleBalance(request: Request, deps: HttpDeps): Promise<Response> {
  const requestId = newRequestId()
  try {
    const currency = queryParam(request, 'currency')
    const view = await deps.service.getView(currency === null || currency === '' ? {} : { currency })
    return json(toWireBalanceView(view, deps.service.accountTag8() ?? '', requestId))
  } catch (error) {
    deps.logger?.error('ds-balance: balance handler failed', { requestId, error: describeError(error) })
    return json(failureView(requestId, error))
  }
}

/** `POST /api/v1/balance/refresh`。请求体 `{ reason }`，可省略。 */
export async function handleRefresh(request: Request, deps: HttpDeps): Promise<Response> {
  const requestId = newRequestId()
  try {
    const body = await readJsonObject(request)
    const rawReason = body?.reason
    const reason = typeof rawReason === 'string' && rawReason !== '' ? rawReason : 'manual'
    const result = await deps.service.forceRefresh(reason)
    return json({ requestId, schemaVersion: SCHEMA_VERSION, ...result, error: null })
  } catch (error) {
    deps.logger?.error('ds-balance: refresh handler failed', { requestId, error: describeError(error) })
    return json({
      requestId,
      schemaVersion: SCHEMA_VERSION,
      triggered: false,
      joined: false,
      cooldownMs: 0,
      state: 'error',
      error: toWireError(classify(error)),
    })
  }
}

/**
 * 读凭据的只读描述。
 *
 * 失败一律回 `null`：界面据此退化成「不知道，就先当只读」，而不是把整张卡片打挂。
 * @param deps - 注入的依赖。
 * @param ref - 当前生效的凭据引用名。
 * @returns 三个事实，或 `null`。
 */
async function credentialInfo(deps: HttpDeps, ref: string): Promise<WireCredentialInfo | null> {
  const credentials = deps.credentials
  if (credentials === undefined) return null
  try {
    const described = await credentials.describe(ref)
    return {
      ref,
      configured: described.configured === true,
      source: described.source ?? null,
      writable: described.writable === true,
    }
  } catch (error) {
    deps.logger?.debug('ds-balance: credential describe failed', { ref, error: describeError(error) })
    return null
  }
}

/** 组装配置响应体。**`apiKey` 永不出现；掩码是手动的。** */
async function configBody(requestId: string, deps: HttpDeps): Promise<Record<string, unknown>> {
  const config = deps.config.current()
  return {
    requestId,
    schemaVersion: SCHEMA_VERSION,
    config: publicConfig(config),
    apiKeyMasked: maskApiKey(config.apiKey),
    credential: await credentialInfo(deps, config.apiKeyRef),
    timeoutMs: deps.config.timeoutMs(),
    error: null,
  }
}

/** `GET /api/v1/config`。**掩码是手动的** —— 本响应自己构造，不走 settings 读取。 */
export async function handleConfigGet(_request: Request, deps: HttpDeps): Promise<Response> {
  const requestId = newRequestId()
  try {
    return json(await configBody(requestId, deps))
  } catch (error) {
    deps.logger?.error('ds-balance: config read handler failed', { requestId, error: describeError(error) })
    return json({ requestId, schemaVersion: SCHEMA_VERSION, error: toWireError(classify(error)) })
  }
}

/** `POST /api/v1/config`。请求是任意字段子集；形状不合法或校验失败一律 `422`。 */
export async function handleConfigUpdate(request: Request, deps: HttpDeps): Promise<Response> {
  const requestId = newRequestId()
  let patch: Record<string, unknown>
  try {
    const body = await readJsonObject(request)
    if (body === null) return json({ requestId, error: { code: 'VALIDATION', message: 'body must be a JSON object', retryable: false } }, 422)
    const unknown = Object.keys(body).filter((key) => !CONFIG_FIELDS.some((field) => field === key))
    if (unknown.length > 0) {
      return json({ requestId, error: { code: 'VALIDATION', message: `unknown config field: ${unknown.join(', ')}`, retryable: false } }, 422)
    }
    patch = body
    if (Object.keys(patch).length > 0) {
      // 跨字段先验：0.1.7 起宿主侧不再强制「告急严格低于预警」
      // （register 的 validate 被删、schema 没有跨字段钩子），所以这条端点成了
      // **唯一**还能在写入侧拦住非法组合的地方。理由是它比官方 Plugins 页那条写路径
      // 多一层我们的代码；官方那条是宿主直连的原子 mutate，只跑 schema，拦不住。
      // 违反 ⇒ 422 且什么都不写。判据与消费侧守卫共用同一个 validateThresholds。
      validateThresholds({ ...deps.config.current(), ...patch } as Config)
      await deps.config.update(patch)
    }
  } catch (error) {
    deps.logger?.warn('ds-balance: config write rejected', { requestId, error: describeError(error) })
    return json({ requestId, error: toWireError(classify(error)) }, 422)
  }
  // 写完立刻回读，让调用方看到落盘后的真实值（掩码同上）。
  try {
    return json(await configBody(requestId, deps))
  } catch (error) {
    deps.logger?.error('ds-balance: config readback failed', { requestId, error: describeError(error) })
    return json({ requestId, schemaVersion: SCHEMA_VERSION, error: toWireError(classify(error)) })
  }
}

/** `POST /api/v1/test-connection`。**不动活动缓存。** */
export async function handleTestConnection(request: Request, deps: HttpDeps): Promise<Response> {
  const requestId = newRequestId()
  try {
    const body = await readJsonObject(request)
    const config = deps.config.current()
    const rawBaseUrl = body?.baseUrl
    const baseUrl = typeof rawBaseUrl === 'string' && rawBaseUrl.trim() !== '' ? rawBaseUrl.trim() : endpointOf(config)
    const rawTimeout = Number(body?.timeoutMs)
    const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout >= TEST_TIMEOUT_RANGE.min && rawTimeout <= TEST_TIMEOUT_RANGE.max
      ? Math.trunc(rawTimeout)
      : deps.config.timeoutMs()
    const rawApiKey = body?.apiKey
    const apiKey = typeof rawApiKey === 'string' && rawApiKey.trim() !== ''
      ? rawApiKey.trim()
      : await deps.keys.resolve().catch((): null => null)
    if (apiKey === null) return json({ requestId, ok: false, latencyMs: 0, code: 'NO_KEY', message: NO_KEY_MESSAGE })
    const result = await deps.client.testConnection({ baseUrl, apiKey, timeoutMs })
    return json({ requestId, schemaVersion: SCHEMA_VERSION, ...result })
  } catch (error) {
    deps.logger?.warn('ds-balance: test-connection handler failed', { requestId, error: describeError(error) })
    const info = classify(error)
    return json({ requestId, schemaVersion: SCHEMA_VERSION, ok: false, latencyMs: 0, code: info.code, message: info.message })
  }
}

/** `GET /api/v1/healthz`。 */
export async function handleHealthz(_request: Request, deps: HttpDeps): Promise<Response> {
  const requestId = newRequestId()
  const status = deps.service.status()
  let store: { ok: boolean; detail: string | null } = { ok: false, detail: 'health check failed' }
  try {
    const health = await deps.store.health()
    store = { ok: health.ok, detail: health.detail ?? null }
  } catch (error) {
    store = { ok: false, detail: describeError(error) }
  }
  return json({
    requestId,
    schemaVersion: SCHEMA_VERSION,
    version: PLUGIN_VERSION,
    state: status.state,
    lastSuccessAt: status.lastSuccessAt,
    consecutiveFailures: status.consecutiveFailures,
    scheduler: { running: deps.scheduler.isRunning(), nextRunAt: deps.scheduler.nextRunAt() },
    store,
    // 默认组合没有指标 sink，所以把聚合值挂在这里暴露；没接线时是 null。
    metrics: deps.metrics?.snapshot() ?? null,
  })
}

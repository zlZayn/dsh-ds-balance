/**
 * 数据层：向后端要余额。
 *
 * 端点由宿主半边的 `ctx.connection.fetch` 注册，物理载体**已做完信任与浏览器
 * 鉴权**，所以浏览器这边只是同源 `fetch`，不带任何自己的凭据。
 *
 * **本模块不缓存、不合并、不排程**：节奏归调用方（`SidebarBalance` 的轮询与
 * 手动刷新），这里只负责一次往返与两件事 —— 把 `displayCurrency` 作为查询参数
 * 传过去、把失败翻成可展示的错误态。
 * @module dsh-ds-balance/client/data
 */

import type { BalanceResponse, BalanceState } from './api-types.ts'

/** 余额端点。路径与宿主半边逐字一致，不带尾随斜杠。 */
export const BALANCE_PATH = '/api/v1/balance'

/** 手动刷新端点。 */
export const REFRESH_PATH = '/api/v1/balance/refresh'

/** 配置读端点。界面只从这里取「凭据可不可写」这一件事。 */
export const CONFIG_PATH = '/api/v1/config'

/** 可替换的 fetch，便于测试注入。 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * 凭据的只读描述。
 *
 * 与宿主的线上形状同构，也逐字对齐官方 `describe()`：**没有装值的槽**。
 */
export interface CredentialInfo {
  ref: string
  configured: boolean
  source: string | null
  writable: boolean
}

/** `GET /api/v1/config` 里本插件消费的那部分。 */
export interface ConfigResponse {
  config: Record<string, unknown>
  /** 已配置时是固定长度的星号串；**不含密钥的任何片段**。 */
  apiKeyMasked: string
  /** 凭据端口缺席或读失败时是 `null`。 */
  credential: CredentialInfo | null
  timeoutMs: number
}

/** `POST /api/v1/balance/refresh` 的响应。 */
export interface RefreshResult {
  triggered: boolean
  joined: boolean
  cooldownMs: number
  state: BalanceState
}

/** 端点拿不到、或回的不是 JSON 时用的错误码。 */
export const UNREACHABLE_CODE = 'PLUGIN_UNREACHABLE'

/**
 * 「还没拿到数据」的占位视图。
 *
 * 空态而不是错误态：首拉还没回来时不该先闪一下「读取失败」。
 * @returns 契约形状的响应。
 */
export function pendingView(): BalanceResponse {
  return {
    requestId: '',
    schemaVersion: 1,
    state: 'empty',
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
    error: null,
  }
}

/**
 * 「拿不到数据」的视图。
 *
 * 只在**一次都没成功过**的时候用；已经有数据时宁可继续显示旧值 ——
 * 后端自己的 `state: stale` 才是「数据过期」的权威表达。
 * @param message - 面向用户的一句话。
 * @returns 契约形状的响应。
 */
export function unreachableView(message: string): BalanceResponse {
  return {
    ...pendingView(),
    state: 'error',
    error: { code: UNREACHABLE_CODE, message },
  }
}

/** 读一个 JSON 响应；非 2xx 或不是 JSON 都抛错。 */
async function readJson<T>(response: Response, path: string): Promise<T> {
  if (!response.ok) throw new Error(`${path} responded ${response.status}`)
  try {
    return await response.json() as T
  } catch {
    throw new Error(`${path} did not return JSON`)
  }
}

/**
 * 读一次余额。
 *
 * `displayCurrency` **总是**作为查询参数传出去，包括 `auto` —— 后端的挑选规则
 * 把 `auto` 当作「不指定」，所以传它不等于替后端做决定。
 * @param options - 显示币种、可注入的 fetch 与取消信号。
 * @returns 后端响应。
 * @throws 端点不可达、非 2xx 或响应不是 JSON。
 */
export async function requestBalance(options: {
  currency: string
  fetchImpl?: FetchLike
  signal?: AbortSignal
}): Promise<BalanceResponse> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const url = `${BALANCE_PATH}?currency=${encodeURIComponent(options.currency)}`
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  return await readJson<BalanceResponse>(response, BALANCE_PATH)
}

/**
 * 只认形状对得上的凭据描述。
 *
 * **宿主可能是旧版本**（客户端由 HMR 立刻换新，宿主模块要重启才换），那时响应里
 * 根本没有这个字段。这里把它规整成 `null`，而不是让 `undefined` 漏到组件里去。
 * @param value - 响应里的原始值。
 * @returns 规整后的描述，或 `null`。
 */
function readCredential(value: unknown): CredentialInfo | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.ref !== 'string' || record.ref === '') return null
  return {
    ref: record.ref,
    configured: record.configured === true,
    source: typeof record.source === 'string' ? record.source : null,
    writable: record.writable === true,
  }
}

/**
 * 读一次插件配置。
 *
 * 只为拿 `credential`：界面靠 `writable` 决定凭据字段是「可编辑」还是
 * 「由启动环境提供（只读）」。**响应里没有密钥**，掩码是固定长度的星号串。
 * @param options - 可注入的 fetch。
 * @returns 配置响应里本插件消费的那部分。
 * @throws 端点不可达、非 2xx 或响应不是 JSON。
 */
export async function requestConfig(options: { fetchImpl?: FetchLike } = {}): Promise<ConfigResponse> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const response = await fetchImpl(CONFIG_PATH, { headers: { accept: 'application/json' } })
  const body = await readJson<ConfigResponse>(response, CONFIG_PATH)
  return { ...body, credential: readCredential(body?.credential) }
}

/**
 * 触发一次手动刷新。
 *
 * 后端的冷却还没过时它回 `triggered: false`，那是正常结果而不是错误。
 * @param options - 刷新原因与可注入的 fetch。
 * @returns 后端的刷新结果。
 * @throws 端点不可达、非 2xx 或响应不是 JSON。
 */
export async function requestRefresh(options: { reason?: string; fetchImpl?: FetchLike } = {}): Promise<RefreshResult> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const response = await fetchImpl(REFRESH_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ reason: options.reason ?? 'manual' }),
  })
  return await readJson<RefreshResult>(response, REFRESH_PATH)
}

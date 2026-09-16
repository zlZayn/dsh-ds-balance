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

import type { BalanceResponse } from './api-types.ts'

/** 余额端点。路径与宿主半边逐字一致，不带尾随斜杠。 */
export const BALANCE_PATH = '/api/v1/balance'

/** 手动刷新端点。 */
export const REFRESH_PATH = '/api/v1/balance/refresh'

/** 可替换的 fetch，便于测试注入。 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** `POST /api/v1/balance/refresh` 的响应。 */
export interface RefreshResult {
  triggered: boolean
  joined: boolean
  cooldownMs: number
  state: string
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

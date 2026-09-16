/**
 * DeepSeek 上游的 HTTP 实现。
 * @module dsh-ds-balance/adapters/http-deepseek-client
 */

import type { RawBalanceResponse } from '../domain/balance.js'
import { NetworkError, ParseError, TimeoutError, UpstreamError, classify } from '../domain/errors.js'
import { parseErrorBody } from '../domain/normalize.js'
import type { DeepSeekCallOptions, DeepSeekClient, TestConnectionResult } from '../ports/deepseek-client.js'

/** 可替换的 fetch，便于测试注入。 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** 构造参数。 */
export interface HttpDeepSeekClientOptions {
  /** 注入 fetch；默认用全局 `fetch`。 */
  fetchImpl?: FetchLike
  /** 注入时刻函数，测延迟用。 */
  now?: () => number
}

/** 去掉尾部斜杠，避免拼出双斜杠路径。 */
function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

/** 余额端点路径。 */
const BALANCE_PATH = '/user/balance'

/**
 * 用 WHATWG fetch 调 DeepSeek 的 `GET /user/balance`。
 *
 * 超时用自建的 `AbortController + setTimeout`（而不是 `AbortSignal.timeout`），
 * 这样测试可以在不睡真实时间的前提下驱动超时分支。
 */
export class HttpDeepSeekClient implements DeepSeekClient {
  private readonly fetchImpl: FetchLike
  private readonly now: () => number

  constructor(options: HttpDeepSeekClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.now = options.now ?? (() => Date.now())
  }

  async fetchBalance(options: DeepSeekCallOptions): Promise<RawBalanceResponse> {
    const response = await this.request(options)
    const text = await response.text()
    try {
      return JSON.parse(text) as RawBalanceResponse
    } catch (error) {
      throw new ParseError('balance response is not JSON', { cause: error })
    }
  }

  async testConnection(options: DeepSeekCallOptions): Promise<TestConnectionResult> {
    const startedAt = this.now()
    try {
      const raw = await this.fetchBalance(options)
      const latencyMs = this.now() - startedAt
      const balances = Array.isArray(raw?.balance_infos)
        ? raw.balance_infos.map((item) => ({ currency: String(item.currency), total: String(item.total_balance) }))
        : []
      return { ok: true, latencyMs, isAvailable: raw?.is_available === true, balances }
    } catch (error) {
      const info = classify(error)
      return { ok: false, latencyMs: this.now() - startedAt, code: info.code, message: info.message }
    }
  }

  /**
   * 发一次请求并处理状态码。
   * @throws {UpstreamError} 非 2xx。
   * @throws {TimeoutError} 超时。
   * @throws {NetworkError} 连不上。
   */
  private async request(options: DeepSeekCallOptions): Promise<Response> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, options.timeoutMs)
    const forwardAbort = (): void => { controller.abort() }
    options.signal?.addEventListener('abort', forwardAbort, { once: true })

    let response: Response
    try {
      response = await this.fetchImpl(joinUrl(options.baseUrl, BALANCE_PATH), {
        method: 'GET',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          accept: 'application/json',
        },
        signal: controller.signal,
      })
    } catch (error) {
      if (timedOut) throw new TimeoutError(`upstream timeout after ${options.timeoutMs}ms`, { cause: error })
      if (options.signal?.aborted === true) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TimeoutError(`upstream aborted after ${options.timeoutMs}ms`, { cause: error })
      }
      throw new NetworkError(error instanceof Error ? error.message : String(error), { cause: error })
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', forwardAbort)
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const parsed = parseErrorBody(text)
      throw new UpstreamError(response.status, parsed.message ?? parsed.code ?? `upstream ${response.status}`, {
        headers: response.headers,
      })
    }
    return response
  }
}

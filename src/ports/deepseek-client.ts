/**
 * DeepSeek 上游端口。
 * @module dsh-ds-balance/ports/deepseek-client
 */

import type { ErrorCode } from '../domain/errors.js'
import type { RawBalanceResponse } from '../domain/balance.js'

/** 默认端点。契约 §3.2：**端点独立**，不继承对话适配器的 baseURL。 */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'

/** 一次调用的公共参数。 */
export interface DeepSeekCallOptions {
  /** 端点基址，可覆盖默认值。 */
  baseUrl: string
  /** 已解析出的明文密钥。**只在本进程内存里流转，不落盘、不记日志。** */
  apiKey: string
  /** 超时毫秒数。 */
  timeoutMs: number
  /** 调用方的取消信号。 */
  signal?: AbortSignal
}

/** 测连接的结果，形状对齐契约 §8.7。 */
export interface TestConnectionResult {
  ok: boolean
  latencyMs: number
  isAvailable?: boolean
  balances?: Array<{ currency: string; total: string }>
  code?: ErrorCode
  message?: string
}

/** 余额上游。 */
export interface DeepSeekClient {
  /**
   * 抓一次余额。
   * @throws {UpstreamError} 上游返回非 2xx。
   * @throws {TimeoutError} 超时。
   * @throws {NetworkError} 连不上。
   * @throws {ParseError} 响应不是 JSON。
   */
  fetchBalance(options: DeepSeekCallOptions): Promise<RawBalanceResponse>

  /**
   * 测连接。**不动活动缓存。** 失败时返回 `ok: false` 而不抛错。
   */
  testConnection(options: DeepSeekCallOptions): Promise<TestConnectionResult>
}

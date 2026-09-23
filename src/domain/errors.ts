/**
 * 领域错误与错误分类。
 *
 * 宿主半边的对外错误一律映射成 {@link ErrorInfo}：合约规定余额错误走
 * `200 + state: error`，HTTP 层不得把异常抛出去让宿主包成 500。
 * @module dsh-ds-balance/domain/errors
 */

/** 对外可见的错误码闭集。 */
export type ErrorCode =
  | 'NO_KEY'
  | 'NO_NETWORK'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_401'
  | 'UPSTREAM_402'
  | 'UPSTREAM_422'
  | 'UPSTREAM_429'
  | 'UPSTREAM_4XX'
  | 'UPSTREAM_5XX'
  | 'UPSTREAM_503'
  | 'PARSE_ERROR'
  | 'SHAPE_ERROR'
  | 'COOLDOWN'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'STORAGE_ERROR'

/** 跨线传给前端的错误形状。 */
export interface ErrorInfo {
  code: ErrorCode
  message: string
  retryable: boolean
  details?: Record<string, unknown>
}

/** 构造 {@link AppError} 的可选参数。 */
export interface AppErrorOptions {
  retryable?: boolean
  details?: Record<string, unknown>
  cause?: unknown
}

/** 所有本插件错误的基类：带错误码与可重试标记。 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly retryable: boolean
  readonly details: Record<string, unknown> | undefined

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = new.target.name
    this.code = code
    this.retryable = options.retryable ?? false
    this.details = options.details
  }
}

/** 没有可用的 API Key。解析链全空时抛这个。 */
export class NoKeyError extends AppError {
  constructor(message = 'API key not configured') {
    super('NO_KEY', message)
  }
}

/** 请求超时。 */
export class TimeoutError extends AppError {
  constructor(message = 'upstream timeout', options: AppErrorOptions = {}) {
    super('UPSTREAM_TIMEOUT', message, { ...options, retryable: true })
  }
}

/** 网络不可达（DNS / 连接失败）。 */
export class NetworkError extends AppError {
  constructor(message = 'network unreachable', options: AppErrorOptions = {}) {
    super('NO_NETWORK', message, { ...options, retryable: true })
  }
}

/** 把 HTTP 状态码映射到错误码。 */
export function upstreamCodeOf(status: number): ErrorCode {
  switch (status) {
    case 401: return 'UPSTREAM_401'
    case 402: return 'UPSTREAM_402'
    case 422: return 'UPSTREAM_422'
    case 429: return 'UPSTREAM_429'
    case 503: return 'UPSTREAM_503'
    default:
      if (status >= 500) return 'UPSTREAM_5XX'
      return 'UPSTREAM_4XX'
  }
}

/** 上游返回了非 2xx。 */
export class UpstreamError extends AppError {
  readonly status: number
  readonly headers: Headers | undefined

  constructor(status: number, message: string, options: { headers?: Headers; cause?: unknown } = {}) {
    super(upstreamCodeOf(status), message, {
      retryable: status >= 500 || status === 429,
      cause: options.cause,
    })
    this.status = status
    this.headers = options.headers
  }
}

/** 金额或响应体解析失败。绝不静默归 0。 */
export class ParseError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('PARSE_ERROR', message, options)
  }
}

/** 响应结构与契约不符。 */
export class ShapeError extends AppError {
  constructor(message = 'response shape mismatch', options: AppErrorOptions = {}) {
    super('SHAPE_ERROR', message, options)
  }
}

/** 入参或配置没通过校验。**不可重试** —— 同一份输入重放还是失败。 */
export class ValidationError extends AppError {
  constructor(message = 'validation failed', options: AppErrorOptions = {}) {
    super('VALIDATION', message, options)
  }
}
/** 存储层失败。可重试。 */
export class StorageError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('STORAGE_ERROR', message, { ...options, retryable: true })
  }
}

/**
 * 解析 `Retry-After`。支持秒数与 HTTP-date 两种写法。
 * @param headers - 上游响应头；缺失时返回 `undefined`。
 * @param now - 当前时刻，HTTP-date 用它算差值；便于测试注入。
 * @returns 毫秒数，或 `undefined` 表示没给出可用的提示。
 */
export function parseRetryAfter(headers: Headers | undefined, now: number = Date.now()): number | undefined {
  const raw = headers?.get('retry-after')
  if (raw === undefined || raw === null) return undefined
  const text = raw.trim()
  if (text === '') return undefined

  if (/^\d+$/.test(text)) {
    const seconds = Number(text)
    return Number.isFinite(seconds) ? seconds * 1000 : undefined
  }

  const at = Date.parse(text)
  if (Number.isNaN(at)) return undefined
  return Math.max(0, at - now)
}

/**
 * 把任意异常映射成对外错误。
 *
 * 顺序重要：先认自己的类型，再认带 `status` 的外部错误，最后兜底。
 * @param error - 任意抛出的值。
 * @returns 契约里的错误形状。
 */
export function classify(error: unknown): ErrorInfo {
  if (error instanceof AppError) {
    const info: ErrorInfo = { code: error.code, message: error.message, retryable: error.retryable }
    return error.details === undefined ? info : { ...info, details: error.details }
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return { code: 'UPSTREAM_TIMEOUT', message: error.message, retryable: true }
    }
    const code = 'code' in error ? error.code : undefined
    if (typeof code === 'string' && /^(ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR)/.test(code)) {
      return { code: 'NO_NETWORK', message: error.message, retryable: true }
    }
    return { code: 'STORAGE_ERROR', message: error.message, retryable: true }
  }

  return { code: 'STORAGE_ERROR', message: String(error), retryable: true }
}

/**
 * 把任意异常压成一行文本，供日志与错误消息使用。
 *
 * **绝不带凭据**：上游约定异常文本里不含密钥，所以它可以安全写进日志。
 * 只取 `Error.message`；非 `Error` 的抛出值退回 `String()`。
 * @param error - 任意抛出的值。
 * @returns 单行错误文本。
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

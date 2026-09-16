import { describe, expect, it } from 'vitest'
import {
  AppError,
  NetworkError,
  NoKeyError,
  ParseError,
  ShapeError,
  StorageError,
  TimeoutError,
  UpstreamError,
  classify,
  parseRetryAfter,
  upstreamCodeOf,
} from '../src/domain/errors.ts'

describe('upstreamCodeOf', () => {
  it('映射已知状态码', () => {
    expect(upstreamCodeOf(401)).toBe('UPSTREAM_401')
    expect(upstreamCodeOf(402)).toBe('UPSTREAM_402')
    expect(upstreamCodeOf(422)).toBe('UPSTREAM_422')
    expect(upstreamCodeOf(429)).toBe('UPSTREAM_429')
    expect(upstreamCodeOf(503)).toBe('UPSTREAM_503')
  })

  it('其余按档归类', () => {
    expect(upstreamCodeOf(500)).toBe('UPSTREAM_5XX')
    expect(upstreamCodeOf(502)).toBe('UPSTREAM_5XX')
    expect(upstreamCodeOf(400)).toBe('UPSTREAM_4XX')
    expect(upstreamCodeOf(404)).toBe('UPSTREAM_4XX')
  })
})

describe('classify', () => {
  it('自己的错误原样透出', () => {
    expect(classify(new NoKeyError())).toEqual({
      code: 'NO_KEY', message: 'API key not configured', retryable: false,
    })
  })

  it('可重试标记正确', () => {
    expect(classify(new TimeoutError()).retryable).toBe(true)
    expect(classify(new NetworkError()).retryable).toBe(true)
    expect(classify(new StorageError('disk')).retryable).toBe(true)
    expect(classify(new ParseError('bad number')).retryable).toBe(false)
    expect(classify(new ShapeError()).retryable).toBe(false)
    expect(classify(new UpstreamError(429, 'rate limited')).retryable).toBe(true)
    expect(classify(new UpstreamError(401, 'auth')).retryable).toBe(false)
  })

  it('把 AbortError 认成超时', () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(classify(abort).code).toBe('UPSTREAM_TIMEOUT')
  })

  it('把网络类 errno 认成不可达', () => {
    const err = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' })
    expect(classify(err).code).toBe('NO_NETWORK')
  })

  it('其余兜底成 STORAGE_ERROR 且可重试', () => {
    expect(classify(new Error('boom'))).toEqual({ code: 'STORAGE_ERROR', message: 'boom', retryable: true })
    expect(classify('plain string').code).toBe('STORAGE_ERROR')
  })

  it('带 details 的错误把 details 带上', () => {
    const err = new AppError('UPSTREAM_429', 'slow down', { retryable: true, details: { retryAfterMs: 1000 } })
    expect(classify(err).details).toEqual({ retryAfterMs: 1000 })
  })
})

describe('parseRetryAfter', () => {
  it('秒数', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '5' }))).toBe(5000)
  })

  it('HTTP-date 转差值', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    const at = new Date(now + 3000).toUTCString()
    expect(parseRetryAfter(new Headers({ 'retry-after': at }), now)).toBe(3000)
  })

  it('缺失或不可解析返回 undefined', () => {
    expect(parseRetryAfter(undefined)).toBeUndefined()
    expect(parseRetryAfter(new Headers())).toBeUndefined()
    expect(parseRetryAfter(new Headers({ 'retry-after': 'soon' }))).toBeUndefined()
  })
})

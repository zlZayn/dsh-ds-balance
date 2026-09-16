import { describe, expect, it } from 'vitest'
import type { BalanceResponse } from '../src/client/api-types.ts'
import {
  BALANCE_PATH,
  REFRESH_PATH,
  pendingView,
  requestBalance,
  requestRefresh,
  unreachableView,
} from '../src/client/data.ts'

/** 记录每次调用的 fetch 替身。 */
function recorder(payload: unknown, init: { ok?: boolean; status?: number; body?: string } = {}) {
  const calls: Array<{ input: string; init: RequestInit | undefined }> = []
  const fetchImpl = async (input: string, options?: RequestInit): Promise<Response> => {
    calls.push({ input, init: options })
    if (init.ok === false) return new Response(init.body ?? 'nope', { status: init.status ?? 500 })
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { calls, fetchImpl }
}

describe('requestBalance', () => {
  it('把 displayCurrency 作为查询参数传出去', async () => {
    const { calls, fetchImpl } = recorder(pendingView())
    await requestBalance({ currency: 'CNY', fetchImpl })
    expect(calls[0]?.input).toBe(BALANCE_PATH + '?currency=CNY')
  })

  it('auto 也照样传：后端把 auto 当作「不指定」', async () => {
    const { calls, fetchImpl } = recorder(pendingView())
    await requestBalance({ currency: 'auto', fetchImpl })
    expect(calls[0]?.input).toBe(BALANCE_PATH + '?currency=auto')
  })

  it('币种被转义，不拼出畸形 URL', async () => {
    const { calls, fetchImpl } = recorder(pendingView())
    await requestBalance({ currency: 'a b&c', fetchImpl })
    expect(calls[0]?.input).toBe(BALANCE_PATH + '?currency=a%20b%26c')
  })

  it('回的是解析后的 JSON', async () => {
    const payload = { ...pendingView(), state: 'ok' as const }
    const { fetchImpl } = recorder(payload)
    const result: BalanceResponse = await requestBalance({ currency: 'auto', fetchImpl })
    expect(result.state).toBe('ok')
  })

  it('非 2xx 抛错，不做静默兜底', async () => {
    const { fetchImpl } = recorder(null, { ok: false, status: 404 })
    await expect(requestBalance({ currency: 'auto', fetchImpl })).rejects.toThrow('404')
  })

  it('响应不是 JSON 也抛错', async () => {
    const fetchImpl = async (): Promise<Response> => new Response('not json', { status: 200 })
    await expect(requestBalance({ currency: 'auto', fetchImpl })).rejects.toThrow('did not return JSON')
  })
})

describe('requestRefresh', () => {
  it('POST 到刷新端点并带上 reason', async () => {
    const { calls, fetchImpl } = recorder({ triggered: true, joined: false, cooldownMs: 0, state: 'ok' })
    const result = await requestRefresh({ reason: 'manual', fetchImpl })
    expect(calls[0]?.input).toBe(REFRESH_PATH)
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ reason: 'manual' }))
    expect(result.triggered).toBe(true)
  })

  it('省略 reason 时回落 manual', async () => {
    const { calls, fetchImpl } = recorder({ triggered: false, joined: false, cooldownMs: 1000, state: 'ok' })
    await requestRefresh({ fetchImpl })
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ reason: 'manual' }))
  })
})

describe('占位视图', () => {
  it('pendingView 是空态、没有错误', () => {
    const view = pendingView()
    expect(view.state).toBe('empty')
    expect(view.error).toBeNull()
    expect(view.selected).toBeNull()
    expect(view.severity).toBe('unknown')
  })

  it('unreachableView 是错误态并带上错误码', () => {
    const view = unreachableView('boom')
    expect(view.state).toBe('error')
    expect(view.error?.code).toBe('PLUGIN_UNREACHABLE')
    expect(view.error?.message).toBe('boom')
  })
})

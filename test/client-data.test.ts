import { describe, expect, it } from 'vitest'
import type { BalanceResponse } from '../src/client/api-types.ts'
import {
  BALANCE_PATH,
  CONFIG_PATH,
  REFRESH_PATH,
  pendingView,
  requestBalance,
  requestConfig,
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

describe('requestConfig', () => {
  it('GET 配置端点，只取凭据那三个事实', async () => {
    const { calls, fetchImpl } = recorder({
      config: { apiKeyRef: 'DEEPSEEK_API_KEY' },
      apiKeyMasked: '********',
      credential: { ref: 'DEEPSEEK_API_KEY', configured: true, source: 'env', writable: false },
      timeoutMs: 8000,
    })
    const body = await requestConfig({ fetchImpl })
    expect(calls[0]?.input).toBe(CONFIG_PATH)
    expect(calls[0]?.init?.method).toBeUndefined()
    expect(body.credential?.writable).toBe(false)
    expect(body.apiKeyMasked).toBe('********')
  })

  it('凭据端口缺席时 credential 是 null，界面据此退化成只读', async () => {
    const { fetchImpl } = recorder({ config: {}, apiKeyMasked: '', credential: null, timeoutMs: 8000 })
    expect((await requestConfig({ fetchImpl })).credential).toBeNull()
  })

  it('端点不可达时抛错，不静默回一份空配置', async () => {
    const { fetchImpl } = recorder(null, { ok: false, status: 404 })
    await expect(requestConfig({ fetchImpl })).rejects.toThrow('404')
  })
})

describe('requestConfig 对抗旧宿主', () => {
  it('响应里根本没有 credential 字段时规整成 null，而不是漏 undefined 给组件', async () => {
    // 客户端由 HMR 立刻换新，宿主模块要重启才换：新客户端会读到旧宿主的响应。
    const { fetchImpl } = recorder({ config: { apiKeyRef: 'DEEPSEEK_API_KEY' }, apiKeyMasked: '', timeoutMs: 8000 })
    expect((await requestConfig({ fetchImpl })).credential).toBeNull()
  })

  it('形状不对的 credential 也规整成 null', async () => {
    for (const broken of [null, 42, 'nope', [], {}, { ref: '' }, { writable: false }]) {
      const { fetchImpl } = recorder({ config: {}, apiKeyMasked: '', credential: broken, timeoutMs: 8000 })
      expect((await requestConfig({ fetchImpl })).credential, JSON.stringify(broken)).toBeNull()
    }
  })

  it('缺 writable 时保守地当成不可写', async () => {
    const { fetchImpl } = recorder({
      config: {}, apiKeyMasked: '', credential: { ref: 'DEEPSEEK_API_KEY', configured: true }, timeoutMs: 8000,
    })
    const info = (await requestConfig({ fetchImpl })).credential
    expect(info?.writable).toBe(false)
    expect(info?.source).toBeNull()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { HttpDeepSeekClient, type FetchLike } from '../src/adapters/http-deepseek-client.ts'
import { NetworkError, ParseError, TimeoutError, UpstreamError } from '../src/domain/errors.ts'

const call = { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test', timeoutMs: 1000 }

/** 造一个返回固定响应的 fetch 替身，并记录收到的入参。 */
function stub(response: Response): { impl: FetchLike; calls: Array<{ url: string; init: RequestInit | undefined }> } {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return response
  }
  return { impl, calls }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

describe('HttpDeepSeekClient.fetchBalance', () => {
  it('拼出正确的 URL 并带 Bearer 头', async () => {
    const { impl, calls } = stub(json({ is_available: true, balance_infos: [] }))
    await new HttpDeepSeekClient({ fetchImpl: impl }).fetchBalance(call)
    expect(calls[0]!.url).toBe('https://api.deepseek.com/user/balance')
    const headers = calls[0]!.init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-test')
    expect(calls[0]!.init?.method).toBe('GET')
  })

  it('基址带尾斜杠也不会拼出双斜杠', async () => {
    const { impl, calls } = stub(json({ is_available: true, balance_infos: [] }))
    await new HttpDeepSeekClient({ fetchImpl: impl }).fetchBalance({ ...call, baseUrl: 'https://api.deepseek.com/' })
    expect(calls[0]!.url).toBe('https://api.deepseek.com/user/balance')
  })

  it('解析出原始响应', async () => {
    const raw = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '1', granted_balance: '0', topped_up_balance: '1' }] }
    const { impl } = stub(json(raw))
    await expect(new HttpDeepSeekClient({ fetchImpl: impl }).fetchBalance(call)).resolves.toEqual(raw)
  })

  it('401 抛 UpstreamError 并取到错误体里的 message', async () => {
    const { impl } = stub(json({ error: { type: 'authentication_error', message: 'invalid api key' } }, 401))
    const error = await new HttpDeepSeekClient({ fetchImpl: impl }).fetchBalance(call).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UpstreamError)
    expect((error as UpstreamError).code).toBe('UPSTREAM_401')
    expect((error as UpstreamError).message).toBe('invalid api key')
    expect((error as UpstreamError).retryable).toBe(false)
  })

  it('429 可重试，并把 retry-after 留在响应头上', async () => {
    const { impl } = stub(json({ message: 'slow down' }, 429, { 'retry-after': '7' }))
    const error = await new HttpDeepSeekClient({ fetchImpl: impl }).fetchBalance(call).catch((e: unknown) => e)
    expect((error as UpstreamError).code).toBe('UPSTREAM_429')
    expect((error as UpstreamError).retryable).toBe(true)
    expect((error as UpstreamError).headers?.get('retry-after')).toBe('7')
  })

  it('非 JSON 的 200 抛 ParseError', async () => {
    const { impl } = stub(new Response('<html>', { status: 200 }))
    await expect(new HttpDeepSeekClient({ fetchImpl: impl }).fetchBalance(call)).rejects.toBeInstanceOf(ParseError)
  })

  it('fetch 抛错时归成 NetworkError', async () => {
    const impl: FetchLike = async () => { throw new TypeError('fetch failed') }
    await expect(new HttpDeepSeekClient({ fetchImpl: impl }).fetchBalance(call)).rejects.toBeInstanceOf(NetworkError)
  })

  it('超时抛 TimeoutError', async () => {
    const impl: FetchLike = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    })
    await expect(
      new HttpDeepSeekClient({ fetchImpl: impl }).fetchBalance({ ...call, timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(TimeoutError)
  })

  it('调用方取消时把取消错误原样抛出，不误判成超时', async () => {
    const controller = new AbortController()
    const impl: FetchLike = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('caller aborted')
        reject(error)
      })
    })
    const pending = new HttpDeepSeekClient({ fetchImpl: impl }).fetchBalance({ ...call, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow('caller aborted')
  })
})

describe('HttpDeepSeekClient.testConnection', () => {
  it('成功时回报延迟与余额预览', async () => {
    const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1320)
    const { impl } = stub(json({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '110.00000000' }] }))
    const result = await new HttpDeepSeekClient({ fetchImpl: impl, now }).testConnection(call)
    expect(result).toEqual({
      ok: true,
      latencyMs: 320,
      isAvailable: true,
      balances: [{ currency: 'CNY', total: '110.00000000' }],
    })
  })

  it('失败时不抛错，回 ok:false 与错误码', async () => {
    const { impl } = stub(json({ error: { message: 'nope' } }, 401))
    const result = await new HttpDeepSeekClient({ fetchImpl: impl }).testConnection(call)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('UPSTREAM_401')
    expect(result.message).toBe('nope')
  })

  it('上游字段缺失时不炸，余额预览退成空数组', async () => {
    const { impl } = stub(json({}))
    const result = await new HttpDeepSeekClient({ fetchImpl: impl }).testConnection(call)
    expect(result.ok).toBe(true)
    expect(result.balances).toEqual([])
    expect(result.isAvailable).toBe(false)
  })
})

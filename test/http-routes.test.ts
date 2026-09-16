import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { HTTP_ROUTES, registerHttpRoutes } from '../src/http/routes.ts'
import type { HttpDeps } from '../src/http/handlers.ts'

/** 处理只解析 URL，不真的连出去，所以用哪个源都行。 */
const ORIGIN = 'http://localhost'

interface Fake {
  ctx: Context
  routes: ConnectionFetchRoute[]
  disposeCount(): number
}

/** 只实现 register 的 connection 替身：注册表的其余行为不属于本插件。 */
function fakeContext(): Fake {
  const routes: ConnectionFetchRoute[] = []
  let count = 0
  const ctx = {
    connection: {
      fetch: {
        register(route: ConnectionFetchRoute) {
          routes.push(route)
          return async () => {
            count += 1
          }
        },
      },
    },
  }
  return { ctx: ctx as unknown as Context, routes, disposeCount: () => count }
}

describe('路由表', () => {
  it('端点集合与契约一致，且按路径去重', () => {
    const paths = HTTP_ROUTES.map((route) => route.path)
    expect([...paths].sort()).toEqual([
      '/api/v1/balance',
      '/api/v1/balance/refresh',
      '/api/v1/config',
      '/api/v1/healthz',
      '/api/v1/test-connection',
    ])
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('路径写死精确值，不带尾随斜杠', () => {
    for (const route of HTTP_ROUTES) {
      expect(route.path.startsWith('/api/')).toBe(true)
      expect(route.path.endsWith('/')).toBe(false)
      expect(route.path).not.toMatch(/\s/)
    }
  })

  it('方法只用 connection.fetch 支持的三档，且不重复', () => {
    const allowed = new Set(['GET', 'HEAD', 'POST'])
    for (const route of HTTP_ROUTES) {
      for (const method of route.methods) expect(allowed.has(method)).toBe(true)
      expect(new Set(route.methods).size).toBe(route.methods.length)
      expect(route.methods.length).toBeGreaterThan(0)
    }
  })

  it('写操作走 POST：connection.fetch 不收 PUT', () => {
    const config = HTTP_ROUTES.find((route) => route.path === '/api/v1/config')
    expect([...(config?.methods ?? [])] as string[]).toContain('POST')
    for (const route of HTTP_ROUTES) {
      expect([...route.methods] as string[]).not.toContain('PUT')
    }
  })
})

describe('registerHttpRoutes', () => {
  it('逐条注册，requestBody 必填且设为 buffered', () => {
    const fake = fakeContext()
    const dispose = registerHttpRoutes(fake.ctx, {} as HttpDeps)
    expect(fake.routes).toHaveLength(HTTP_ROUTES.length)
    for (const route of fake.routes) expect(route.requestBody).toBe('buffered')
    expect(typeof dispose).toBe('function')
  })

  it('disposer 撤销每一条注册', async () => {
    const fake = fakeContext()
    await registerHttpRoutes(fake.ctx, {} as HttpDeps)()
    expect(fake.disposeCount()).toBe(HTTP_ROUTES.length)
  })

  it('/api/v1/config 按方法分发：GET 走读、POST 走写', async () => {
    const fake = fakeContext()
    registerHttpRoutes(fake.ctx, {} as HttpDeps)
    const route = fake.routes.find((candidate) => candidate.path === '/api/v1/config')
    expect(route).toBeDefined()
    const read = await route!.fetch(new Request(ORIGIN + '/api/v1/config'))
    expect(read.status).toBe(200)
    const write = await route!.fetch(new Request(ORIGIN + '/api/v1/config', {
      method: 'POST',
      body: JSON.stringify({ nope: 1 }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(write.status).toBe(422)
  })
})

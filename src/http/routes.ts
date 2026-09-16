/**
 * 用 `ctx.connection.fetch` 注册全部 HTTP 端点。
 *
 * 三层职责分得很开：本文件只管**注册**，`handlers.ts` 管**怎么做**，
 * `wire.ts` 管**长什么样**。注册需要 `ctx`，所以只有本文件碰宿主。
 *
 * 契约要点（docs/backend-architecture.md §3.3 / §8.2）：
 * - `path` 写死精确值、不带尾随斜杠（实现是 Map 精确键匹配）；
 * - `requestBody` 必填；
 * - 物理载体**已先做完信任与浏览器鉴权**，handler 不必再判一次。
 * @module dsh-ds-balance/http/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import {
  handleBalance,
  handleConfigGet,
  handleConfigUpdate,
  handleHealthz,
  handleRefresh,
  handleTestConnection,
  type HttpDeps,
} from './handlers.js'

/**
 * `/api/v1/config` 的方法分发。
 *
 * **写操作走 POST 而不是 PUT**：`ConnectionFetchMethod` 只有 `GET` / `HEAD` / `POST`
 * 三档，PUT 注册即被拒。契约文档写的是 PUT，以平台实际能力为准。
 * @param request - 已通过信任与鉴权的请求。
 * @param deps - 注入的依赖。
 * @returns 读或写的响应。
 */
async function handleConfigRoute(request: Request, deps: HttpDeps): Promise<Response> {
  return request.method === 'GET'
    ? handleConfigGet(request, deps)
    : handleConfigUpdate(request, deps)
}

/**
 * 路由表。
 *
 * 同一 `path` 只能注册一次，方法在表里合并 —— 实现按 pathname 精确取一条，
 * 再看方法集合是否命中。`readonly` 与 `as const` 是为了让字面量类型活下来。
 */
export const HTTP_ROUTES = [
  { path: '/api/v1/balance', methods: ['GET'], handle: handleBalance },
  { path: '/api/v1/balance/refresh', methods: ['POST'], handle: handleRefresh },
  { path: '/api/v1/config', methods: ['GET', 'POST'], handle: handleConfigRoute },
  { path: '/api/v1/test-connection', methods: ['POST'], handle: handleTestConnection },
  { path: '/api/v1/healthz', methods: ['GET'], handle: handleHealthz },
] as const satisfies readonly {
  path: string
  methods: readonly ('GET' | 'HEAD' | 'POST')[]
  handle: (request: Request, deps: HttpDeps) => Promise<Response>
}[]

/**
 * 注册全部端点。
 *
 * 每个 `register` 都把 effect 挂在 `ctx` 上，所以随 fiber 卸载一起撤销；
 * 返回的合成 disposer 收拢这五条，供组装点放到生命周期结尾。
 * @param ctx - 宿主上下文；**必须已经能取到 `connection`**。
 * @param deps - 注入的依赖。
 * @returns 撤销全部路由的异步 disposer。
 */
export function registerHttpRoutes(ctx: Context, deps: HttpDeps): () => Promise<void> {
  const disposers = HTTP_ROUTES.map((route) =>
    ctx.connection.fetch.register({
      path: route.path,
      methods: route.methods,
      requestBody: 'buffered',
      fetch: (request) => route.handle(request, deps),
    }))
  return async () => {
    await Promise.all(disposers.map((dispose) => dispose()))
  }
}

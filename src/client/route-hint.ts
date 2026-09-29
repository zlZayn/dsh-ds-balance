/**
 * 「当前会话在用哪条路由」这条提示。
 *
 * 侧栏是**壳层**的座位，不在会话作用域里，所以它拿不到会话级模型选择 —— 这里自己去宿主
 * 的客户端服务上读一次。
 *
 * 三条更新路径，缺一不可：
 * 1. **切会话**：订阅 `uiSession` 的主绑定；
 * 2. **同一会话内换模型**：订阅那个会话的 `modelSelection` 投影（换会话时重绑）；
 * 3. 读不到就什么都不说 —— 后端回落到全局默认路由，界面照常，只是少了「跟着会话走」。
 *
 * 形状**全部鸭子类型**：`uiSession` 与 `sessions` 是宿主自己的客户端服务，跨版本会动，
 * 而本仓不为它们新增依赖（见 [AGENTS.md](AGENTS.md) 的跨插件服务约定）。读不出来只降级，不抛错。
 * @module dsh-ds-balance/client/route-hint
 */

/** 宿主 `HostObservable` 的最小面。 */
interface Observable {
  getSnapshot?: () => unknown
  subscribe?: (listener: () => void) => () => void
}

/** 会话绑定里我们要走到的那条链。 */
interface SessionBindingLike {
  session?: {
    projections?: {
      faceOf?: (key: string) => Observable | undefined
    }
  }
}

/** 这条提示要读的宿主面。 */
export interface RouteHintContext {
  uiSession?: { adapter?: { current?: Observable } }
  sessions?: { binding?: (id: unknown) => SessionBindingLike | undefined }
}

/** 可订阅的路由提示。 */
export interface RouteHint {
  /** 当前会话在用的 provider id；读不到回 `undefined`。 */
  getSnapshot(): string | undefined
  /** 订阅会话切换与模型切换；返回退订函数。 */
  subscribe(listener: () => void): () => void
}

/** 当前会话的 id；读不到回 `undefined`。 */
function currentSessionKey(ctx: RouteHintContext): unknown {
  const current = ctx.uiSession?.adapter?.current?.getSnapshot?.() as { key?: unknown } | undefined
  return current?.key
}

/** 当前会话的模型选择投影。 */
function projectionOf(ctx: RouteHintContext): Observable | undefined {
  const key = currentSessionKey(ctx)
  if (key === undefined) return undefined
  return ctx.sessions?.binding?.(key)?.session?.projections?.faceOf?.('modelSelection')
}

/**
 * 造一个路由提示。
 * @param ctx - 客户端根上下文（只用到其中两个可选服务）。
 * @returns 提示对象；宿主没有这些服务时永远回 `undefined`。
 */
export function createRouteHint(ctx: RouteHintContext): RouteHint {
  const listeners = new Set<() => void>()
  let stopCurrent: (() => void) | undefined
  let stopProjection: (() => void) | undefined

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  /** 绑当前会话的模型投影；换会话必须重绑（绑的是那个会话自己的投影）。 */
  const bindProjection = (): void => {
    stopProjection?.()
    stopProjection = projectionOf(ctx)?.subscribe?.(notify)
  }

  const start = (): void => {
    stopCurrent = ctx.uiSession?.adapter?.current?.subscribe?.(() => {
      bindProjection()
      notify()
    })
    bindProjection()
  }

  const stop = (): void => {
    stopCurrent?.()
    stopProjection?.()
    stopCurrent = undefined
    stopProjection = undefined
  }

  return {
    getSnapshot() {
      const provider = projectionOf(ctx)?.getSnapshot?.() as
        { next?: { provider?: unknown } } | undefined
      const value = provider?.next?.provider
      return typeof value === 'string' && value !== '' ? value : undefined
    },
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) start()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stop()
      }
    },
  }
}

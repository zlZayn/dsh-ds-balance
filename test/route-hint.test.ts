import { describe, expect, it, vi } from 'vitest'
import { createRouteHint, type RouteHintContext } from '../src/client/route-hint.ts'

/** 一个最小的 HostObservable 替身。 */
function observable<T>(value: T) {
  const listeners = new Set<() => void>()
  const handle = {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    listeners,
  }
  return handle
}

/**
 * 造一个「宿主客户端服务」的替身：一个会话列表，每个会话有自己的模型投影。
 * 结构对齐 `uiSession.adapter.current` + `sessions.binding(id).session.projections.faceOf('modelSelection')`。
 */
function host() {
  const projections = new Map<
    string,
    ReturnType<typeof observable<{ next?: { provider?: string } }>>
  >()
  const projectionFor = (id: string) => {
    let found = projections.get(id)
    if (found === undefined) {
      found = observable<{ next?: { provider?: string } }>({})
      projections.set(id, found)
    }
    return found
  }
  const current = observable<{ key?: string }>({ key: 's1' })
  const ctx: RouteHintContext = {
    uiSession: { adapter: { current } },
    sessions: {
      binding: (id) => ({ session: { projections: { faceOf: () => projectionFor(String(id)) } } }),
    },
  }
  return { ctx, current, projectionFor }
}

describe('createRouteHint', () => {
  it('读当前会话的模型选择；没有覆盖时回 undefined', () => {
    const h = host()
    const hint = createRouteHint(h.ctx)
    expect(hint.getSnapshot()).toBeUndefined()
    h.projectionFor('s1').getSnapshot = () => ({ next: { provider: 'deepseek-account' } })
    expect(hint.getSnapshot()).toBe('deepseek-account')
  })

  it('没有宿主服务时永远回 undefined，不抛', () => {
    const hint = createRouteHint({})
    expect(hint.getSnapshot()).toBeUndefined()
    expect(() => hint.subscribe(() => {})()).not.toThrow()
  })

  it('**切模型**（同一会话内）立刻通知', () => {
    const h = host()
    const projection = h.projectionFor('s1')
    const hint = createRouteHint(h.ctx)
    const listener = vi.fn()
    const off = hint.subscribe(listener)

    projection.getSnapshot = () => ({ next: { provider: 'deepseek-account' } })
    for (const notify of [...projection.listeners]) notify()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(hint.getSnapshot()).toBe('deepseek-account')
    off()
  })

  it('**切会话**立刻通知，并且改读新会话的投影', () => {
    const h = host()
    h.projectionFor('s1').getSnapshot = () => ({ next: { provider: 'deepseek-account' } })
    const hint = createRouteHint(h.ctx)
    const listener = vi.fn()
    const off = hint.subscribe(listener)
    expect(hint.getSnapshot()).toBe('deepseek-account')

    // 切到 s2：它自己的选择是走 Key。
    h.projectionFor('s2').getSnapshot = () => ({ next: { provider: 'deepseek-official' } })
    h.current.getSnapshot = () => ({ key: 's2' })
    for (const notify of [...h.current.listeners]) notify()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(hint.getSnapshot()).toBe('deepseek-official')
    off()
  })

  it('退订之后不再收到通知', () => {
    const h = host()
    const hint = createRouteHint(h.ctx)
    const listener = vi.fn()
    hint.subscribe(listener)()
    for (const notify of [...h.current.listeners]) notify()
    expect(listener).not.toHaveBeenCalled()
  })
})

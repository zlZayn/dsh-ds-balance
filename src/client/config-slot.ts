/**
 * 配置槽的能力探测：**运行时不查版本号，只问「这个槽在不在」**。
 *
 * 为什么查能力而不是查版本：客户端半边拿不到宿主版本（没有 hostVersion 一类通道），
 * 而「槽在不在」是当场可观测的事实。机制见 README 的「版本兼容」一节。
 *
 * 三态且**可逆**：
 * - `pending` —— 还没等到上限，此时不下结论（新宿主上槽可能在启动后一小会儿才声明）。
 * - `missing` —— 等满了还没等到，提示路径启用。
 * - `available` —— 槽声明到了。若提示已经出现过，这一步会把提示撤掉（防宿主将来改成延迟声明）。
 *
 * 探测本身**不参与注册**：注册照旧交给 `ctx.slots.inject`，槽真的在就正常注册。
 * 探测失败只影响提示，不影响圆环、浮层与后端。
 * @module dsh-ds-balance/client/config-slot
 */

/** 新宿主才声明的配置槽：配置卡片注册在它上面。 */
export const CONFIG_SLOT = 'plugins.bundle.config'

/**
 * 等槽声明的上限（毫秒）。
 *
 * 给宽是有意的：宿主半边与浏览器半边、以及各插件 `apply` 的次序都不由我们定，
 * 慢机器上启动期本来就要几秒。宁可提示晚一点，也不要在新宿主上误报 ——
 * 误报会让「缺槽」这个信号变得不可信。
 */
export const CONFIG_SLOT_TIMEOUT_MS = 15000

/**
 * 缺槽时的提示。
 *
 * **英文、`[WARN]` 前缀、无 emoji** —— 兼容性硬约束规定提示文案一律英文，
 * 所以它**有意不走** [locales.ts](locales.ts) 的双语词典：那里放的是产品文案，
 * 中文用户也应该看到中文；而这一条是**跨版本诊断信息**，**只在探测到旧宿主（槽缺席）
 * 时才会出现**，两种语言下一律照原文给。SPEC §5 把这记作一处有意的例外。
 */
export const CONFIG_SLOT_WARNING =
  '[WARN] This dsh host does not declare the plugins.bundle.config slot, so this plugin cannot show '
  + 'its configuration page here. The balance ring and its popover keep working. To get the configuration '
  + 'page, upgrade dsh to the version this plugin declares in engines.dsh of package.json -- see the '
  + '"Version compatibility" section in the README.'

/** 探测的三态。 */
export type ConfigSlotState = 'pending' | 'available' | 'missing'

/** 探测结果，供 UI 订阅。 */
export interface ConfigSlotProbe {
  /** 当前态。 */
  getSnapshot(): ConfigSlotState
  /**
   * 订阅状态变化。
   * @param listener - 变化回调。
   * @returns 退订函数。
   */
  subscribe(listener: () => void): () => void
  /** 槽的声明到了。晚到的声明会把 `missing` 拨回 `available`，于是提示被撤回。 */
  markDeclared(): void
  /** 释放计时器与订阅者。 */
  dispose(): void
}

/** 探测的可注入点。 */
export interface ConfigSlotProbeOptions {
  /** 上限毫秒数，默认 {@link CONFIG_SLOT_TIMEOUT_MS}。 */
  timeoutMs?: number
  /**
   * 定时器。默认 `setTimeout`；测试用假时钟替掉它，不依赖真实时间。
   * @param fire - 到点回调。
   * @param ms - 毫秒数。
   * @returns 取消函数。
   */
  schedule?: (fire: () => void, ms: number) => () => void
}

/**
 * 建一个探测。
 * @param options - 可注入的上限与定时器。
 * @returns 三态探测结果。
 */
export function createConfigSlotProbe(options: ConfigSlotProbeOptions = {}): ConfigSlotProbe {
  const timeoutMs = options.timeoutMs ?? CONFIG_SLOT_TIMEOUT_MS
  const schedule = options.schedule ?? ((fire: () => void, ms: number): (() => void) => {
    const id = setTimeout(fire, ms)
    return () => { clearTimeout(id) }
  })

  let state: ConfigSlotState = 'pending'
  let disposed = false
  let cancel = (): void => {}
  const listeners = new Set<() => void>()

  /** 只在态真的变了、且没被释放时通知。 */
  const publish = (next: ConfigSlotState): void => {
    if (disposed || next === state) return
    state = next
    for (const listener of [...listeners]) listener()
  }

  cancel = schedule(() => { publish('missing') }, timeoutMs)

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    markDeclared: () => {
      cancel()
      publish('available')
    },
    dispose: () => {
      disposed = true
      cancel()
      listeners.clear()
    },
  }
}

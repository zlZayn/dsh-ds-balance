/**
 * 配置表单的能力探测：**运行时不查版本号，只问「卡片拿不拿得到配置表单」**。
 *
 * 这**一个真实故障**把两种情形归成同一句话 —— 更早的宿主没有配置服务、
 * 这个 profile 里没装 ui-plugin-manager：用户看到的现象都是「配置页出不来」，
 * 而它的当场可观测证据是 **`ctx.inject(['configForms'])` 在窗口内有没有回调**。
 *
 * 为什么查能力而不是查版本：客户端半边拿不到宿主版本（没有 hostVersion 一类通道），
 * 而 `engines` 只是 advisory —— 装到更早的宿主上不报错，只是表单永远拿不到。
 * 机制见 README 的「版本兼容」一节。
 *
 * **为什么盯的是服务而不是槽名**（本轮定案，推翻上一轮）： `plugins.bundle.config`
 * 这一格在 0.1.6 与 0.1.7 **都**存在，而两版渲染它时**都不传 `form`**
 * （宿主 `PluginManagerPage.tsx:584` 的 `renderSlot('plugins.bundle.config', { view: 'page' } …)`，
 * 只有 `view` 与 `entryKey`）。所以「槽在不在」**推不出**「拿不拿得到表单」——
 * 照字面把槽名换掉就是把一条恒为真的信号当成探测，那正是下面这条规则说的说谎的探测。
 * 真正会断的那一环是服务：没有 `configForms`，`get(ENTRY_ID)` 这条路根本不存在。
 *
 * 三态且**可逆**：
 * - `pending` —— 还没等到上限，此时不下结论（宿主半边与浏览器半边、各插件 `apply` 的
 *   次序都不由我们定，慢机器上启动期本来就要几秒）。
 * - `missing` —— 等满了还没等到，提示路径启用。
 * - `available` —— 服务回调到了。若提示已经出现过，这一步会把提示撤掉。
 *
 * **探测必须盯住那个真正会断的环节**：盯错地方（一个恒为真的槽名）会让它永远报
 * available 而卡片其实装不上 —— 说谎的探测比没有探测更坏。
 *
 * 边界：它答的是「拿不拿得到 form 这个**服务**」，不答「宿主服务不服务我们这个命名空间」。
 * 后者由卡片自己看快照的 `status`（不是 `ready` 就什么都不渲染），
 * 两条合起来才是完整的「拿不到配置表单」。
 *
 * 探测本身**不参与注册**：注册照旧交给 `ctx.slots.inject`，槽真的在就正常注册。
 * 探测失败只影响提示，不影响圆环、浮层与后端。
 * @module dsh-ds-balance/client/config-slot
 */

/**
 * 配置卡片注册的那一格，**key 是包名**（见 src/client/index.tsx 的 `BUNDLE_CONFIG_KEY`）。
 *
 * 一个 bundle 一份配置，渲染在它自己的详情页里（宿主 `slot-contract.ts` 对
 * `plugins.bundle.config` 的原话：*A bundle's own configuration, keyed by the bundle's
 * package name and rendered on the bundle's page between its description and its rows*），
 * 于是从插件列表点插件名进去**就是**配置区，不多一次点击。
 *
 * 落点往返过一次，值得记一笔：0.1.7 换设置接缝时曾改挂 `plugins.row.config`
 * （key = `<包名>#<行 id>`），理由是 bundle 那一格不递 `form`。而 `ctx.configForms.get`
 * 落地之后 form 两条路都拿得到，槽的选择**重新变成纯 UX 问题** —— 那两个槽在 0.1.6 与
 * 0.1.7 都**同时存在**（见模块头）。
 */
export const CONFIG_SLOT = 'plugins.bundle.config'

/**
 * 等服务到位的上限（毫秒）。
 *
 * 给宽是有意的：宿主半边与浏览器半边、以及各插件 `apply` 的次序都不由我们定，
 * 慢机器上启动期本来就要几秒。宁可提示晚一点，也不要在新宿主上误报 ——
 * 误报会让「服务缺席」这个信号变得不可信。
 */
export const CONFIG_SLOT_TIMEOUT_MS = 15000

/**
 * 拿不到配置表单时的提示。
 *
 * **英文、`[WARN]` 前缀、无 emoji** —— 兼容性硬约束规定提示文案一律英文，
 * 所以它**有意不走** [locales.ts](locales.ts) 的双语词典：那里放的是产品文案，
 * 中文用户也应该看到中文；而这一条是**跨版本诊断信息**，**只在探测到拿不到配置表单时才出现**，
 * 两种语言下一律照原文给。SPEC §5 把这记作一处有意的例外。
 *
 * 文案里**刻意不点名任何槽**：两个候选槽在 0.1.6 与 0.1.7 都同时存在（见模块头），
 * 点名等于指着一样在座、却与拿不拿得到表单无关的东西 —— 那会把下一个人引到错的方向。
 * 常量名保留 `CONFIG_SLOT_WARNING`：改名对读者没有增量，而它已经在若干处被引用。
 */
export const CONFIG_SLOT_WARNING =
  '[WARN] This dsh host gives this plugin no configuration form: the Host does not provide the '
  + 'configForms client service (or the Plugins page is not mounted in this profile), so the '
  + 'configuration card cannot be shown. The balance ring and its popover keep working. To get the '
  + 'configuration page, upgrade dsh to the version this plugin declares in engines.dsh of '
  + 'package.json -- see the "Version compatibility" section in the README.'

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
  /** `configForms` 服务到位了。晚到的服务会把 `missing` 拨回 `available`，于是提示被撤回。 */
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

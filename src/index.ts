/**
 * 宿主半边入口。
 *
 * 组装点（Layer 5）：登记设置命名空间，并把端口实现接上。**业务逻辑一律不在本文件。**
 * 浏览器半边通过 `ctx.settingsScope` 读写同一命名空间。
 *
 * 注意：宿主半边**没有模块热更**，改了这里要重建并让插件行重新挂载才生效。
 * @module dsh-ds-balance
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-credentials'
import { Config, SETTINGS_NAMESPACE, type Config as ConfigShape } from './config.js'

export { Config, SETTINGS_NAMESPACE } from './config.js'
export { CURRENCY_AUTO } from './config.js'

/** 插件名，loader 诊断用。 */
export const name = 'ds-balance'

/**
 * 运行时服务门禁。**删任何一项都会让 `apply` 静默不跑。**
 *
 * - `settings`：登记配置命名空间。
 * - `credentials`：复用官方模型页配好的 DeepSeek 凭据（阶段 0 已实测命中）。
 */
export const inject = ['settings', 'credentials']

/**
 * 登记设置命名空间。
 *
 * 用 `register` 而不是 `installSection`：后者是给「provider 缺席要回落」的
 * **可选消费者**用的，本插件是**常驻 owner**。
 *
 * 不读取解析后的值：浏览器半边直接用 `settingsScope` 读写同一命名空间，
 * 所以提交一次修改不需要重新注册。变更通知走 `scope.watch`（后续步骤接上）。
 */
export function apply(ctx: Context, config: ConfigShape): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(SETTINGS_NAMESPACE, Config, { base: config })
  })
}

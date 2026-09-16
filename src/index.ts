/**
 * 宿主半边：只登记 settings schema，让配置能落进 `$DSH_HOME/settings.yaml`。
 *
 * 本阶段刻意不含任何业务逻辑：不请求余额接口、不做定时刷新、不缓存。
 * 浏览器半边通过 `ctx.settingsScope` 读写同一命名空间。
 * @module dsh-ds-balance
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'

/** 插件名，loader 诊断用。 */
export const name = 'ds-balance'

/** 本插件只依赖设置服务。 */
export const inject = ['settings']

/** 设置命名空间：必须是小写连字符标识符，且与浏览器半边逐字一致。 */
export const SETTINGS_NAMESPACE = 'ds-balance'

/** 币种下拉的「自动」取值。 */
export const CURRENCY_AUTO = 'auto'

/** 插件配置。字段顺序即卡片分组顺序。 */
export interface Config {
  /** DeepSeek API Key。redact 层按 `role('secret')` 掩码。 */
  apiKey: string
  /** 凭据引用名；非空时优先于 `apiKey`。 */
  apiKeyRef: string
  /** 接口基址。 */
  baseUrl: string
  /** 服务端刷新频率（秒）。 */
  serverRefreshSeconds: number
  /** 客户端轮询频率（秒）。 */
  clientPollSeconds: number
  /** 手动刷新冷却（秒）。 */
  manualRefreshCooldownSeconds: number
  /** 展示币种；`auto` 表示跟随账户实际币种。 */
  displayCurrency: string
  /** CNY 预警阈值。 */
  cnyWarn: number
  /** CNY 告急阈值。 */
  cnyCritical: number
  /** USD 预警阈值。 */
  usdWarn: number
  /** USD 告急阈值。 */
  usdCritical: number
}

/**
 * 配置 schema。加载期校验，非法配置 fail loud。
 * 阈值只在这里存储，前端不做金额比较：颜色由后端的 `severity` 决定。
 */
export const Config = z.object({
  apiKey: z.string().role('secret').default(''),
  apiKeyRef: z.string().role('credential-ref').default('deepseek-api-key'),
  baseUrl: z.string().default('https://api.deepseek.com'),
  serverRefreshSeconds: z.natural().min(10).max(3600).default(60),
  clientPollSeconds: z.natural().min(5).max(600).default(30),
  manualRefreshCooldownSeconds: z.natural().min(0).max(600).default(30),
  displayCurrency: z.string().default(CURRENCY_AUTO),
  cnyWarn: z.number().min(0).default(10),
  cnyCritical: z.number().min(0).default(5),
  usdWarn: z.number().min(0).default(2),
  usdCritical: z.number().min(0).default(1),
})

/**
 * 把本插件的设置分区挂到 settings 服务上。
 *
 * 不读取解析后的值：浏览器半边直接用 `settingsScope` 读写同一命名空间，
 * 所以提交一次修改不需要重新注册。
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, Config, config, {
      setSource: () => {},
      onChange: () => {},
    })
  })
}

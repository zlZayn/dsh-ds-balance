/**
 * 插件配置：schemastery schema、常量与派生值。
 *
 * 字段名与 [UI 侧契约与移交](../docs/ui-handoff.md) 第六节逐字一致，共 **11** 个。
 * `timeoutMs` **不在 schema 里**：它是常量加环境变量覆盖，UI 不暴露。
 * @module dsh-ds-balance/config
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_BASE_URL } from './ports/deepseek-client.js'

/** 设置命名空间：与浏览器半边逐字一致，是两半的配对键。 */
export const SETTINGS_NAMESPACE = 'ds-balance'

/** `displayCurrency` 的「跟随账户」取值。 */
export const CURRENCY_AUTO = 'auto'

/** 官方凭据的默认引用名。与 `llm-deepseek` 的默认逐字相同。 */
export const DEFAULT_API_KEY_REF = 'DEEPSEEK_API_KEY'

/** 超时常量。UI 不暴露，改环境变量即可。 */
export const DEFAULT_TIMEOUT_MS = 8000

/** 覆盖超时的环境变量名。 */
export const TIMEOUT_ENV = 'DS_BALANCE_TIMEOUT_MS'

/** 超时的合法区间。 */
export const TIMEOUT_RANGE = { min: 1000, max: 60_000 } as const

/** 插件配置。 */
export interface Config {
  /** DeepSeek API Key。**用户显式覆盖**用；留空则走引用名解析。 */
  apiKey: string
  /** 凭据引用名。必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`。 */
  apiKeyRef: string
  /** 端点基址。**端点独立**，不继承对话适配器。 */
  baseUrl: string
  /** 服务端刷新频率（秒）。 */
  serverRefreshSeconds: number
  /** 客户端轮询频率（秒）。 */
  clientPollSeconds: number
  /** 手动刷新冷却（秒）。 */
  manualRefreshCooldownSeconds: number
  /** 展示币种；`auto` 表示跟随账户。 */
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
 * 配置字段名闭集。
 *
 * 供 `POST /api/v1/config` 过滤请求体用：不在表里的键一律 `422`，避免脏键被
 * 悄悄写进用户层。**顺序与数量由 `test/config-fields.test.ts` 对着 schema 兜底**，
 * 不靠人记。
 */
export const CONFIG_FIELDS = [
  'apiKey',
  'apiKeyRef',
  'baseUrl',
  'serverRefreshSeconds',
  'clientPollSeconds',
  'manualRefreshCooldownSeconds',
  'displayCurrency',
  'cnyWarn',
  'cnyCritical',
  'usdWarn',
  'usdCritical',
] as const satisfies readonly (keyof Config)[]

/**
 * 配置 schema。加载期校验，非法配置 fail loud。
 *
 * 阈值只在这里存储，前端不做金额比较：颜色由后端的 `severity` 决定。
 */
export const Config = z.object({
  apiKey: z.string().role('secret').default(''),
  apiKeyRef: z.string().role('credential-ref').default(DEFAULT_API_KEY_REF),
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  serverRefreshSeconds: z.natural().min(10).max(3600).default(60),
  clientPollSeconds: z.natural().min(5).max(600).default(30),
  manualRefreshCooldownSeconds: z.natural().min(0).max(600).default(30),
  displayCurrency: z.string().default(CURRENCY_AUTO),
  cnyWarn: z.number().min(0).default(10),
  cnyCritical: z.number().min(0).default(5),
  usdWarn: z.number().min(0).default(2),
  usdCritical: z.number().min(0).default(1),
})

/** 一对阈值：同一币种内的预警与告急。 */
export interface ThresholdPair {
  readonly currency: string
  readonly warn: keyof Config
  readonly critical: keyof Config
}

/**
 * 阈值成对的清单。
 *
 * 字段名的约定是「币种代码小写 + Warn / Critical」；客户端按同一条约定把这两个字段
 * 归成一对来判（[use-config-form.ts](client/settings/use-config-form.ts) 的 `THRESHOLD_PAIRS`）。
 * 两边各存一份是因为**宿主与浏览器两个半体不许值导入**；约定本身由测试对着本表兜底。
 */
export const THRESHOLD_PAIRS: readonly ThresholdPair[] = [
  { currency: 'CNY', warn: 'cnyWarn', critical: 'cnyCritical' },
  { currency: 'USD', warn: 'usdWarn', critical: 'usdCritical' },
]

/**
 * 跨字段校验：每个币种内 `warn` 必须**严格大于** `critical`。
 *
 * 挂在 `ctx.settings.register` 的 `validate` 上，不挂在 schema 上：
 * schemastery 没有 refine / superRefine 这类跨字段钩子，而
 * `SettingsRegisterOptions.validate` 正是为「schema 表达不了的约束」准备的 ——
 * 它拿到的是**合并后、schema 已通过**的完整候选值，抛错即拒绝写入、什么都不落盘。
 *
 * **它在合并后的完整值上跑**，所以单字段写入会让中间态短暂非法；
 * 客户端把成对的写入排过序（`orderPairWrites`），保证每一步中间态都合法。
 *
 * 为什么必须严格大于：两者相等时，余额恰好压线会被同时判成 warn 与 critical，
 * 「预警」这一档就不存在了。
 * @param value - 合并后的完整配置。
 * @throws {Error} 违反约束时抛出；消息指向具体币种，便于用户定位。
 */
export function validateThresholds(value: Config): void {
  for (const pair of THRESHOLD_PAIRS) {
    const warn = value[pair.warn]
    const critical = value[pair.critical]
    if (warn > critical) continue
    throw new Error(`${pair.currency} 预警必须大于告急（当前 ${String(warn)} / ${String(critical)}）`)
  }
}

/**
 * 解析当前生效的超时。
 *
 * **每次请求都调用它** —— 改环境变量后立即生效，不需要重启。
 * 越界或不可解析一律回落常量。
 * @param env - 环境变量表；默认 `process.env`，测试可注入。
 * @returns 毫秒数。
 */
export function resolveTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env[TIMEOUT_ENV])
  if (!Number.isFinite(raw)) return DEFAULT_TIMEOUT_MS
  if (raw < TIMEOUT_RANGE.min || raw > TIMEOUT_RANGE.max) return DEFAULT_TIMEOUT_MS
  return Math.trunc(raw)
}

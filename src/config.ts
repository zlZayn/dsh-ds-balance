/**
 * 插件配置：schemastery schema、常量与派生值。
 *
 * 字段名与 [UI 侧契约与移交](../docs/ui-handoff.md) 第六节逐字一致，共 **11** 个。
 * `timeoutMs` **不在 schema 里**：它是常量加环境变量覆盖，UI 不暴露。
 * @module dsh-ds-balance/config
 */

import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import { DEFAULT_BASE_URL } from './ports/deepseek-client.js'

/**
 * 本插件那一行的 Loader 条目 id —— **0.1.7 起它就是设置命名空间**。
 *
 * 三处按它索引，必须逐字一致：
 * - 宿主半边写设置：`ctx.settings.mutate(ENTRY_ID, ops)`；
 * - 浏览器半边读表单：`ctx.configForms.get(ENTRY_ID)`；
 * - `plugins.bundle.config` 的 key 取**包名**，今天与它同串（见 src/client/index.tsx
 *   的 `BUNDLE_CONFIG_KEY`）。
 *
 * 真源是 [cordis.patch.yml](../cordis.patch.yml) 的 `insert[0].id`，而它与
 * `package.json` 的 `name` 相同；三者由 `test/artifacts.test.ts` 对账。
 * 写错的表现分两种：槽 key 与包名漂开则该格整段不出现（不报错）；
 * form 那一路的 id 漂开则卡片在、表单永远只读。
 *
 * 浏览器半边**不许**从这里值导入（[src/AGENTS.md](AGENTS.md) 的跨半体禁令），
 * 它在 `src/client/index.tsx` 里写同一份字面量，由同一条断言对账。
 */
export const ENTRY_ID = 'dsh-ds-balance'

/**
 * 左下角条目在 `sidebar.footer.action` 里的 slot id。
 *
 * **它不是设置命名空间**（0.1.7 起与配置无关）—— 把它改成一个新值等于换掉
 * 那一条目的身份标识，而它与配置毫无关系。
 */
export const SIDEBAR_ENTRY_ID = 'ds-balance'

/** `displayCurrency` 的「跟随账户」取值。 */
export const CURRENCY_AUTO = 'auto'

/** 官方凭据的默认引用名。与 `llm-deepseek` 的默认逐字相同。 */
export const DEFAULT_API_KEY_REF = 'DEEPSEEK_API_KEY'

/**
 * 生效的端点基址。
 *
 * **空串翻译成官方默认地址的唯一一处**：界面默认留空（官方「网页搜索」卡片同款），
 * 用户填了就用填的。抓取与测连接都必须走这里，不许各自判空。
 * @param config - 至少含 `baseUrl` 的配置。
 * @returns 可以直接拼路径的基址。
 */
export function endpointOf(config: Pick<Config, 'baseUrl'>): string {
  const url = config.baseUrl.trim()
  return url === '' ? DEFAULT_BASE_URL : url
}

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
  /** 端点基址。**端点独立**，不继承对话适配器；**留空表示用官方默认地址**。 */
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
 * `apply` 实际收到的形状：每个字段都是一枚**只读引用**。
 *
 * 全字段都是 `.volatile()` 的，所以 Loader 给进来的是 `Volatile<T>` 而不是值：
 * 改配置时它把新值提交进运行中的引用并只重挂 volatile 部分 —— 本插件因此
 * **永不重挂**，`apply` 只跑一次。唯一读法是 `ref.get()`；插件侧没有任何 setter。
 *
 * 真源：宿主 `vendor/cosmokit/src/volatile.ts`（`Volatile<T>` 只有 `get()`）与
 * `vendor/loader/src/config/entry.ts` 的 `_commitVolatile`。
 */
export type ConfigRefs = { readonly [K in keyof Config]: Volatile<Config[K]> }

/**
 * 把引用面解成一份纯值配置。
 *
 * **每次现读**：引用里存的永远是最新值，所以不许把它缓存进字段。
 * @param refs - `apply` 收到的引用面。
 * @returns 当前生效的纯值配置。
 */
export function readConfig(refs: ConfigRefs): Config {
  return {
    apiKey: refs.apiKey.get(),
    apiKeyRef: refs.apiKeyRef.get(),
    baseUrl: refs.baseUrl.get(),
    serverRefreshSeconds: refs.serverRefreshSeconds.get(),
    clientPollSeconds: refs.clientPollSeconds.get(),
    manualRefreshCooldownSeconds: refs.manualRefreshCooldownSeconds.get(),
    displayCurrency: refs.displayCurrency.get(),
    cnyWarn: refs.cnyWarn.get(),
    cnyCritical: refs.cnyCritical.get(),
    usdWarn: refs.usdWarn.get(),
    usdCritical: refs.usdCritical.get(),
  }
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
 * **11 个字段全部 `.volatile()`**，两条独立理由，缺一不可：
 * 1. 只有 volatile 字段进得了表单 —— 宿主的 `volatileForm()` 在没有 volatile
 *    字段时返回 `undefined`，该行整条退出 `describe()`，于是
 *    `ctx.configForms.get(ENTRY_ID)` 拿到的快照永远不是 `ready`，
 *    卡片在、字段却一个都不出现（宿主 `packages/settings/settings/src/schema.ts`）。
 *    漏加一个字段不会报错，只会让那一个字段在表单里消失。
 * 2. 写入路径按 volatile 逐路径放行：非 volatile 路径直接抛
 *    `Config field "..." is not volatile`（宿主 `settings/src/index.ts` 的
 *    `write()`）。`apiKey` 不给它加，`POST /api/v1/config` 就会被宿主拒掉。
 *
 * 副作用是好的：全字段 volatile ⇒ Loader 永远判「只有 volatile 变了」⇒
 * 改配置**永不重挂**，`apply` 只跑一次。
 *
 * 阈值只在这里存储，前端不做金额比较：颜色由后端的 `severity` 决定。
 */
export const Config = z.object({
  apiKey: z.string().role('secret').default('').volatile(),
  apiKeyRef: z.string().role('credential-ref').default(DEFAULT_API_KEY_REF).volatile(),
  baseUrl: z.string().default('').volatile(),
  serverRefreshSeconds: z.natural().min(10).max(3600).default(60).volatile(),
  clientPollSeconds: z.natural().min(5).max(600).default(30).volatile(),
  manualRefreshCooldownSeconds: z.natural().min(0).max(600).default(30).volatile(),
  displayCurrency: z.string().default(CURRENCY_AUTO).volatile(),
  cnyWarn: z.number().min(0).default(10).volatile(),
  cnyCritical: z.number().min(0).default(5).volatile(),
  usdWarn: z.number().min(0).default(2).volatile(),
  usdCritical: z.number().min(0).default(1).volatile(),
})

/** 一对阈值：同一币种内的预警与告急。 */
export interface ThresholdPair {
  readonly currency: string
  readonly warn: keyof Config
  readonly critical: keyof Config
  /**
   * 这一对在 schema 里的默认值。
   *
   * 消费侧守卫要靠它回落 —— 用户手改配置文件写成非法组合时，我们只能给一个
   * 「至少是合法且可解释」的值。**与 schema 默认值的一致性由
   * `test/config.test.ts` 对着 `Config({})` 兜底**，不靠人记。
   */
  readonly defaultWarn: number
  readonly defaultCritical: number
}

/**
 * 阈值成对的清单。
 *
 * 字段名的约定是「币种代码小写 + Warn / Critical」；客户端按同一条约定把这两个字段
 * 归成一对来判（[use-config-form.ts](client/settings/use-config-form.ts) 的 `THRESHOLD_PAIRS`）。
 * 两边各存一份是因为**宿主与浏览器两个半体不许值导入**；约定本身由测试对着本表兜底。
 */
export const THRESHOLD_PAIRS = [
  { currency: 'CNY', warn: 'cnyWarn', critical: 'cnyCritical', defaultWarn: 10, defaultCritical: 5 },
  { currency: 'USD', warn: 'usdWarn', critical: 'usdCritical', defaultWarn: 2, defaultCritical: 1 },
] as const satisfies readonly ThresholdPair[]

/**
 * 跨字段校验：每个币种内 `critical` 必须**严格低于** `warn`。
 *
 * **0.1.7 起宿主侧不再有强制手段**，这是本轮迁移最硬的一处事实：
 * - `ctx.settings.register` 连同它的 `validate` 选项一起被删了；
 * - schemastery 没有 refine / superRefine，也没有 `.check()`（官方
 *   `docs/cookbook/adding-a-settings-card.md` 承诺了它，但实现里没有这个成员）；
 * - 根节点套任何 wrapper（`transform` / `intersect`）都会让 `volatileForm()`
 *   返回 `undefined` ⇒ 该行整条退出 `describe()` ⇒ **卡片彻底不出现**。
 *
 * 所以这条判据只剩两个落点：
 * 1. **消费侧守卫** —— [resolveThresholdPairs](#resolvethresholdpairs) 在每次现读时
 *    把非法的那一对回落成默认值并记一次 warn；
 * 2. **我们自己的写路径** —— `POST /api/v1/config` 在 `ctx.settings.mutate` 之前
 *    先跑这里，违反回 `422`（见 `src/http/handlers.ts`）。
 *
 * 官方 Plugins 页那条写路径**拦不住**：它是宿主直连的原子 mutate，只跑 schema。
 * 前端那道 `thresholdsOk` 因此仍是用户体验的唯一防线，而它只影响体验，不是强制。
 *
 * 为什么必须严格低于、不能相等：两者相等时余额恰好压线会被同时判成 warn 与 critical，
 * 「预警」这一档就不存在了。措辞锚在**告急**上 —— 用户要调的是那个偏低的数。
 * @param value - 合并后的完整配置。
 * @throws {Error} 违反约束时抛出；消息指向具体币种，便于用户定位。
 */
export function validateThresholds(value: Config): void {
  for (const pair of THRESHOLD_PAIRS) {
    const warn = value[pair.warn]
    const critical = value[pair.critical]
    if (critical < warn) continue
    throw new Error(`${pair.currency} 告急必须低于预警（当前 预警 ${String(warn)} / 告急 ${String(critical)}）`)
  }
}

/**
 * 消费侧守卫：把违反约束的那一对**回落成 schema 默认值**。
 *
 * 为什么不是「违反就整个插件不可用」：一次手改配置文件写错，惩罚不该是全部功能消失。
 * 为什么不是「干脆不校验」：那样会出现「预警档不存在」的静默错误 —— 余额恰好压线时
 * 同时判成 warn 与 critical，正是 `validateThresholds` 要避免的那件事。
 *
 * 与 `validateThresholds` 的关系：那个是**判据**（纯函数，违反即抛），本函数是
 * **消费侧的策略**（不抛，改正并报告）。判据只有一份，两处都用它。
 * @param value - 现读到的纯值配置。
 * @returns 修正后的配置，以及被回落过的币种（供调用方各记一次 warn）。
 */
export function resolveThresholdPairs(value: Config): { config: Config; violations: readonly string[] } {
  const violations: string[] = []
  let config = value
  for (const pair of THRESHOLD_PAIRS) {
    if (value[pair.critical] < value[pair.warn]) continue
    violations.push(pair.currency)
    if (config === value) config = { ...value }
    // 字段名是 `keyof Config`（值类型是 11 个字段的并集），逐键赋值 TS 推不出来，
    // 所以走一次数值视图 —— 这对字段在 schema 里本来就是数字。
    const numeric = config as unknown as Record<string, number>
    numeric[pair.warn] = pair.defaultWarn
    numeric[pair.critical] = pair.defaultCritical
  }
  return { config, violations }
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

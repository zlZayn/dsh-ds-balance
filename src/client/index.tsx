/**
 * 浏览器半边入口：注册词典、该行 Configure 子页上的配置卡片与左下角条目。
 *
 * 这两半各占一个 slot，互不依赖；配置卡片挂在 `plugins.row.config` 上，
 * key 是 `<包名>#<行 id>`。
 *
 * 两侧共用**同一个** {@link ConfigFormOf}：`ctx.configForms.get(ENTRY_ID)` 在 apply 期
 * 建一次、引用稳定。左下角条目不在 `plugins.row.config` 里，拿不到 slot props 递来的
 * form —— 而那个 props 本来就是同一个对象（宿主 `manager-store.ts:455` 就是
 * `id => this.ctx.configForms.get(id)`），所以只留这一条真源，不再有第二条读路径。
 *
 * 配置那一格另有一层**能力探测**（不查版本号）：卡片拿不到表单时宿主不会报错，
 * 只会静默什么都不显示。探测只决定要不要在浮层里提示，不参与注册 ——
 * 槽真的在时，下面那次 `inject` 照旧正常注册。见 [config-slot.ts](config-slot.ts)。
 * @module dsh-ds-balance/client
 */

import { useCallback, useSyncExternalStore, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
// 类型导入即声明：这两行让下面两个 slot 键的契约进入类型系统。
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { BalanceSettingsCard } from './settings/BalanceSettingsCard.tsx'
import { writeFieldValue } from './settings/use-config-form.ts'
import type { ConfigFormOf } from './settings/use-config-form.ts'
import { SidebarBalance, type PluginsNavigation } from './sidebar/SidebarBalance.tsx'
// 副作用导入：修正宿主 .footerActions 的排版遗漏，见 .agents/notes/2026-09-17-footer-stack-override.md。
import './sidebar/footer-stack.module.css'
import { NS, en, zh, type LocaleKey } from './locales.ts'
import { CONFIG_SLOT, createConfigSlotProbe, type ConfigSlotProbe } from './config-slot.ts'

/**
 * 本插件那一行的 Loader 条目 id —— **逐字抄自宿主半边的 `src/config.ts`**。
 *
 * 不许跨半体值导入（[src/AGENTS.md](../AGENTS.md)），所以这里是第二份字面量；
 * 两份必须逐字相等，且等于 `package.json` 的 `name` 与 `cordis.patch.yml` 的行 id ——
 * 三条由 `test/artifacts.test.ts` 对账。0.1.7 起它同时是**设置命名空间**：
 * 客户端按它取表单，写错的表现是卡片在、但拿不到 form。
 */
export const ENTRY_ID = 'dsh-ds-balance'

/**
 * `plugins.row.config` 的 key。
 *
 * 宿主 `rowConfigKey(bundle, rowId)`（`config-ledger.ts:36-38`）逐字是
 * `<包名>#<行 id>`；本插件两者相同，所以这个值看起来像写重复了。
 *
 * **写成字面量而不是拼接**：它是宿主**逐字比较**的键，而产物级断言
 * （`test/artifacts.test.ts`）要在打包后的信封里照字面找到它 —— 拼接出来的表达式
 * 在产物里是一段代码，不是一个键。拼接关系由 `test/redlines.test.ts` 对账。
 */
export const ROW_CONFIG_KEY = 'dsh-ds-balance#dsh-ds-balance'

/**
 * 左下角条目在 `sidebar.footer.action` 里的 slot id。
 *
 * **它不是设置命名空间**，0.1.7 起与配置无关；与宿主半边的 `SIDEBAR_ENTRY_ID` 逐字一致。
 */
export const SIDEBAR_ENTRY_ID = 'ds-balance'

/** 两条半体共享的默认值，用于快照缺字段时兜底。与宿主 schema 的默认值一致。 */
const DEFAULT_CONFIG = {
  displayCurrency: 'auto',
  manualRefreshCooldownSeconds: 30,
  clientPollSeconds: 30,
} as const

/**
 * 运行时服务门禁：删任何一项都会让 `apply` 静默不跑。
 *
 * 只留**永远在**的两项。`configForms` **不在这里**：它是可选服务，由 `apply` 内的
 * `ctx.inject` 把门 —— 缺它只该丢掉配置卡片，不该把左下角圆环一起拖死
 * （[src/AGENTS.md](../AGENTS.md) 的可选服务规则）。
 */
export const inject = ['slots', 'locale']

/** 组件拿到的 `t` 形状。真实类型来自 slot 的 locale 座位，这里只约束键集。 */
type Translate = (key: LocaleKey) => string

/** 把任意值收窄成普通对象；数组与 null 都当作空对象。 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * 订阅配置表单的快照。
 *
 * 官方契约明写 `getSnapshot()` 在两个快照之间返回**同一个引用**，所以可以直接交给
 * `useSyncExternalStore`，不需要外面再包一层缓存。
 * @param form - 该条目的配置表单，apply 期建一次，引用稳定。
 * @returns 当前快照。
 */
function useFormSnapshot(form: ConfigFormOf): ConfigFormSnapshot<Record<string, unknown>> {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** 生效值；缺字段（首帧）时收窄成空对象，读路径保持全域可读。 */
function useScopeValue(form: ConfigFormOf): Record<string, unknown> {
  return asRecord(useFormSnapshot(form).value)
}

/**
 * 订阅「宿主文档是否接受写入」。
 *
 * 为 false 时界面据此禁用写入入口，而不是让用户点完发现什么都没发生。
 * @param form - 该条目的配置表单。
 * @returns 当前是否接受写入。
 */
function useScopeWritable(form: ConfigFormOf): boolean {
  return useFormSnapshot(form).writable !== false
}

/** 从快照里取展示币种。 */
function readDisplayCurrency(value: Record<string, unknown>): string {
  const raw = value.displayCurrency
  return typeof raw === 'string' && raw.length > 0 ? raw : DEFAULT_CONFIG.displayCurrency
}

/** 从快照里取手动刷新冷却秒数。 */
function readCooldown(value: Record<string, unknown>): number {
  const raw = Number(value.manualRefreshCooldownSeconds)
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CONFIG.manualRefreshCooldownSeconds
}

/** 从快照里取客户端轮询秒数。下限跟 schema 的 5 秒对齐。 */
function readPollSeconds(value: Record<string, unknown>): number {
  const raw = Number(value.clientPollSeconds)
  return Number.isFinite(raw) && raw >= 5 ? raw : DEFAULT_CONFIG.clientPollSeconds
}

/**
 * 读某个币种的 warn 阈值。
 *
 * 字段名由宿主 schema 的约定拼出来：币种代码小写 + `Warn`（`cnyWarn` / `usdWarn`）。
 * 拼名而不是列表，是为了不在这里再抄一份币种清单 —— 加了新币种，设置卡片与宿主 schema
 * 各自登记，这里自动跟上。
 * **只服务圆环弧长**；颜色不走这里。
 * @param value - 设置快照里的生效值。
 * @param currency - 后端选定的展示币种。
 * @returns 阈值；没配或不是有限数时给 `undefined`。
 */
function readWarnThreshold(value: Record<string, unknown>, currency: string): number | undefined {
  const raw = Number(value[currency.toLowerCase() + 'Warn'])
  return Number.isFinite(raw) ? raw : undefined
}

/**
 * 配置指纹：任何一项设置改动都会换一个值，用来触发一次立刻重取。
 *
 * **不含 `apiKey` 本身**（密钥不进 React 的依赖字符串），只带一个「配没配」的布尔；
 * 其余字段按名字排序拼成稳定串，顺序不受对象键序影响。
 * @param value - 设置快照里的生效值。
 * @returns 稳定指纹。
 */
function readSignature(value: Record<string, unknown>): string {
  const parts = Object.keys(value)
    .filter((key) => key !== 'apiKey')
    .sort()
    .map((key) => key + '=' + String(value[key]))
  parts.push('apiKeySet=' + String(value.apiKey !== undefined && value.apiKey !== ''))
  return parts.join('\u0001')
}

/** 左下角条目的座位 props。 */
interface SidebarSeat {
  wide: boolean
  t: unknown
}

/**
 * 左下角条目。
 *
 * 注册常驻，不做动态注销：重新注册会换掉 React key，导致整棵子树重挂、局部状态丢失。
 * 「启用左下角」开关已删除：左下角是本插件唯一的展示位，关掉它等于关掉全部功能。
 */
function SidebarSeatComponent(
  props: {
    seat: SidebarSeat
    form: ConfigFormOf
    configSlotProbe: ConfigSlotProbe
    pluginsNavigation: PluginsNavigation
  },
): ReactNode {
  const value = useScopeValue(props.form)
  const writable = useScopeWritable(props.form)
  // 与设置卡片共用同一条写路径：写进本插件那一行的设置命名空间。
  // 成败由 writeFieldValue 的返回值直接给出，不再读回 user 层猜。
  const selectCurrency = useCallback(
    (currency: string): Promise<boolean> => writeFieldValue(props.form, 'displayCurrency', currency),
    [props.form],
  )
  return (
    <SidebarBalance
      wide={props.seat.wide}
      t={props.seat.t as Translate}
      configSlotProbe={props.configSlotProbe}
      pluginsNavigation={props.pluginsNavigation}
      onSelectCurrency={selectCurrency}
      config={{
        displayCurrency: readDisplayCurrency(value),
        manualRefreshCooldownSeconds: readCooldown(value),
        clientPollSeconds: readPollSeconds(value),
        configSignature: readSignature(value),
        warnThresholdOf: (currency) => readWarnThreshold(value, currency),
        writable,
      }}
    />
  )
}

/** 配置卡片的座位 props。 */
interface SettingsSeat {
  /**
   * 槽的 owner props 两个视图：
   * `page` 是那一行 Configure 子页里的表单；`summary` 是**该行没有描述时的回退**，
   * 渲染在标题下方那一行（宿主 `PluginManagerPage.tsx:496`）。
   */
  view: 'summary' | 'page'
  t: unknown
}

/**
 * Plugins 页里的配置卡片与该行的说明行。
 *
 * `summary` 不能再返回 null：本包没有发布展示元数据（`locale/*.json` 的 `meta.title` /
 * `meta.description`），所以行描述**永远是空的**，这一档必然被渲染 —— 返回 null 会在
 * 标题下留一个空 `<p>`。
 */
function SettingsSeatComponent(props: { seat: SettingsSeat; form: ConfigFormOf }): ReactNode {
  const t = props.seat.t as Translate
  switch (props.seat.view) {
    case 'page':
      return <BalanceSettingsCard t={t} form={props.form} />
    case 'summary':
      return t('settings.summary')
  }
}

/**
 * Plugins 面板的 id，逐字等于宿主 `ui-plugin-manager/src/client/index.ts:47` 的 `PANEL_ID`。
 *
 * 这里写字面量而**不 import** 那个常量：它是另一个 feature plugin 的值导出，
 * 跨插件值导入是本仓红线。
 */
const PLUGINS_PANEL_ID = 'plugins'

/**
 * 宿主 layout 服务里我们真正会碰到的成员。
 *
 * 鸭子类型收窄：本仓不装 `@deepseek-ai/dsh-client-ui-layout`，不 import 它的类型 ——
 * 与下面 `RawScope` 同一套做法。公开面见宿主 `ui-layout/src/client/service.ts:28-52` 的 `ILayout`。
 */
interface LayoutFace {
  /** @param panelId - 已注册的 main 面板 key；未注册时**会抛**。 */
  selectPanel?: (panelId: string) => void
}

/** apply 期的入口句柄：比座位拿到的 {@link PluginsNavigation} 多一个挂载点。 */
interface PluginsNavigationHandle extends PluginsNavigation {
  /**
   * 服务到位时挂上导航回调。
   * @param open - 切到 Plugins 页的动作。
   * @returns 反注册；服务被卸载时图标跟着消失。
   */
  attach: (open: () => void) => () => void
}

/**
 * 建一个可订阅的「切到 Plugins 页」入口。
 *
 * 为什么要订阅而不是直接给个 prop：`ctx.inject(['layout'])` 的回调可能在座位注册之后才跑
 * （服务晚到），那时 prop 已经绑好了。订阅让图标随服务出现、也随它消失。
 * @returns 入口句柄。
 */
function createPluginsNavigation(): PluginsNavigationHandle {
  let open: (() => void) | undefined
  const listeners = new Set<() => void>()
  const publish = (next: (() => void) | undefined): void => {
    if (next === open) return
    open = next
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => open,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    attach: (callback) => {
      publish(callback)
      return () => { if (open === callback) publish(undefined) }
    },
  }
}

/** 挂载两半。 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ds-balance: dictionaries')

  // 探测配置那一格在不在：新宿主由 ui-plugin-manager 的浏览器半边在 apply 期声明它，
  // 旧宿主永不声明。三种态都可逆，所以晚到的声明会把已经出现的提示撤掉。
  const configSlotProbe = createConfigSlotProbe()
  ctx.effect(() => () => configSlotProbe.dispose(), 'ds-balance: config slot probe')

  // 「切到 Plugins 页」的入口：宿主把它放在跨插件服务 `ctx.layout` 上
  // （宿主 `ui-layout/src/client/service.ts:28-52`：cross-plugin panel-action face behind ctx.layout）。
  // 服务不在 —— 例如 profile 里没装 plugin-manager —— 时整条链不建立，
  // 浮层右上角那个图标就不渲染：不留按不动的死按钮。
  // layout 刻意**不进顶层 inject**：缺服务会让整个插件不装载。
  const pluginsNavigation = createPluginsNavigation()
  ctx.inject(['layout'], (layoutCtx) => {
    const face = (layoutCtx as unknown as { layout?: LayoutFace }).layout
    // 服务在但长得不对（宿主换了实现）时同样什么都不做 —— 没图标，好过点了会炸。
    if (face === undefined || typeof face.selectPanel !== 'function') return
    // 绑回服务对象：宿主的 selectPanel 内部要用 this（LayoutController 的 panels 与 navigation）。
    const selectPanel = face.selectPanel.bind(face)
    layoutCtx.effect(() => pluginsNavigation.attach(() => {
      try {
        selectPanel(PLUGINS_PANEL_ID)
      } catch (error) {
        // 面板 id 未注册时 selectPanel 会抛（宿主 `ui-layout/src/client/service.ts:69-71`）：
        // profile 里没装 plugin-manager 时那个 main 面板不存在，点了图标就没地方可去。
        // 只记一笔，不做别的：浮层已经关了，圆环与后端照常。
        console.warn('[WARN] ds-balance: cannot switch to the plugins panel', error)
      }
    }), 'ds-balance: plugins panel navigation')
  })

  // 配置是可选服务：缺它只丢卡片，左下角圆环照常。
  ctx.inject(['configForms'], (configCtx) => {
    // 一条读路径、一条写路径。两侧共用同一个 form —— 左下角条目不在 plugins.row.config
    // 里、拿不到 slot props，而 props 里的 form 本来就是同一个对象，没有第二条真源。
    const form = configCtx.configForms.get<Record<string, unknown>>(ENTRY_ID)

    // 卡片的 key 是 rowConfigKey(包名, 行 id)：宿主按它决定这一行有没有 Configure 控件，
    // 写错就整块不出现，也不会报错。
    ctx.slots.inject(CONFIG_SLOT, () => {
      configSlotProbe.markDeclared()
      return ctx.slots.register(
        { name: CONFIG_SLOT, key: ROW_CONFIG_KEY, locale: NS },
        (seat: SettingsSeat) => <SettingsSeatComponent seat={seat} form={form} />,
      )
    })

    ctx.slots.inject('sidebar.footer.action', () =>
      ctx.slots.register(
        { name: 'sidebar.footer.action', id: SIDEBAR_ENTRY_ID, order: 0, locale: NS },
        (seat: SidebarSeat) => (
          <SidebarSeatComponent
            seat={seat}
            form={form}
            configSlotProbe={configSlotProbe}
            pluginsNavigation={pluginsNavigation}
          />
        ),
      ))
  })
}

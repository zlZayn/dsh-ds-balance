/**
 * 浏览器半边入口：注册词典、设置卡片与左下角条目。
 *
 * 这两半各占一个 slot，互不依赖；设置卡片的位置由宿主 `installSection` 与
 * 本文件注册的 `settings.plugin.item` 用同一个命名空间配对决定。
 * @module dsh-ds-balance/client
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// 类型导入即声明：这两行让下面两个 slot 键的契约进入类型系统。
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { BalanceSettingsCard } from './settings/BalanceSettingsCard.tsx'
import type { SettingsScope, SettingsScopeSnapshotLike } from './settings/use-config-form.ts'
import { SidebarBalance } from './sidebar/SidebarBalance.tsx'
// 副作用导入：修正宿主 .footerActions 的排版遗漏，见 .agents/notes/2026-09-17-footer-stack-override.md。
import './sidebar/footer-stack.module.css'
import { NS, en, zh, type LocaleKey } from './locales.ts'

/** 设置命名空间：与宿主 `SETTINGS_NAMESPACE` 逐字一致。 */
export const SETTINGS_NAMESPACE = 'ds-balance'

/** 两条半体共享的默认值，用于快照缺字段时兜底。与宿主 schema 的默认值一致。 */
const DEFAULT_CONFIG = {
  displayCurrency: 'auto',
  manualRefreshCooldownSeconds: 30,
  clientPollSeconds: 30,
} as const

/**
 * 运行时服务门禁：删任何一项都会让 `apply` 静默不跑。
 * 这里只需要 slot、词典与设置作用域三个服务。
 */
export const inject = ['slots', 'locale', 'settingsScope']

/** 组件拿到的 `t` 形状。真实类型来自 slot 的 locale 座位，这里只约束键集。 */
type Translate = (key: LocaleKey) => string

/** 宿主作用域的形状，只声明适配层真正会碰到的成员。 */
interface RawScope {
  getSnapshot?: () => { value?: unknown; user?: unknown; writable?: unknown } | undefined
  subscribe?: (listener: () => void) => () => void
  set?: (field: string, value: unknown) => void
  unset?: (field: string) => void
}

/** 把任意值收窄成普通对象；数组与 null 都当作空对象。 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * 把宿主返回的作用域包成卡片依赖的最小面。
 *
 * 两处刻意为之：
 * 1. 用鸭子类型而不是断言具体实现，缺方法时退化成只读，不让整张卡片装不上。
 * 2. `set` / `unset` 的返回值原样透传。宿主拒绝写入时不抛错，调用方要靠快照
 *    的 user 层读回判定成败；把 Promise 丢掉会让每次保存都误报失败。
 */
function adaptScope(raw: unknown): SettingsScope {
  const scope = raw as RawScope
  return {
    getSnapshot: (): SettingsScopeSnapshotLike => {
      const snapshot = typeof scope.getSnapshot === 'function' ? scope.getSnapshot() : undefined
      return {
        value: asRecord(snapshot?.value),
        user: asRecord(snapshot?.user),
        writable: typeof snapshot?.writable === 'boolean' ? snapshot.writable : true,
      }
    },
    subscribe: (listener) => {
      const dispose = typeof scope.subscribe === 'function' ? scope.subscribe(listener) : undefined
      return typeof dispose === 'function' ? dispose : () => {}
    },
    set: (field, value) => scope.set?.(field, value),
    unset: (field) => scope.unset?.(field),
  }
}

/** 订阅设置快照。对象在 `apply` 期建一次，引用稳定，不会每帧重订阅。 */
function useScopeValue(scope: SettingsScope): Record<string, unknown> {
  const [value, setValue] = useState(() => scope.getSnapshot().value)
  useEffect(() => {
    setValue(scope.getSnapshot().value)
    return scope.subscribe(() => { setValue(scope.getSnapshot().value) })
  }, [scope])
  return value
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
function SidebarSeatComponent(props: { seat: SidebarSeat; scope: SettingsScope }): ReactNode {
  const value = useScopeValue(props.scope)
  return (
    <SidebarBalance
      wide={props.seat.wide}
      t={props.seat.t as Translate}
      config={{
        displayCurrency: readDisplayCurrency(value),
        manualRefreshCooldownSeconds: readCooldown(value),
        clientPollSeconds: readPollSeconds(value),
        configSignature: readSignature(value),
      }}
    />
  )
}

/** 设置卡片的座位 props。 */
interface SettingsSeat {
  t: unknown
}

/** 设置卡片。宿主没服务这个命名空间时面板不会渲染这张卡，这里不需要额外判断。 */
function SettingsSeatComponent(props: { seat: SettingsSeat; scope: SettingsScope }): ReactNode {
  return <BalanceSettingsCard t={props.seat.t as Translate} scope={props.scope} />
}

/** 挂载两半。 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ds-balance: dictionaries')

  const scope = adaptScope(ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE }))

  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      { name: 'settings.plugin.item', key: SETTINGS_NAMESPACE, locale: NS },
      (seat: SettingsSeat) => <SettingsSeatComponent seat={seat} scope={scope} />,
    ))

  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: SETTINGS_NAMESPACE, order: 0, locale: NS },
      (seat: SidebarSeat) => <SidebarSeatComponent seat={seat} scope={scope} />,
    ))
}

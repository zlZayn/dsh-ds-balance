/**
 * mock 场景解析与切换。
 *
 * **默认走真实端点**：只有 URL 参数或 localStorage 明确选过场景时才使用 mock，
 * 否则插件在真机上会永远显示 demo 数据。带 `?dsb=live` 打开会清掉已存的选择。
 *
 * 任何一步失败都静默回落到下一档：mock 层不允许把页面搞崩。
 * @module dsh-ds-balance/client/mock
 */

import type { BalanceResponse } from '../api-types.ts'
import { defaultScenario, isScenarioKey, scenarios, type ScenarioKey } from './scenarios.ts'

/** URL 查询参数名。 */
export const SCENARIO_PARAM = 'dsb'

/** `?dsb=` 的这个取值表示「回到真实端点」，并顺手清掉已存的场景。 */
export const LIVE_PARAM_VALUE = 'live'

/** localStorage 键。 */
const STORAGE_KEY = 'ds-balance:scenario'

/** 安全读 localStorage：隐私模式下会抛。 */
function readStored(): ScenarioKey | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    return raw !== null && raw !== undefined && isScenarioKey(raw) ? raw : null
  } catch {
    return null
  }
}

/** 安全写 localStorage。 */
function writeStored(key: ScenarioKey): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, key)
  } catch {
    /* 存不进去不影响本次会话 */
  }
}

/** 安全清 localStorage。 */
function clearStored(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    /* 同上 */
  }
}

/** 读当前 URL 的查询参数。 */
function readParam(name: string): string | null {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get(name)
  } catch {
    return null
  }
}

/**
 * 当前生效的 mock 场景键；**该走真实端点时返回 `null`**。
 *
 * 这是唯一会写 localStorage 的读入口：`?dsb=live` 会顺手把已存的选择清掉。
 * @returns 场景键，或 `null` 表示用真实端点。
 */
export function resolveScenario(): ScenarioKey | null {
  const fromUrl = readParam(SCENARIO_PARAM)
  if (fromUrl === LIVE_PARAM_VALUE) {
    clearStored()
    return null
  }
  if (fromUrl !== null && isScenarioKey(fromUrl)) {
    writeStored(fromUrl)
    return fromUrl
  }
  return readStored()
}

/** 当前生效的场景键；走真实端点时回落到默认场景。 */
function currentScenario(): ScenarioKey {
  return resolveScenario() ?? defaultScenario
}

/**
 * 订阅场景变化。回调**立即收到一次当前值**，返回退订函数。
 *
 * 现有调用方（`SidebarBalance`）只用它那一次立即回调来对账「现在走不走 mock」——
 * 因为**场景在运行期不会变**：唯一的入口是 URL 参数（刷新页面才重新解析）。
 *
 * **想加回场景切换器**（曾经的 `?dsb-dev` + `setScenario()` + `notifyScenario()` 三件套，
 * 见 [README.md](README.md)）时：把那两个函数加回来、在这里调 `notifyScenario(key)` 即可 ——
 * 注册表与订阅语义都还在下面。本轮把它们删掉是因为它们**全仓零引用**
 * （`isDevMode` / `DEV_PARAM` / `setScenario` / `notifyScenario`），
 * 而配套的两条词典键也是孤儿键。
 */
export function subscribeScenario(listener: (key: ScenarioKey) => void): () => void {
  listeners.add(listener)
  listener(currentScenario())
  return () => {
    listeners.delete(listener)
  }
}

const listeners = new Set<(key: ScenarioKey) => void>()

/** 取当前场景的数据快照。 */
export function currentBalance(): BalanceResponse {
  return scenarios[currentScenario()]
}

/**
 * mock 场景解析与切换。
 *
 * 解析优先级：URL 参数 `dsb` → localStorage → 默认场景。
 * 任何一步失败都静默回落到下一档：mock 层不允许把页面搞崩。
 * @module dsh-ds-balance/client/mock
 */

import type { BalanceResponse } from '../api-types.ts'
import { defaultScenario, isScenarioKey, scenarios, type ScenarioKey } from './scenarios.ts'

/** URL 查询参数名。 */
export const SCENARIO_PARAM = 'dsb'

/** 开发模式参数名：出现即显示场景切换器。 */
export const DEV_PARAM = 'dsb-dev'

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

/** 读当前 URL 的查询参数。 */
function readParam(name: string): string | null {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get(name)
  } catch {
    return null
  }
}

/** 当前生效的场景键。 */
export function currentScenario(): ScenarioKey {
  const fromUrl = readParam(SCENARIO_PARAM)
  if (fromUrl !== null && isScenarioKey(fromUrl)) {
    writeStored(fromUrl)
    return fromUrl
  }
  return readStored() ?? defaultScenario
}

/** 切换场景并持久化；刷新页面后仍生效。 */
export function setScenario(key: ScenarioKey): void {
  writeStored(key)
}

/** 是否处于开发模式（显示场景切换器）。 */
export function isDevMode(): boolean {
  return readParam(DEV_PARAM) !== null
}

/** 订阅场景变化。回调立即收到一次当前值，返回退订函数。 */
export function subscribeScenario(listener: (key: ScenarioKey) => void): () => void {
  listeners.add(listener)
  listener(currentScenario())
  return () => { listeners.delete(listener) }
}

const listeners = new Set<(key: ScenarioKey) => void>()

/** 通知所有订阅者场景已变。 */
export function notifyScenario(key: ScenarioKey): void {
  for (const listener of listeners) listener(key)
}

/** 取当前场景的数据快照。 */
export function currentBalance(): BalanceResponse {
  return scenarios[currentScenario()]
}

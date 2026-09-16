/**
 * 严重度判定。
 *
 * **阈值只在这里被读**：前端不参与任何金额比较，颜色完全来自本模块的输出。
 * @module dsh-ds-balance/domain/severity
 */

import type { BalanceInfo, Currency, Severity, ThresholdPair } from './balance.js'
import { cmpMoney, parseMoney } from './money.js'

/** 判定阈值所需的配置切片。 */
export interface ThresholdConfig {
  cnyWarn: number
  cnyCritical: number
  usdWarn: number
  usdCritical: number
}

/** 阈值按币种取；没有专属配置的币种一律 `{ warn: 0, critical: 0 }`。 */
export function thresholdsOf(config: ThresholdConfig): Record<Currency, ThresholdPair> {
  return {
    CNY: { warn: parseMoney(config.cnyWarn), critical: parseMoney(config.cnyCritical) },
    USD: { warn: parseMoney(config.usdWarn), critical: parseMoney(config.usdCritical) },
  }
}

/**
 * 取某个币种的阈值。
 * @param currency - 币种代码。
 * @param thresholds - {@link thresholdsOf} 的产物。
 * @returns 该币种的阈值；没有配置时返回全零，使该币种永远判为 `ok`。
 */
export function thresholdsFor(currency: Currency, thresholds: Record<Currency, ThresholdPair>): ThresholdPair {
  return thresholds[currency] ?? { warn: 0n, critical: 0n }
}

/**
 * 判定严重度。
 *
 * 顺序即优先级：**不可用压过阈值**；没有任何选定币种时为 `unknown`。
 * @param selected - 选定的币种余额；为 `null` 时返回 `unknown`。
 * @param isAvailable - 上游 `is_available`。
 * @param thresholds - 该币种的阈值。
 * @returns 闭集内的严重度。
 */
export function severityOf(selected: BalanceInfo | null, isAvailable: boolean, thresholds: ThresholdPair): Severity {
  if (selected === null) return 'unknown'
  if (!isAvailable) return 'unavailable'
  if (cmpMoney(selected.total, thresholds.critical) <= 0) return 'critical'
  if (cmpMoney(selected.total, thresholds.warn) <= 0) return 'warn'
  return 'ok'
}

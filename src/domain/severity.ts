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
export function thresholdsFor(
  currency: Currency,
  thresholds: Record<Currency, ThresholdPair>,
): ThresholdPair {
  return thresholds[currency] ?? { warn: 0n, critical: 0n }
}

/**
 * 判定严重度。
 *
 * **顺序即优先级，且顺序本身是有意的**：
 * 1. **账户停用压过一切**（`!isAvailable`）—— 它是账户维度的事实，与有没有选中币种无关。
 *    欠费/停用的账户上游可能给**空的** `balance_infos`，那也会有 `selected === null`；
 *    若先判 `selected === null` 就会返回 `unknown`，界面把「账户停用」画成灰环，
 *    与「账户本来就没有余额」同形 —— 这条顺序就是为它定的。
 * 2. 没有任何选定币种（且账户可用）→ `unknown`：真的一无所有，没有信息可表。
 * 3. 其余按阈值分档，边界取等号。
 * @param selected - 选定的币种余额；为 `null` 时若账户不可用仍返回 `unavailable`。
 * @param isAvailable - 上游 `is_available`。
 * @param thresholds - 该币种的阈值。
 * @returns 闭集内的严重度。
 */
export function severityOf(
  selected: BalanceInfo | null,
  isAvailable: boolean,
  thresholds: ThresholdPair,
): Severity {
  // 顺序不能换：见上面第 1 条（停用 + 空余额列表是一条真实路径）。
  if (!isAvailable) return 'unavailable'
  if (selected === null) return 'unknown'
  if (cmpMoney(selected.total, thresholds.critical) <= 0) return 'critical'
  if (cmpMoney(selected.total, thresholds.warn) <= 0) return 'warn'
  return 'ok'
}

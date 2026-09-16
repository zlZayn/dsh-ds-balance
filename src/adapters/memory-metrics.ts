/**
 * 内存指标登记表。
 *
 * dsh 的默认组合里**没有指标 sink**，所以这个实现把聚合值留在内存里，
 * 由 `GET /api/v1/healthz` 的 `metrics` 段暴露出去 —— 否则 §12 的四个指标
 * 就只是「调用了一个空函数」，谁也看不见。
 *
 * 键的构造规则：`名字{标签=值,...}`，标签按键名排序，保证同一组标签得到同一个键。
 * @module dsh-ds-balance/adapters/memory-metrics
 */

import type { HistogramSummary, Metrics, MetricsSnapshot } from '../ports/metrics.js'

/** 键与标签值里不能出现的字符。出现时替换成下划线，避免键互相吞并。 */
const UNSAFE = /[^A-Za-z0-9_.:-]/g

/** 转义一段键或标签值。 */
function escape(part: string): string {
  return part.replace(UNSAFE, '_')
}

/**
 * 组装指标键。
 * @param name - 指标名。
 * @param labels - 标签；省略或为空时键就是名字本身。
 * @returns 稳定的键。
 */
export function metricKey(name: string, labels?: Record<string, string>): string {
  const entries = Object.entries(labels ?? {})
  if (entries.length === 0) return escape(name)
  const rendered = entries
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${escape(key)}=${escape(value)}`)
    .join(',')
  return `${escape(name)}{${rendered}}`
}

/** 内存指标登记表。 */
export class MemoryMetrics implements Metrics {
  private readonly counters = new Map<string, number>()
  private readonly gauges = new Map<string, number>()
  private readonly histograms = new Map<string, HistogramSummary>()

  counter(name: string, labels?: Record<string, string>): void {
    const key = metricKey(name, labels)
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1)
  }

  gauge(name: string, labels: Record<string, string>, value: number): void {
    this.gauges.set(metricKey(name, labels), value)
  }

  histogram(name: string, labels: Record<string, string>, value: number): void {
    const key = metricKey(name, labels)
    const current = this.histograms.get(key)
    this.histograms.set(key, current === undefined
      ? { count: 1, sum: value, min: value, max: value, last: value }
      : {
        count: current.count + 1,
        sum: current.sum + value,
        min: Math.min(current.min, value),
        max: Math.max(current.max, value),
        last: value,
      })
  }

  /** 当前聚合值的一份拷贝。 */
  snapshot(): MetricsSnapshot {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(
        [...this.histograms].map(([key, value]) => [key, { ...value }]),
      ),
    }
  }
}

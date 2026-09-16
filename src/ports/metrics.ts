/**
 * 指标端口。
 * @module dsh-ds-balance/ports/metrics
 */

/** 计数、仪表与直方图。 */
export interface Metrics {
  counter(name: string, labels?: Record<string, string>): void
  gauge(name: string, labels: Record<string, string>, value: number): void
  histogram(name: string, labels: Record<string, string>, value: number): void
}

/** 一个直方图的聚合值。 */
export interface HistogramSummary {
  count: number
  sum: number
  min: number
  max: number
  /** 最近一次的观测值。 */
  last: number
}

/**
 * 指标快照。
 *
 * 键是 `名字{标签=值,...}` 的形式，标签按键名排序 —— 同一组标签永远得到同一个键。
 */
export interface MetricsSnapshot {
  counters: Record<string, number>
  gauges: Record<string, number>
  histograms: Record<string, HistogramSummary>
}

/** 能读出聚合值的指标实现。没有外部 sink 的装配靠它把数字暴露出去。 */
export interface ReadableMetrics extends Metrics {
  snapshot(): MetricsSnapshot
}

/** 什么都不做的实现，用于测试与未接线的装配。 */
export const noopMetrics: Metrics = {
  counter: () => {},
  gauge: () => {},
  histogram: () => {},
}

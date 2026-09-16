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

/** 什么都不做的实现，用于测试与未接线的装配。 */
export const noopMetrics: Metrics = {
  counter: () => {},
  gauge: () => {},
  histogram: () => {},
}

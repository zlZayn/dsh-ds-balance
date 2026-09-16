import { describe, expect, it } from 'vitest'
import { MemoryMetrics, metricKey } from '../src/adapters/memory-metrics.ts'

describe('metricKey', () => {
  it('没有标签时就是名字本身', () => {
    expect(metricKey('force_rejected_total')).toBe('force_rejected_total')
    expect(metricKey('balance_fetch_total', {})).toBe('balance_fetch_total')
  })

  it('标签按键名排序，同一组标签永远得到同一个键', () => {
    expect(metricKey('m', { b: '2', a: '1' })).toBe('m{a=1,b=2}')
    expect(metricKey('m', { a: '1', b: '2' })).toBe(metricKey('m', { b: '2', a: '1' }))
  })

  it('不安全字符换成下划线，避免键互相吞并', () => {
    expect(metricKey('m', { result: 'a b{c}' })).toBe('m{result=a_b_c_}')
  })
})

describe('MemoryMetrics', () => {
  it('计数按标签分开累加', () => {
    const metrics = new MemoryMetrics()
    metrics.counter('balance_fetch_total', { result: 'ok' })
    metrics.counter('balance_fetch_total', { result: 'ok' })
    metrics.counter('balance_fetch_total', { result: 'error' })
    expect(metrics.snapshot().counters).toEqual({
      'balance_fetch_total{result=ok}': 2,
      'balance_fetch_total{result=error}': 1,
    })
  })

  it('仪表保留最后一个值', () => {
    const metrics = new MemoryMetrics()
    metrics.gauge('cache_state', { state: 'ok' }, 1)
    metrics.gauge('cache_state', { state: 'stale' }, 1)
    expect(metrics.snapshot().gauges).toEqual({
      'cache_state{state=ok}': 1,
      'cache_state{state=stale}': 1,
    })
  })

  it('直方图给出 count / sum / min / max / last', () => {
    const metrics = new MemoryMetrics()
    for (const value of [10, 30, 20]) metrics.histogram('balance_fetch_duration_ms', {}, value)
    expect(metrics.snapshot().histograms['balance_fetch_duration_ms']).toEqual({
      count: 3, sum: 60, min: 10, max: 30, last: 20,
    })
  })

  it('快照是拷贝，之后写入不会改到已取出的那份', () => {
    const metrics = new MemoryMetrics()
    metrics.counter('a')
    const first = metrics.snapshot()
    metrics.counter('a')
    expect(first.counters.a).toBe(1)
    expect(metrics.snapshot().counters.a).toBe(2)
  })

  it('没写过的指标类型是空对象而不是 undefined', () => {
    expect(new MemoryMetrics().snapshot()).toEqual({ counters: {}, gauges: {}, histograms: {} })
  })
})

import { describe, expect, it } from 'vitest'
import { endpointOf } from '../src/config.ts'
import {
  DEFAULT_TIMEOUT_MS, TIMEOUT_ENV, resolveThresholdPairs, resolveTimeoutMs, type Config,
} from '../src/config.ts'
import { DEFAULT_BASE_URL } from '../src/ports/deepseek-client.ts'

/** 一份合法的纯值配置；各用例只覆写关心的字段。 */
function configOf(patch: Partial<Config> = {}): Config {
  return {
    apiKey: '',
    apiKeyRef: 'DEEPSEEK_API_KEY',
    baseUrl: '',
    serverRefreshSeconds: 60,
    clientPollSeconds: 30,
    manualRefreshCooldownSeconds: 30,
    displayCurrency: 'auto',
    cnyWarn: 10,
    cnyCritical: 5,
    usdWarn: 2,
    usdCritical: 1,
    ...patch,
  }
}

describe('resolveTimeoutMs', () => {
  it('没有环境变量时用常量', () => {
    expect(resolveTimeoutMs({})).toBe(DEFAULT_TIMEOUT_MS)
    expect(DEFAULT_TIMEOUT_MS).toBe(8000)
  })

  it('环境变量覆盖', () => {
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '15000' })).toBe(15000)
  })

  it('越界回落常量', () => {
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '999' })).toBe(DEFAULT_TIMEOUT_MS)
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '60001' })).toBe(DEFAULT_TIMEOUT_MS)
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '0' })).toBe(DEFAULT_TIMEOUT_MS)
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '-1' })).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('不可解析回落常量', () => {
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: 'abc' })).toBe(DEFAULT_TIMEOUT_MS)
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '' })).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('小数截断成整数', () => {
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '1234.9' })).toBe(1234)
  })

  it('边界值可用', () => {
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '1000' })).toBe(1000)
    expect(resolveTimeoutMs({ [TIMEOUT_ENV]: '60000' })).toBe(60000)
  })
})

/**
 * 消费侧守卫。
 *
 * 0.1.7 起宿主侧没有跨字段钩子（register 的 validate 被删、schema 没有 refine、
 * 官方文档承诺的 .check() 在实现里不存在），所以「非法阈值对」只能在读的时候兜。
 * 判据是【不抛、改正、报告】—— 一次手改配置文件写错，惩罚不该是全部功能消失。
 */
describe('resolveThresholdPairs', () => {
  it('合法时原样返回，且不复制对象', () => {
    const config = configOf()
    const result = resolveThresholdPairs(config)
    expect(result.violations).toEqual([])
    expect(result.config).toBe(config)
  })

  it('告急不低于预警时，那一对回落成 schema 默认值', () => {
    const result = resolveThresholdPairs(configOf({ cnyWarn: 3, cnyCritical: 3 }))
    expect(result.violations).toEqual(['CNY'])
    expect(result.config.cnyWarn).toBe(10)
    expect(result.config.cnyCritical).toBe(5)
    // 没违规的那个币种不动。
    expect(result.config.usdWarn).toBe(2)
    expect(result.config.usdCritical).toBe(1)
  })

  it('回落之后一定合法 —— 否则守卫会把用户带进另一个非法状态', () => {
    const result = resolveThresholdPairs(configOf({ usdWarn: 0, usdCritical: 7, cnyWarn: 1, cnyCritical: 9 }))
    expect([...result.violations].sort()).toEqual(['CNY', 'USD'])
    expect(result.config.cnyCritical).toBeLessThan(result.config.cnyWarn)
    expect(result.config.usdCritical).toBeLessThan(result.config.usdWarn)
  })

  it('不改动传进来的那份（引用面可能正被别处读）', () => {
    const original = configOf({ cnyWarn: 3, cnyCritical: 3 })
    resolveThresholdPairs(original)
    expect(original.cnyWarn).toBe(3)
    expect(original.cnyCritical).toBe(3)
  })
})

describe('endpointOf', () => {
  it('留空用官方默认地址 —— 界面默认就是空的', () => {
    expect(endpointOf({ baseUrl: '' })).toBe(DEFAULT_BASE_URL)
    expect(endpointOf({ baseUrl: '   ' })).toBe(DEFAULT_BASE_URL)
  })

  it('填了就用填的，顺手去掉尾部斜杠带来的空白', () => {
    expect(endpointOf({ baseUrl: ' https://proxy.example.com ' })).toBe('https://proxy.example.com')
    expect(endpointOf({ baseUrl: 'https://proxy.example.com' })).toBe('https://proxy.example.com')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { ConfigService, type ConfigSource } from '../src/services/config-service.ts'
import { DEFAULT_TIMEOUT_MS, TIMEOUT_ENV, type Config } from '../src/config.ts'

function makeConfig(patch: Partial<Config> = {}): Config {
  return {
    apiKey: '',
    apiKeyRef: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
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

function source(config: Config): ConfigSource & { set(next: Config): void } {
  let current = config
  const listeners = new Set<(next: Config, previous: Config) => void>()
  return {
    set(next) {
      const previous = current
      current = next
      for (const listener of listeners) listener(next, previous)
    },
    get: () => current,
    watch: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

describe('ConfigService', () => {
  it('现读配置而不是缓存', () => {
    const src = source(makeConfig())
    const service = new ConfigService({ source: src, env: {} })
    expect(service.displayCurrency()).toBe('auto')
    src.set(makeConfig({ displayCurrency: 'USD' }))
    expect(service.displayCurrency()).toBe('USD')
  })

  it('阈值从当前配置派生', () => {
    const service = new ConfigService({ source: source(makeConfig({ cnyWarn: 20 })), env: {} })
    expect(service.thresholds().CNY!.warn).toBe(20n * 100_000_000n)
  })

  it('超时每次现读环境变量', () => {
    const env: Record<string, string | undefined> = {}
    const service = new ConfigService({ source: source(makeConfig()), env })
    expect(service.timeoutMs()).toBe(DEFAULT_TIMEOUT_MS)
    env[TIMEOUT_ENV] = '12000'
    expect(service.timeoutMs()).toBe(12000)
  })

  it('订阅变更并可退订', () => {
    const src = source(makeConfig())
    const service = new ConfigService({ source: src, env: {} })
    const seen = vi.fn()
    const off = service.watch(seen)
    src.set(makeConfig({ cnyWarn: 99 }))
    expect(seen).toHaveBeenCalledTimes(1)
    off()
    src.set(makeConfig({ cnyWarn: 1 }))
    expect(seen).toHaveBeenCalledTimes(1)
  })
})

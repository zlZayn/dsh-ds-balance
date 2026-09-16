import { describe, expect, it, vi } from 'vitest'
import { CREDENTIAL_REF_PATTERN, KeyResolver } from '../src/services/key-resolver.ts'
import { NoKeyError } from '../src/domain/errors.ts'
import type { Credentials } from '../src/ports/credentials.ts'

const base = { apiKey: '', apiKeyRef: 'DEEPSEEK_API_KEY' }

describe('解析链优先级', () => {
  it('配置里的 apiKey 最优先', async () => {
    const credentials: Credentials = { resolve: vi.fn(), describe: vi.fn() }
    const resolver = new KeyResolver({ readConfig: () => ({ ...base, apiKey: 'sk-override' }), credentials, env: {} })
    await expect(resolver.resolve()).resolves.toBe('sk-override')
    expect(credentials.resolve).not.toHaveBeenCalled()
  })

  it('其次走凭据服务', async () => {
    const credentials: Credentials = {
      resolve: vi.fn().mockResolvedValue({ value: 'sk-from-store', source: 'env' }),
      describe: vi.fn(),
    }
    const resolver = new KeyResolver({ readConfig: () => base, credentials, env: { DEEPSEEK_API_KEY: 'sk-env' } })
    await expect(resolver.resolve()).resolves.toBe('sk-from-store')
  })

  it('凭据空值继续走环境变量', async () => {
    const credentials: Credentials = {
      resolve: vi.fn().mockResolvedValue({ value: '   ', source: 'env' }),
      describe: vi.fn(),
    }
    const resolver = new KeyResolver({ readConfig: () => base, credentials, env: { DEEPSEEK_API_KEY: 'sk-env' } })
    await expect(resolver.resolve()).resolves.toBe('sk-env')
  })

  it('凭据抛错时吞掉并回落环境变量', async () => {
    const credentials: Credentials = {
      resolve: vi.fn().mockRejectedValue(new Error('no credentials seam')),
      describe: vi.fn(),
    }
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const resolver = new KeyResolver({ readConfig: () => base, credentials, env: { DEEPSEEK_API_KEY: 'sk-env' }, logger })
    await expect(resolver.resolve()).resolves.toBe('sk-env')
    expect(logger.debug).toHaveBeenCalledTimes(1)
  })

  it('完全没有 credentials 服务时不报错，直接走环境变量', async () => {
    const resolver = new KeyResolver({ readConfig: () => base, env: { DEEPSEEK_API_KEY: 'sk-env' } })
    await expect(resolver.resolve()).resolves.toBe('sk-env')
  })
})

describe('失败路径', () => {
  it('整条链都没取到时抛 NoKeyError', async () => {
    const resolver = new KeyResolver({ readConfig: () => base, env: {} })
    await expect(resolver.resolve()).rejects.toBeInstanceOf(NoKeyError)
  })

  it('两端都空也抛 NoKeyError', async () => {
    const resolver = new KeyResolver({ readConfig: () => ({ apiKey: '  ', apiKeyRef: '  ' }), env: {} })
    await expect(resolver.resolve()).rejects.toBeInstanceOf(NoKeyError)
  })

  it('引用名非法直接抛错，不去查凭据', async () => {
    const credentials: Credentials = { resolve: vi.fn(), describe: vi.fn() }
    const resolver = new KeyResolver({
      readConfig: () => ({ apiKey: '', apiKeyRef: 'deepseek-api-key' }),
      credentials,
      env: { 'deepseek-api-key': 'sk-x' },
    })
    await expect(resolver.resolve()).rejects.toBeInstanceOf(NoKeyError)
    expect(credentials.resolve).not.toHaveBeenCalled()
  })

  it('引用名正则是契约里那一条', () => {
    expect(CREDENTIAL_REF_PATTERN.test('DEEPSEEK_API_KEY')).toBe(true)
    expect(CREDENTIAL_REF_PATTERN.test('deepseek-api-key')).toBe(false)
    expect(CREDENTIAL_REF_PATTERN.test('1BAD')).toBe(false)
  })
})

describe('每次调用现读配置', () => {
  it('配置改了立刻生效，不需要重建 resolver', async () => {
    let current = { apiKey: 'sk-first', apiKeyRef: 'DEEPSEEK_API_KEY' }
    const resolver = new KeyResolver({ readConfig: () => current, env: {} })
    await expect(resolver.resolve()).resolves.toBe('sk-first')
    current = { apiKey: 'sk-second', apiKeyRef: 'DEEPSEEK_API_KEY' }
    await expect(resolver.resolve()).resolves.toBe('sk-second')
  })
})

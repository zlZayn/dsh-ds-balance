import { describe, expect, it, vi } from 'vitest'
import { accountReader, keyReader } from '../src/services/source-readers.ts'
import { computeAccountTag } from '../src/services/account-tag.ts'
import { ConfigService } from '../src/services/config-service.ts'
import { KeyResolver } from '../src/services/key-resolver.ts'
import { NoKeyError } from '../src/domain/errors.ts'
import type { Config } from '../src/config.ts'
import type { AccountSource } from '../src/ports/account.ts'
import type { DeepSeekClient } from '../src/ports/deepseek-client.ts'

const SALT = 'test-salt'

const defaults: Config = {
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
}

const raw = { is_available: true, balance_infos: [] }

function keySide(key = 'sk-test') {
  const config = new ConfigService({
    source: { get: () => defaults, watch: () => () => {} },
    env: {},
  })
  const keys = new KeyResolver({
    readConfig: () => ({ apiKey: key, apiKeyRef: 'DEEPSEEK_API_KEY' }),
    env: {},
  })
  const client: DeepSeekClient = {
    fetchBalance: vi.fn().mockResolvedValue(raw),
    testConnection: vi.fn(),
  }
  return { reader: keyReader({ keys, client, config, salt: SALT }), keys, client }
}

function accountSide(patch: Partial<AccountSource> = {}, present = true) {
  const account: AccountSource = {
    signedIn: async () => true,
    accountId: async () => 'user-1',
    readBalance: async () => ({ wallets: [{ currency: 'CNY', balance: '1' }], bonusWallets: [] }),
    ...patch,
  }
  return {
    reader: accountReader({ account: () => (present ? account : undefined), salt: SALT }),
    account,
  }
}

describe('keyReader', () => {
  it('有密钥就可用，没有就不可用', async () => {
    expect(await keySide().reader.available()).toBe(true)
    expect(await keySide('').reader.available()).toBe(false)
  })

  it('账本标识就是 HMAC(salt, 密钥)', async () => {
    expect(await keySide('sk-a').reader.tag()).toBe(computeAccountTag(SALT, 'sk-a'))
  })

  it('读一次带上原文与标识', async () => {
    const { reader, client } = keySide('sk-a')
    const result = await reader.read()
    expect(result.raw).toBe(raw)
    expect(result.accountTag).toBe(computeAccountTag(SALT, 'sk-a'))
    expect(client.fetchBalance).toHaveBeenCalledTimes(1)
  })

  it('没有密钥时读会抛，标识也抛', async () => {
    const { reader } = keySide('')
    await expect(reader.read()).rejects.toBeInstanceOf(NoKeyError)
    await expect(reader.tag()).rejects.toBeInstanceOf(NoKeyError)
  })
})

describe('accountReader', () => {
  it('登录态即可用；服务缺席一律不可用', async () => {
    expect(await accountSide().reader.available()).toBe(true)
    expect(await accountSide({ signedIn: async () => false }).reader.available()).toBe(false)
    expect(await accountSide({}, false).reader.available()).toBe(false)
  })

  it('账本标识用 account: 前缀，与密钥那条不共空间', async () => {
    expect(await accountSide().reader.tag()).toBe(computeAccountTag(SALT, 'account:user-1'))
    expect(await accountSide().reader.tag()).not.toBe(computeAccountTag(SALT, 'user-1'))
  })

  it('账号 id 读不到时抛错，不退化成占位账本键', async () => {
    // 退成 `account:unknown` 会写进一个再也读不回来的账本：`restore()` 严按当前键过滤，
    // 那一刻写下的快照与正常账本互不可见。抛错则由 restore() 静默跳过，下一轮自愈。
    // 空串不是这一层的口径：`accountId()` 约定拿不到就回 null（host-account 已把 '' 归成 null）。
    const { reader } = accountSide({ accountId: async () => null })
    await expect(reader.tag()).rejects.toBeInstanceOf(NoKeyError)
  })

  it('读一次把钱包投影成线上形状', async () => {
    const { reader } = accountSide({
      readBalance: async () => ({
        wallets: [{ currency: 'CNY', balance: '100' }],
        bonusWallets: [{ currency: 'CNY', balance: '10' }],
      }),
    })
    const result = await reader.read()
    expect(result.raw).toEqual({
      is_available: true,
      balance_infos: [
        {
          currency: 'CNY',
          total_balance: '110.00000000',
          granted_balance: '10.00000000',
          topped_up_balance: '100.00000000',
        },
      ],
    })
    expect(result.accountTag).toBe(computeAccountTag(SALT, 'account:user-1'))
  })

  it('查询途中登录没了 → 抛 NoKeyError（与「没有密钥」同一类事实）', async () => {
    const { reader } = accountSide({ readBalance: async () => null })
    await expect(reader.read()).rejects.toBeInstanceOf(NoKeyError)
  })

  it('服务缺席时读也抛，不静默给空', async () => {
    const { reader } = accountSide({}, false)
    await expect(reader.read()).rejects.toBeInstanceOf(NoKeyError)
  })
})

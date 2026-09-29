import { describe, expect, it, vi } from 'vitest'
import { createAccountSource, type HostAccountFace } from '../src/adapters/host-account.ts'
import { AppError } from '../src/domain/errors.ts'

/** 宿主服务的替身：只实现用到的三个方法。 */
function face(patch: Partial<HostAccountFace> = {}): HostAccountFace {
  return {
    getState: vi.fn().mockResolvedValue({ status: 'credential-stored' }),
    getBalance: vi.fn().mockResolvedValue({ status: 'ready', value: [], bonusWallets: [] }),
    getPlatformSession: vi.fn().mockResolvedValue({ userId: 'user-1' }),
    ...patch,
  }
}

describe('createAccountSource', () => {
  it('登录态按宿主的状态字面量判', async () => {
    expect(await createAccountSource({ service: face(), version: '2.1.3' }).signedIn()).toBe(true)
    const out = face({ getState: vi.fn().mockResolvedValue({ status: 'signed-out' }) })
    expect(await createAccountSource({ service: out, version: '2.1.3' }).signedIn()).toBe(false)
  })

  it('读不到状态当未登录，不抛', async () => {
    const broken = face({ getState: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(await createAccountSource({ service: broken, version: '2.1.3' }).signedIn()).toBe(false)
  })

  it('账号 id 来自 platform session；没有就回 null', async () => {
    const source = createAccountSource({ service: face(), version: '2.1.3' })
    expect(await source.accountId()).toBe('user-1')
    const noId = face({ getPlatformSession: vi.fn().mockResolvedValue({ userId: null }) })
    expect(await createAccountSource({ service: noId, version: '2.1.3' }).accountId()).toBeNull()
  })

  it('读余额：ready 原样交出去', async () => {
    const service = face({
      getBalance: vi.fn().mockResolvedValue({
        status: 'ready',
        value: [{ currency: 'CNY', balance: '1' }],
        bonusWallets: [{ currency: 'CNY', balance: '2' }],
      }),
    })
    const balance = await createAccountSource({ service, version: '2.1.3' }).readBalance()
    expect(balance).toEqual({
      wallets: [{ currency: 'CNY', balance: '1' }],
      bonusWallets: [{ currency: 'CNY', balance: '2' }],
    })
  })

  it('未登录（宿主回 null）交回 null，让上层回落另一条路', async () => {
    const service = face({ getBalance: vi.fn().mockResolvedValue(null) })
    expect(await createAccountSource({ service, version: '2.1.3' }).readBalance()).toBeNull()
  })

  it('查询失败抛错而不是当成零余额', async () => {
    const service = face({ getBalance: vi.fn().mockResolvedValue({ status: 'failed' }) })
    await expect(
      createAccountSource({ service, version: '2.1.3' }).readBalance(),
    ).rejects.toBeInstanceOf(AppError)
  })

  it('给宿主的客户端标识带上版本、语言与时区', async () => {
    const getBalance = vi.fn().mockResolvedValue(null)
    const source = createAccountSource({
      service: face({ getBalance }),
      version: '9.9.9',
      timezoneOffsetSeconds: () => 28_800,
    })
    await source.readBalance()
    expect(getBalance).toHaveBeenCalledWith({
      version: '9.9.9',
      locale: 'zh-CN',
      timezoneOffsetSeconds: 28_800,
    })
  })
})

import { describe, expect, it } from 'vitest'
import { contractKeyMissingMessage, resolveContractKey } from './contract-key.ts'

/**
 * 契约测试：打真实 DeepSeek 上游，盯 `GET /user/balance` 的响应指纹。
 *
 * 与日常测试分家的两点：
 * - 要真实凭据，按 [contract-key.ts](contract-key.ts) 的顺序从环境变量读：
 *   先 `DSH_CI_API_KEY`（契约巡检的专用 key，CI 上由同名仓库 secret 注入），
 *   缺了回落 `DEEPSEEK_API_KEY`（本机日常那把）。两个都没有时**失败而不是跳过**。
 * - 只被 [vitest.contract.config.ts](../vitest.contract.config.ts) 收集，`npm test` 不会跑到它。
 *
 * 它不消耗余额：`/user/balance` 是查询接口。
 * 失败信息里绝不回显凭据本身。
 */

const API_KEY = resolveContractKey(process.env)
if (API_KEY === null) {
  throw new Error(contractKeyMissingMessage())
}

/** 允许指向镜像或代理；默认官方域名。 */
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'

const BALANCE_URL = new URL('/user/balance', BASE_URL).toString()

/** 金额是十进制字符串，不是数字 —— 这条是契约里最容易变的一环。 */
const DECIMAL = /^\d+(\.\d+)?$/

interface BalanceInfo {
  currency: string
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

describe('DeepSeek /user/balance 契约', () => {
  it('响应形状与指纹未变', async () => {
    const response = await fetch(BALANCE_URL, {
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
    })

    // 不打印响应体：401 的响应体里可能带回显的凭据片段。
    expect(response.status, '凭据无效，或上游拒绝了这次请求').toBe(200)

    const body = (await response.json()) as Record<string, unknown>

    // 1) is_available 是布尔，不是字符串或 0/1。
    expect(typeof body.is_available).toBe('boolean')

    // 2) balance_infos 是非空数组：一个账户可以同时有多个币种。
    expect(Array.isArray(body.balance_infos)).toBe(true)
    const infos = body.balance_infos as BalanceInfo[]
    expect(infos.length).toBeGreaterThan(0)

    // 3) 每条信息的四个字段都是字符串；金额格外不能被上游改成数字。
    for (const info of infos) {
      expect(typeof info.currency).toBe('string')
      expect(info.currency.length).toBeGreaterThan(0)
      expect(typeof info.total_balance).toBe('string')
      expect(typeof info.granted_balance).toBe('string')
      expect(typeof info.topped_up_balance).toBe('string')

      expect(info.total_balance).toMatch(DECIMAL)
      expect(info.granted_balance).toMatch(DECIMAL)
      expect(info.topped_up_balance).toMatch(DECIMAL)
    }

    // 4) 上游不回显凭据。
    expect(JSON.stringify(body)).not.toContain(API_KEY)
  })

  it('凭据无效时上游回 401（否证「拿错 key 也能读到数」）', async () => {
    const response = await fetch(BALANCE_URL, {
      headers: { Authorization: 'Bearer invalid-contract-probe-key', Accept: 'application/json' },
    })
    expect(response.status).toBe(401)
  })
})

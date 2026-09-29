/**
 * 两条取数路的读取策略。
 *
 * 账本（{@link SourceLedger}）只认这个接口，不认凭据、不认 HTTP —— 换来源就是换一个 reader。
 * 三个方法都是**本地读**，只有 `read()` 会打上游。
 * @module dsh-ds-balance/services/source-readers
 */

import { endpointOf } from '../config.js'
import { projectAccountBalance } from '../domain/account.js'
import { NoKeyError } from '../domain/errors.js'
import type { AccountSource } from '../ports/account.js'
import type { DeepSeekClient } from '../ports/deepseek-client.js'
import { computeAccountTag } from './account-tag.js'
import type { SourceReader } from './balance-source.js'
import type { ConfigService } from './config-service.js'
import type { KeyResolver } from './key-resolver.js'

/** Key 那条路：解析链拿明文密钥 → 官方余额端点。 */
export function keyReader(options: {
  keys: KeyResolver
  client: DeepSeekClient
  config: ConfigService
  salt: string
}): SourceReader {
  const { keys, client, config, salt } = options
  return {
    async available() {
      try {
        await keys.resolve()
        return true
      } catch {
        // 解析链没取到值就是「这条路此刻不可用」，不是错误：上层据此回落另一条。
        return false
      }
    },
    async tag() {
      return computeAccountTag(salt, await keys.resolve())
    },
    async read() {
      const apiKey = await keys.resolve()
      const current = config.current()
      const raw = await client.fetchBalance({
        baseUrl: endpointOf(current),
        apiKey,
        timeoutMs: config.timeoutMs(),
      })
      return { raw, accountTag: computeAccountTag(salt, apiKey) }
    },
  }
}

/** 账号那条路：登录态 → 钱包查询 → 投影成官方余额端点同一个形状。 */
export function accountReader(options: {
  /** 取当前端口实现；服务可能晚到，所以这里必须是函数而不是实例。 */
  account: () => AccountSource | undefined
  salt: string
}): SourceReader {
  const { account, salt } = options
  const require = (): AccountSource => {
    const current = account()
    if (current === undefined) throw new NoKeyError('no credential: account service is unavailable')
    return current
  }
  /**
   * 账号账本的派生输入。
   *
   * 用 `account:` 前缀把两个键空间分开：账号 id 与明文密钥因此不可能撞到同一个账本。
   * 宿主本进程还没读过 profile 时 id 拿不到，退回 `unknown` —— 代价是那种情况下换账号不换账本，
   * 由下一轮抓取修正（见决策记录的「已知代价」）。
   */
  const tagOf = async (): Promise<string> =>
    computeAccountTag(salt, `account:${(await require().accountId()) ?? 'unknown'}`)

  return {
    async available() {
      const current = account()
      return current !== undefined && (await current.signedIn())
    },
    tag: tagOf,
    async read() {
      const balance = await require().readBalance()
      // `null` = 查询途中凭据被换掉/登出：此刻这条路的凭据没了，与「没有密钥」同一类事实。
      if (balance === null) throw new NoKeyError('no credential: account is not signed in')
      return { raw: projectAccountBalance(balance), accountTag: await tagOf() }
    },
  }
}

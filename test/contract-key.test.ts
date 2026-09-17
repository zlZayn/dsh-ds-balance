import { describe, expect, it } from 'vitest'
import { CONTRACT_KEY_VARS, contractKeyMissingMessage, resolveContractKey } from './contract-key.ts'

/**
 * 契约测试的凭据解析 —— 纯函数，不发任何请求。
 *
 * 它被日常 `npm test` 收（不匹配 `contract-live-*`，所以不是契约测试的一部分），
 * 这样「本地能不能跑契约测试」这件事不必等到真打上游才发现。
 */

describe('resolveContractKey', () => {
  it('优先用契约巡检的专用 key', () => {
    expect(resolveContractKey({ DSH_CI_API_KEY: 'sk-ci', DEEPSEEK_API_KEY: 'sk-local' })).toBe('sk-ci')
  })

  it('只有本机那把时回落 —— 否则本地根本跑不了契约测试', () => {
    expect(resolveContractKey({ DEEPSEEK_API_KEY: 'sk-local' })).toBe('sk-local')
  })

  it('两个都空时给 null，交给调用方报错', () => {
    expect(resolveContractKey({})).toBeNull()
    expect(resolveContractKey({ DSH_CI_API_KEY: '', DEEPSEEK_API_KEY: '' })).toBeNull()
  })

  it('空串按「没有」算，不拿它去换一个语义模糊的 401', () => {
    // CI 上 secret 没配时 GitHub 注入的就是空串；真实原因是「没配 secret」。
    expect(resolveContractKey({ DSH_CI_API_KEY: '', DEEPSEEK_API_KEY: 'sk-local' })).toBe('sk-local')
  })
})

describe('contractKeyMissingMessage', () => {
  it('两个变量都空时，报错信息同时提到两个名字', () => {
    // 只说一个名字，本地跑的人会以为还要另配一把 key，而实际上日常那把就能用。
    const message = contractKeyMissingMessage()
    for (const name of CONTRACT_KEY_VARS) {
      expect(message, name).toContain(name)
    }
    expect(CONTRACT_KEY_VARS).toHaveLength(2)
  })
})

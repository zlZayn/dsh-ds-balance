import { describe, expect, it } from 'vitest'
import type { CredentialInfo } from '../src/client/data.ts'
import { credentialViewOf } from '../src/client/settings/use-credential-state.ts'

/** 造一份凭据描述；只覆写关心的字段。 */
function credential(patch: Partial<CredentialInfo> = {}): CredentialInfo {
  return { ref: 'DEEPSEEK_API_KEY', configured: true, source: 'env', writable: true, ...patch }
}

describe('credentialViewOf', () => {
  it('覆盖优先：折叠里存过值，生效的就是折叠里那一份', () => {
    // 宿主可写、凭据域也已配置，但用户在「自定义设置」里放了自己的值。
    expect(credentialViewOf(credential(), true)).toBe('overridden')
    // 环境提供时也一样：这一行显示的是当前生效值，不是这个框能不能改。
    expect(credentialViewOf(credential({ writable: false }), true)).toBe('overridden')
    expect(credentialViewOf(null, true)).toBe('overridden')
  })

  it('可写时按配没配分档', () => {
    expect(credentialViewOf(credential(), false)).toBe('configured')
    expect(credentialViewOf(credential({ configured: false }), false)).toBe('notConfigured')
  })

  it('writable 不是 true 时一律算「启动环境提供」', () => {
    expect(credentialViewOf(credential({ writable: false }), false)).toBe('env')
    // 值就在环境里，「配没配」不再影响这一行。
    expect(credentialViewOf(credential({ writable: false, configured: false }), false)).toBe('env')
  })

  it('读不到凭据信息时当「启动环境提供」，不抛错也不误报可写', () => {
    // 宿主旧版本、请求失败、字段缺失都走这一条。
    expect(credentialViewOf(null, false)).toBe('env')
  })

  it('四档都取得到，没有漏档', () => {
    const seen = new Set([
      credentialViewOf(credential(), true),
      credentialViewOf(credential(), false),
      credentialViewOf(credential({ configured: false }), false),
      credentialViewOf(credential({ writable: false }), false),
    ])
    expect([...seen].sort()).toEqual(['configured', 'env', 'notConfigured', 'overridden'])
  })
})

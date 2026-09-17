/**
 * 凭据状态：问后端要「配没配 / 可不可写」这三个事实。
 *
 * 官方的 provider 卡片用 `describeCredential()` 决定密钥字段是「可编辑」还是
 * 「由启动环境提供（只读）」；浏览器半边拿不到凭据服务，所以走插件自己的
 * `GET /api/v1/config`（**响应里没有密钥**，只有一个固定长度的掩码串）。
 *
 * 读不到就回 `null`，界面据此把字段当只读——宁可少给一个编辑入口，
 * 也不要在不知道的情况下让用户以为能改。
 * @module dsh-ds-balance/client/settings/use-credential-state
 */

import { useEffect, useState } from 'react'
import { requestConfig, type CredentialInfo } from '../data.ts'

/**
 * 订阅凭据的只读描述。
 * @param ref - 当前生效的凭据引用名；它一变就重读一次。
 * @returns 三个事实，或 `null` 表示读不到。
 */
export function useCredentialState(ref: string): CredentialInfo | null {
  const [state, setState] = useState<CredentialInfo | null>(null)
  useEffect(() => {
    let cancelled = false
    // 两层防御：`requestConfig` 已经把形状不对的值规整成 null，
    // 这里再取一次属性，宿主旧版本、请求失败、字段缺失都只是退化成 null。
    void requestConfig()
      .then((body) => { if (!cancelled) setState(body?.credential ?? null) })
      .catch(() => { if (!cancelled) setState(null) })
    return () => { cancelled = true }
  }, [ref])
  return state
}

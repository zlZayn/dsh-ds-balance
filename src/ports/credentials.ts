/**
 * 凭据端口。
 *
 * 契约来自 dsh 的 credentials 服务：`resolve` 回值，`describe` **只回三片**、
 * 永不回值。装配里可能**没有** credentials seam，消费方必须自己兜。
 * @module dsh-ds-balance/ports/credentials
 */

/** 解析结果。 */
export interface ResolvedCredential {
  value: string
  source: string
}

/** 描述结果：**类型里根本没有装值的槽**。 */
export interface CredentialDescription {
  configured: boolean
  source?: string
  writable: boolean
}

/** 凭据服务的最小面。 */
export interface Credentials {
  /**
   * 解析一个引用名。
   * @param ref - 环境变量名形状的引用名。
   * @throws 引用名非法或没有该凭据时抛错。
   */
  resolve(ref: string): Promise<ResolvedCredential>

  /** 描述一个引用名。 */
  describe(ref: string): Promise<CredentialDescription>
}

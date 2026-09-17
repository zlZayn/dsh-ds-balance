/**
 * 契约测试的凭据解析。
 *
 * 单独成一个文件，是为了让它**可单测**：契约测试本体在模块加载时就 throw，
 * 那条「两个变量都空」的路径没法当成用例去断言，只能把判据挪出来。
 * 本文件只有纯函数，由 `test/contract-key.test.ts` 覆盖，不发任何请求。
 * @module dsh-ds-balance/test/contract-key
 */

/**
 * 取凭据时按这个顺序找。
 *
 * - `DSH_CI_API_KEY` 优先：契约巡检的**专用** key，CI 上由同名仓库 secret 注入。
 * - `DEEPSEEK_API_KEY` 兜底：本机日常那把，插件自己继承的就是它。
 *   没有这层兜底，本地跑 `npm run test:contract` 会直接缺 key。
 */
export const CONTRACT_KEY_VARS = ['DSH_CI_API_KEY', 'DEEPSEEK_API_KEY'] as const

/**
 * 按顺序取第一个非空的凭据。
 *
 * **空串按「没有」处理**：CI 上 secret 没配时 GitHub 注入的就是空串，
 * 拿它去请求只会换回一个语义模糊的 401，而真正的原因是「没配 secret」。
 * @param env - 环境变量表；测试可注入，所以这个函数不依赖真实进程环境。
 * @returns 找到的 key；两个都没有时给 `null`。
 */
export function resolveContractKey(env: Record<string, string | undefined>): string | null {
  for (const name of CONTRACT_KEY_VARS) {
    const value = env[name]
    if (typeof value === 'string' && value !== '') return value
  }
  return null
}

/**
 * 两个变量都空时的报错文案。
 *
 * **两个名字都写出来**：只说一个，本地跑的人会以为还要另配一把 key，
 * 而实际上他日常那把就能用。
 * @returns 报错文案。
 */
export function contractKeyMissingMessage(): string {
  return `缺 ${CONTRACT_KEY_VARS[0]}，本机也没配 ${CONTRACT_KEY_VARS[1]}：`
    + '契约测试打真实上游，需要一把能查余额的 key。它只从环境变量读，不从仓库里的任何文件读。'
}

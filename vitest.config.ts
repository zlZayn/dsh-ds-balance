import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 契约测试打真实上游，要凭据、要配额；它有独立的 vitest.contract.config.ts。
    // 漏在这里会让 npm test 在无凭据环境下直接失败。
    // 其余排除项取官方默认值 —— 手抄一份清单，官方加一项我们就漏一项。
    exclude: [...configDefaults.exclude, 'test/contract-live-*.test.ts'],
    environment: 'node',
  },
})

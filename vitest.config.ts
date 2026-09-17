import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 契约测试打真实上游，要凭据、要配额；它有独立的 vitest.contract.config.ts。
    // 漏在这里会让 npm test 在无凭据环境下直接失败。
    exclude: ['**/node_modules/**', 'test/contract-live-*.test.ts'],
    environment: 'node',
  },
})

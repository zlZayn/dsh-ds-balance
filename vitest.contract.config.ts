import { defineConfig } from 'vitest/config'

// 契约测试的独立入口。
//
// 与日常 vitest.config.ts 分开的原因：它打真实 DeepSeek 上游，要真实凭据。
// CI 不跑它（ci.yml 只跑 npm test）；由 contract.yml 每周一次，或本机手动：
//
//   npm run test:contract
//
// 跑之前环境里要有 DEEPSEEK_API_KEY。缺凭据时它是失败，不是跳过。
export default defineConfig({
  test: {
    include: ['test/contract-live-*.test.ts'],
    environment: 'node',
    // 串行执行：并发请求会让限流观测与失败归因互相污染。
    fileParallelism: false,
    testTimeout: 30_000,
  },
})

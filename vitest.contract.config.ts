import { defineConfig } from 'vitest/config'

// 契约测试的独立入口。
//
// 与日常 vitest.config.ts 分开的原因：它打真实 DeepSeek 上游，要真实凭据。
// CI 不跑它（ci.yml 只跑 npm test）；由 contract.yml 每周一次，或本机手动：
//
//   npm run test:contract
//
// 跑之前环境里要有 DSH_CI_API_KEY（契约巡检的专用 key；CI 上取自同名仓库 secret）；
// 只有本机日常那把 DEEPSEEK_API_KEY 也能跑 —— 解析顺序在 test/contract-key.ts。
// 两个都没有时它是失败，不是跳过。
//
// 注意它**只收** contract-live-*：凭据解析的单元测试（test/contract-key.test.ts）
// 归日常配置，不该被算进「需要真凭据」的那一类。
export default defineConfig({
  test: {
    include: ['test/contract-live-*.test.ts'],
    environment: 'node',
    // 串行执行：并发请求会让限流观测与失败归因互相污染。
    fileParallelism: false,
    testTimeout: 30_000,
  },
})

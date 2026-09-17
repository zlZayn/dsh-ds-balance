# test/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

test/ 特有约束：

- 从 `src/` **值导入**被测模块时带 `.ts` 后缀（vitest 走 Vite 解析，已验证可用）。
- 不 mock 领域层；领域层必须是可直接调用、无副作用、可重复的纯函数。
- 时间相关断言一律注入时刻（`parseRetryAfter(headers, now)` 这类），**不依赖真实时钟**。
- 新测试必须能在无网络、无 dsh 宿主的环境下跑通。
- **例外一：`artifacts.test.ts`** 读 `lib/`，所以依赖先构建。`npm test` 自带 build；直接跑 vitest 时若产物缺失，它必须**报错而不是跳过**。
  它也因此不进 `tsconfig.test.json` —— 类型检查不构建，留着会让干净检出上的 `npm run typecheck` 必失败。
- **例外二：`contract-live-*.test.ts`** 打真实上游，要 `DEEPSEEK_API_KEY`，只由 `vitest.contract.config.ts` 收集。
  日常配置里显式排除它；缺凭据时它同样**报错而不是跳过** —— 静默跳过等于没有契约测试。
- 测试里不许出现本机路径、端口或 profile 名：URL 用 `http://localhost` 这类通用源。

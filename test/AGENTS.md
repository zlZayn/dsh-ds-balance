# test/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

test/ 特有约束：

- 从 `src/` **值导入**被测模块时带 `.ts` 后缀（vitest 走 Vite 解析，已验证可用）。
- 不 mock 领域层；领域层必须是可直接调用、无副作用、可重复的纯函数。
- 时间相关断言一律注入时刻（`parseRetryAfter(headers, now)` 这类），**不依赖真实时钟**。
- 新测试必须能在无网络、无 dsh 宿主的环境下跑通。

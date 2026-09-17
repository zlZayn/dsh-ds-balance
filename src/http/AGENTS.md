# http/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

http/ 特有约束：

- **handler 不许把异常抛出去**：抛出去会被宿主包成 `500`，前端拿不到 `error` 结构。
  余额端点的业务错误一律 `200 + state: error`。
- **每次请求现读配置**，不许在闭包里捕获旧值。
- `path` 写死精确值、**不带尾随斜杠**：实现是 Map 精确键匹配。
- 方法只能用 `GET` / `HEAD` / `POST` —— `ConnectionFetchMethod` 就这三档，PUT 注册即抛。
- **`apiKey` 的任何片段都不许进响应体**。掩码是手动的：`redactSecrets` 是显式开关，
  我们这套响应自己构造，不走 settings 读取。
- 只有 `routes.ts` 碰 `ctx`；`handlers.ts` 与 `wire.ts` 必须能脱离宿主直接测。
- 新增或改路径必须同步 [docs/backend-architecture.md](../../docs/backend-architecture.md) §8 与
  `test/http-routes.test.ts` 的端点表断言。

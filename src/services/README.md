# src/services/ — 应用服务手册

- 职责：把端口与领域模型组织成用例（Layer 3）。**不直接碰 `ctx`，只依赖构造时注入的端口。**
- 变更影响路由：改解析链或调度策略 → 同步 [docs/backend-architecture.md](../../docs/backend-architecture.md) 的 §6；改错误分类 → 同步 §7.4。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。
- 回根 → [../../AGENTS.md](../../AGENTS.md)。

## 文件

- `account-tag.ts`：`computeAccountTag(salt, apiKey)`（HMAC-SHA256 前 32 hex）与 `accountTag8`（日志用前 8 位）。**不可逆、不含明文。**
- `key-resolver.ts`：`KeyResolver` 与 `CREDENTIAL_REF_PATTERN`。解析链 = 配置 `apiKey` → `credentials.resolve(apiKeyRef)` → `process.env[apiKeyRef]` → 抛 `NoKeyError`。
  - **无 credentials seam 时吞掉异常继续往下**，不让它变成整个插件的失败。
  - **每次调用现读配置**，用户改了立刻生效。

## 被谁依赖

- `src/http/`（handler）与 `src/index.ts`（组装）。

## 改后必测

- `npx --no-install vitest run test/key-resolver.test.ts test/account-tag.test.ts`
- 覆盖：优先级链、非法引用名、无 seam 回落、每次现读配置。

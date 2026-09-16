# src/http/ — HTTP 端点手册

- 职责：把应用服务暴露成 `ctx.connection.fetch` 上的一组精确路由。
- 契约来源：[docs/backend-architecture.md](../../docs/backend-architecture.md) §3.3 / §8。
- 变更影响路由：改路径或响应形状 → 同步 §8、前端 [src/client/api-types.ts](../client/api-types.ts)、
  `test/http-wire.test.ts` 与 `test/http-routes.test.ts`。

## 文件

- `wire.ts`：线上形状与序列化。纯函数，把 `bigint` 最小单位折成八位小数字符串；
  `details` 不外传。改这里等于改契约。
- `handlers.ts`：六个端点的实现。依赖全部构造注入，**不碰 `ctx`**，因此能脱离宿主直接测。
  每个 handler 都自己吸收异常。
- `routes.ts`：注册。路由表在这里，路径与方法一眼可查；只有本文件碰 `ctx`。

## 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/balance` | 余额视图；`currency` 查询参数覆盖 `displayCurrency` |
| POST | `/api/v1/balance/refresh` | 手动刷新；请求体 `{ reason }` 可省略 |
| GET | `/api/v1/config` | 读配置（`apiKey` 只回掩码） |
| POST | `/api/v1/config` | 写配置；形状或取值不合法一律 `422` |
| POST | `/api/v1/test-connection` | 测连接；**不动活动缓存** |
| GET | `/api/v1/healthz` | 状态 / 调度 / 存储健康 / 版本 / 指标聚合值 |

**写配置走 POST 而不是 PUT**：平台只支持 `GET` / `HEAD` / `POST` 三档方法。
契约文档写的是 PUT，以平台实际能力为准。

## 使用约束与工作偏好

见 [AGENTS.md](AGENTS.md)。

## 参考

- 后端架构（含端点契约）→ [docs/backend-architecture.md](../../docs/backend-architecture.md)
- 应用服务 → [src/services/README.md](../services/README.md)
- 架构与不变约束 → [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)

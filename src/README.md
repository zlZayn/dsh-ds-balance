# src/ — 源码手册

- 职责：插件两个半体的源码。
- 变更影响路由：改这里的对外行为 → 同步根 [README.md](../README.md) 与 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)；宿主半边改完必须重新 `npm run build` 才被加载。

## 两个半体

- `index.ts`：宿主半边入口（Layer 5）。只做组装 —— 登记设置命名空间、把端口实现接上、交出生命周期。**零业务逻辑。**
- `client/`：浏览器半边，见 [client/README.md](client/README.md)。
- `domain/`：领域层（Layer 0），纯逻辑，见 [domain/README.md](domain/README.md)。
- `ports/`：端口（Layer 1），见 [ports/README.md](ports/README.md)。
- `adapters/`：端口实现（Layer 2），见 [adapters/README.md](adapters/README.md)。
- `services/`：应用服务（Layer 3），见 [services/README.md](services/README.md)。
- `http/`：HTTP 端点（Layer 4），见 [http/README.md](http/README.md)。
- `config.ts`：插件配置 schema 与派生常量，是两半唯一的共享字符串来源。
- `version.ts`：线上 schema 版本与插件版本（与 `package.json` 有测试兜底）。

## 关键导出

- `name`、`inject`、`Config`、`apply`：Cordis 插件的标准面。
- `SETTINGS_NAMESPACE`：必须与浏览器半边的 `SETTINGS_NAMESPACE` 逐字一致，它是两半的配对键。

## 加载时机

- 宿主半边：进程启动时读一次；用 patch 层热挂载时可以即插即用，但它一旦被改动就需要重新构建。
- 浏览器半边：由 `dsh-client-hmr` 轮询 `lib/client.js` 自动替换。

## 使用约束与工作偏好

见 [AGENTS.md](AGENTS.md)。

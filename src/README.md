# src/ — 源码手册

- 职责：插件两个半体的源码。
- 变更影响路由：改这里的对外行为 → 同步根 [README.md](../README.md) 与 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)；宿主半边改完必须重新 `npm run build` 才被加载。

## 两个半体

- `index.ts`：宿主半边。只做一件事 —— 用 `ctx.settings.installSection` 登记设置命名空间 `ds-balance`，让配置能落进 `$DSH_HOME/settings.yaml`。零业务逻辑。
- `client/`：浏览器半边。注册两个 slot 与词典，见 [client/README.md](client/README.md)。

## 关键导出

- `name`、`inject`、`Config`、`apply`：Cordis 插件的标准面。
- `SETTINGS_NAMESPACE`：必须与浏览器半边的 `SETTINGS_NAMESPACE` 逐字一致，它是两半的配对键。

## 加载时机

- 宿主半边：进程启动时读一次；用 patch 层热挂载时可以即插即用，但它一旦被改动就需要重新构建。
- 浏览器半边：由 `dsh-client-hmr` 轮询 `lib/client.js` 自动替换。

## 使用约束与工作偏好

见 [AGENTS.md](AGENTS.md)。

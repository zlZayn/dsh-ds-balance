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
- `config.ts`：插件配置 schema、Loader 条目 id 与派生常量。**11 个字段全是 `.volatile()`**（否则表单里不出现、写也写不进去），`apply` 收到的是引用面 `ConfigRefs` 而不是值。
- `version.ts`：线上 schema 版本与插件版本（与 `package.json` 有测试兜底）。

## 关键导出

- `name`、`inject`、`Config`、`apply`：Cordis 插件的标准面。
- `ENTRY_ID`：本插件那一行的 Loader 条目 id，**同时就是设置命名空间**；浏览器半边抄了一份同样的字面量，两份由红线对账。
- `SIDEBAR_ENTRY_ID`：左下角条目的 slot id。**它不是命名空间**，与配置无关。

## 加载时机

- 宿主半边：进程启动时读一次；用 patch 层热挂载时可以即插即用，但它一旦被改动就需要重新构建。
  配置变化**不会**重新挂载它：全字段 volatile ⇒ Loader 只把新值提交进引用并发一次 `loader/volatile-update`。
- 浏览器半边：由 `dsh-client-hmr` 轮询 `lib/client.js` 自动替换。

## 使用约束与工作偏好

见 [AGENTS.md](AGENTS.md)。

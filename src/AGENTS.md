# src/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

src/ 特有约束：

- 两个半体共享的只有命名空间字符串与契约类型；不许跨半体值导入。
- 宿主半边不许出现业务逻辑；本阶段它只登记 schema。
- 浏览器半边不许读 `ctx`（组件拿不到），数据一律走注册项的 `inject` 工厂或 props。
- 相对导入保留 `.ts` / `.tsx` 后缀；客户端 tsconfig 开了 `allowImportingTsExtensions`。
- **cordis 不许读没 `inject` 过的服务**：直接访问会抛 `cannot get property "..." without inject`。可选服务（`connection` / `storageDomain`）必须由 `ctx.inject` 把门并留降级路径；塞进顶层 `inject` 会让缺服务的装配整个插件不装载。**降级路径会把这条配置错误伪装成运行时故障**，所以启动日志要当验收项看。
- `inject` 门禁按服务名逐字判，点号键不展开成父级。
- `dsh.client.inject` 只列真实客户端图行；`ui-slots` 与 `ui-primitives` 是 staticLinked 平台模块，列进去会被静默跳过。
- **两半的装载时机不同**：宿主半边只在进程启动时读一次，浏览器半边由 `dsh-client-hmr` 一轮询就换 —— `npm run build` 之后存在「新客户端 + 旧宿主」的合法中间态。
  **客户端读宿主新增字段一律加防御**（可选链 + 形状守卫，缺失退化成保守默认）；改完宿主半边要主动重启宿主，别指望 HMR。

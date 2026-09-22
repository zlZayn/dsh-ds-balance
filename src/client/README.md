# client/ — 浏览器半边手册

- 职责：注册两个 slot（左下角条目、Plugins 页里的配置卡片）与中英词典；所有界面都在这里。
- 变更影响路由：改这里的对外行为 → 同步根 [README.md](../../README.md) 与 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)；改完必须 `npm run build`，产物由 `dsh-client-hmr` 自动替换。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。

## 文件

- `index.tsx`：入口。注册词典、向两个 slot 注册组件。`inject` 是运行时门禁，**只有 `slots` / `locale` 两项**（永远在的服务），删任一项都会让 `apply` 静默不跑；配置表单服务 `configForms` 由 `apply` 内的嵌套 `ctx.inject` 把门 —— **缺它整个浏览器半边都不渲染**（圆环与浮层一起消失），因为左下角条目也要读 `displayCurrency`。
- `config-slot.ts`：配置表单的**能力探测**（不查版本号）：卡片拿不拿得到 form。三态 `pending` / `available` / `missing`，**可逆**：服务晚到会把 `missing` 拨回 `available`，已经出现的提示自己撤掉。**探测盯的是 `configForms` 服务本身，不是槽名** —— `plugins.bundle.config` 在宿主两条线上都存在且都不传 `form`，盯槽名等于盯一条恒为真的信号。纯逻辑 + 可注入时钟，所以能脱离浏览器测；提示文案也在这里，且**刻意不点名任何槽**。理由见 [决策记录](../../.agents/notes/2026-09-19-capability-probe-for-config-slot.md) 与[落点回退记录](../../.agents/notes/2026-09-22-config-entry-back-to-bundle-config.md)。
- `locales.ts`：中英词典。`zh` 是键集真源，`en` 用 `Record<LocaleKey, string>` 做编译期完整性检查。同时把命名空间并进 `LocaleNamespaceMap`。
  **与包根的 [locale/](../../locale/AGENTS.md) 不是一回事**：那是插件的**展示元数据**（插件页上的标题与描述），
  由宿主直接读那两份 JSON —— 它不进本半边、也不参与渲染，别把两处文案互相抄。
- `model.ts`：纯函数视图模型。`severity` → 状态点与环色、**余额占 `warn` 阈值的弧长比例**（`ringRatioOf`，整数比较不走浮点）、金额字符串格式化、**从后端 `selected` 读出展示币种**、相对时间分档。**没有 React，不自己挑币种，也不用阈值配色。**
- `data.ts`：数据层。向后端要余额（`GET /api/v1/balance` 带 `currency` 查询参数）、触发手动刷新、读一次配置里的 `credential` 只读事实，并把「端点不可达」翻成可展示的错误态。**不缓存、不排程** —— 节奏归 `sidebar/`。可注入 `fetchImpl`，因此能脱离浏览器测。
  - 读宿主的**新增字段一律先过形状守卫**（如 `readCredential`）：客户端半边由 HMR 立刻换新、宿主半边要重启才换，新客户端会读到旧宿主的响应。
- `api-types.ts`：后端契约类型。既约束 mock，也约束 `data.ts` 拿回来的响应；宿主半边的序列化由 `test/http-wire.test.ts` 做编译期对齐断言。
- `css-modules.d.ts`：CSS Modules 的环境声明。
- `mock/`：开发场景数据，见 [mock/README.md](mock/README.md)。**默认走真实端点**：只有 URL 参数 `?dsb=<场景键>` 或 localStorage 明确选过场景才用 mock；`?dsb=live` 会清掉已存的选择并回到真实数据。`?dsb-dev` 会让 `isDevMode()` 返回真（当前仓库内没有消费方，切换器尚未接线）。
- `sidebar/`：左下角条目（状态圆环 + 名称）、点击展开的浮层、宿主容器补丁 → [sidebar/README.md](sidebar/README.md)。首拉一次后按 `clientPollSeconds` 轮询缓存；手动刷新先打 `POST /api/v1/balance/refresh` 再读回。浮层的刷新按钮带 `data-refreshing` / `data-cooling` 两个状态钩子，供 e2e 断言。
- `settings/`：四组可折叠的配置卡片、字段控件、暂存与保存状态机、凭据状态读取 → [settings/README.md](settings/README.md)。

## 关键导出

- `ENTRY_ID` / `BUNDLE_CONFIG_KEY` / `SIDEBAR_ENTRY_ID`：三个 id 各管一件事 —— 设置命名空间 = 本插件那一行的 Loader 条目 id、`plugins.bundle.config` 的 key（**包名**）、左下角条目的 slot id。前两个**今天同串，却不是同一个概念**（槽 key 取包名、`get()` 取条目 id）：漂开的表现是「卡片在、表单永远只读」，不报错 —— 由 `test/redlines.test.ts` 对账。第三个是纯 UI 身份，与它们都不同。
- `apply(ctx)`：向 `plugins.bundle.config` 与 `sidebar.footer.action` 各注册一次；两半共用**同一个** `ConfigForm`（`ctx.configForms.get(ENTRY_ID)`，`apply` 期建一次、引用稳定）—— **bundle 槽的座位 props 永远不带 form**（宿主两条线上同形），所以这是唯一读路径。
  - 左下角那条**显式写 `order: 0`**：宿主对 list 槽的排序是 `order` → `priority` → 注册先后，写 0 就是「与官方 cordis-panel 同序」——**改位置用 `order`，遮蔽别人用 `priority`，两者别混**（机制与证据：宿主 `packages/client/ui-slots/src/index.ts` 的 `order` 声明与 `ui-renderer/.../scoped-slots.tsx` 的渲染层二次排序，行号以当前检出为准）。
  同时建一个配置槽探测并随插件 fiber 释放：**它只喂浮层那行提示，不参与注册** —— 槽真的在时注册语义与探测无关。

## 依赖面

- 运行时只会 `require` 到 `react` / `react/jsx-runtime` / `@deepseek-ai/dsh-client-ui-primitives`，其余全部内联进 `lib/client.js`。
- 跨插件值导入会被 bundle-purity gate 拒绝：只能用官方包的公共导出，构件内部实现只能照抄模式。
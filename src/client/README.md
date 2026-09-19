# client/ — 浏览器半边手册

- 职责：注册两个 slot（左下角条目、Plugins 页里的配置卡片）与中英词典；所有界面都在这里。
- 变更影响路由：改这里的对外行为 → 同步根 [README.md](../../README.md) 与 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)；改完必须 `npm run build`，产物由 `dsh-client-hmr` 自动替换。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。

## 文件

- `index.tsx`：入口。注册词典、把宿主返回的 settings 作用域包成卡片依赖的最小面、向两个 slot 注册组件。`inject` 是运行时门禁，三项为 `slots` / `locale` / `settingsScope`，删任何一项都会让 `apply` 静默不跑。
- `config-slot.ts`：配置槽的**能力探测**（不查版本号）。三态 `pending` / `available` / `missing`，**可逆**：槽晚到会把 `missing` 拨回 `available`，已经出现的提示自己撤掉。纯逻辑 + 可注入时钟，所以能脱离浏览器测；缺槽时的英文 `[WARN]` 文案也在这里。理由见 [决策记录](../../.agents/notes/2026-09-19-capability-probe-for-config-slot.md)。
- `locales.ts`：中英词典。`zh` 是键集真源，`en` 用 `Record<LocaleKey, string>` 做编译期完整性检查。同时把命名空间并进 `LocaleNamespaceMap`。
- `model.ts`：纯函数视图模型。`severity` → 状态点与环色、**余额占 `warn` 阈值的弧长比例**（`ringRatioOf`，整数比较不走浮点）、金额字符串格式化、**从后端 `selected` 读出展示币种**、相对时间分档。**没有 React，不自己挑币种，也不用阈值配色。**
- `data.ts`：数据层。向后端要余额（`GET /api/v1/balance` 带 `currency` 查询参数）、触发手动刷新、读一次配置里的 `credential` 只读事实，并把「端点不可达」翻成可展示的错误态。**不缓存、不排程** —— 节奏归 `sidebar/`。可注入 `fetchImpl`，因此能脱离浏览器测。
  - 读宿主的**新增字段一律先过形状守卫**（如 `readCredential`）：客户端半边由 HMR 立刻换新、宿主半边要重启才换，新客户端会读到旧宿主的响应。
- `api-types.ts`：后端契约类型。既约束 mock，也约束 `data.ts` 拿回来的响应；宿主半边的序列化由 `test/http-wire.test.ts` 做编译期对齐断言。
- `css-modules.d.ts`：CSS Modules 的环境声明。
- `mock/`：开发场景数据，见 [mock/README.md](mock/README.md)。**默认走真实端点**：只有 URL 参数 `?dsb=<场景键>` 或 localStorage 明确选过场景才用 mock；`?dsb=live` 会清掉已存的选择并回到真实数据。`?dsb-dev` 会让 `isDevMode()` 返回真（当前仓库内没有消费方，切换器尚未接线）。
- `sidebar/`：左下角条目（状态圆环 + 名称）、点击展开的浮层、宿主容器补丁 → [sidebar/README.md](sidebar/README.md)。首拉一次后按 `clientPollSeconds` 轮询缓存；手动刷新先打 `POST /api/v1/balance/refresh` 再读回。浮层的刷新按钮带 `data-refreshing` / `data-cooling` 两个状态钩子，供 e2e 断言。
- `settings/`：四组可折叠的配置卡片、字段控件、暂存与保存状态机、凭据状态读取 → [settings/README.md](settings/README.md)。

## 关键导出

- `SETTINGS_NAMESPACE`：必须与宿主半边逐字一致，它是两半的配对键，也是左下角条目的 `id`；配置卡片的 `key` 是包名，与它无关。
- `apply(ctx)`：向 `plugins.bundle.config`（key = 包名）与 `sidebar.footer.action` 各注册一次；两半都能拿到同一个作用域对象（`apply` 期建一次，引用稳定）。
  - 左下角那条**显式写 `order: 0`**：宿主对 list 槽的排序是 `order` → `priority` → 注册先后，写 0 就是「与官方 cordis-panel 同序」——**改位置用 `order`，遮蔽别人用 `priority`，两者别混**（机制与证据：宿主 `packages/client/ui-slots/src/index.ts` 的 `order` 声明与 `ui-renderer/.../scoped-slots.tsx` 的渲染层二次排序，行号以当前检出为准）。
  同时建一个配置槽探测并随插件 fiber 释放：**它只喂浮层那行提示，不参与注册** —— 槽真的在时注册语义与探测无关。

## 依赖面

- 运行时只会 `require` 到 `react` / `react/jsx-runtime` / `@deepseek-ai/dsh-client-ui-primitives`，其余全部内联进 `lib/client.js`。
- 跨插件值导入会被 bundle-purity gate 拒绝：只能用官方包的公共导出，构件内部实现只能照抄模式。
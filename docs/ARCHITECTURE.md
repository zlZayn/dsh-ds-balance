# ds-balance 架构说明

本文件写不变的设计决策、数据流与防错清单；文件级清单归各子目录 `README.md`。

## 项目定位

- 现阶段只做 UI：左下角余额显示 + 设置卡片。
- 设置卡片只做配置，不展示任何额度信息。
- 左下角只显示状态与名称，金额只在点击浮层里看；「今日已用」与「本轮消耗」不做。
- 数据全部来自 `src/client/mock/`，不发起任何真实网络请求。
- 后端契约（`/api/v1/balance` 等）只作为 mock 数据的形状参照，本阶段不实现。

## 数据流

- 宿主半边：只登记 settings schema，让配置能落进 `$DSH_HOME/settings.yaml`，无业务逻辑。
- 浏览器半边：读 mock → 映射成视图模型 → 渲染左下角与设置卡片。
- 视图模型只消费后端契约字段，不感知阈值策略。
- 颜色由 `severity` 机械映射，前端不做金额比较。

## 关键决策

- 左下角落点 = `sidebar.footer.action`；折叠 / 展开由该槽的 `wide` prop 决定，不自行探测宽度。
- 设置界面落点 = `settings.plugin.item`，取代任务书原稿的 `settings.section`。
- 样式只用 CSS Modules + `--dsw-alias-*` 语义 token；禁 Tailwind、禁组件库、禁字面色值。
- 主题由 `body[data-ds-dark-theme]` 承载，插件直接读 CSS 变量，不写主题选择器。
- 构建 = `tsc` + `tsc -p tsconfig.client.json` + 自研 esbuild 打包（复刻 `window.__ModuleLoader__.load` 信封）。
- `sidebar.footer.action` 的宿主容器缺 `flex-direction`，插件侧用 `:has()` 反选父元素补成纵向堆叠；这是唯一一处插件覆盖宿主布局的地方。
- 依赖锚点跟随宿主运行的 alpha 线。
- 设置卡片分四组、各自可折叠，顺序是 连接 → 展示 → 阈值 → 刷新（按使用频率排）；宿主 `Config` 的字段顺序是 连接 → 刷新 → 展示 → 阈值（按任务书排）。**两者有意不同，不要改成一样。**
- 默认只展开「连接」组；组内有非法草稿时该组强制展开 —— 非法会禁用保存，收起的组会让 footer 的「请检查标红的字段」指向看不见的地方。
- 凭据字段（`apiKey` / `apiKeyRef`）在标签行右侧带状态胶囊：已覆盖 / 已配置 / 未配置。
- 「显示币种」是整行左右布局（左文字 + 右选择器胶囊），不是上下结构。

## 契约

`GET /api/v1/balance` 响应形状（本阶段只在 mock 中体现）：

- `state`：`empty` / `ok` / `stale` / `error`
- `severity`：`ok` / `warn` / `critical` / `unavailable` / `unknown`
- `balances[]`：金额是字符串，可能多币种，数组顺序可能跳变
- `todayUsage`：可为 `null`；`source` 为 `blended` / `balance-observed` / `projection`

完整字段清单、`severity` 映射表、币种回落规则、配置契约与后端移交说明 → [UI 侧契约与移交](ui-handoff.md)。

## 防错清单

- 金额一律按字符串处理，禁止用浮点数做相等比较或累加。
- 多币种时不得依赖数组顺序，按 `currency` 取值。
- `state` 与 `severity` 是两个独立维度，不得互相推导。
- 折叠态与展开态都必须能吃下所有 `severity`，未知值回落 `unknown`。
- 组件拿不到 `ctx`；数据只能走注册项的 `inject` 工厂。
- 跨插件值导入会被 bundle-purity gate 拒绝，只能用公共导出。
- `lib/client.js` 路径被浏览器信封占用，`src/client.ts` 会造成宿主启动崩溃。
- 侧栏底部的按钮**不得**写 `aria-haspopup`：已装邻居用它做 DOM 遍历来找设置触发按钮，会先命中我们。
- 浮层在关闭态**不得**留下可命中区域；向上展开时盖住上邻是既定取舍，不许靠改定位去「顺便修好」。

## 阶段边界

- 本阶段不做：真实接口、账本 / 投影 / 手工校正、诊断层、独立页面、图表。
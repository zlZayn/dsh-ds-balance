# ds-balance — 原生 UI 与插件机制勘察（阶段 0）

勘察对象：`D:\ProjectSomething\deepseek-harness`（宿主源码）+ 本机运行实例 + 已装第三方插件。
证据口径：所有结论附 `路径:行号`；未找到项已列关键词。像素值多来自源码常量，非屏幕实测。

## 结论摘要

- 两个目标 slot 均真实存在，均为加性 list 槽，新 id 注册不会遮蔽原生 UI。
- slot 层没有任何版本机制；插件声明宿主兼容的唯一途径 `engines.dsh` 无消费方。
- 插件分两半：客户端 `lib/client.js` 有热更，宿主 `lib/index.js` 必须重启才换。
- 仓外没有官方构建预设，必须自研 esbuild 包装复刻 CJS 信封。
- `dsh.client` 只有 4 个键；客户端入口是 `exports["./client"]`。
- 样式只用 CSS Modules + `--dsw-alias-*`；禁 Tailwind、禁组件库、禁字面色值。
- 主题靠 `body[data-ds-dark-theme]`；插件直接读 CSS 变量，无需 import。
- 原语缺口：无数字输入、无通用卡片、无表格；无间距 / 圆角 / 层级 token。
- 宿主仓库内**不存在任何余额 / 额度 / 计费 UI**；余额缺口只表现为一次失败的 LLM 请求。
- 最贴近需求的现成先例是本机已装的 `dsh-usage-statistics-panel`（同时占了我们要的两个槽）。
- 你已有的 `D:\ProjectSomething\dsh-zhihu-search` 是完整可照抄的仓外插件模板。

---

## 0.1 Slot 声明与键清单

- 类型权威：`packages/client/ui-slots/src/index.ts`；`SlotMap` 为 :26 的空接口，各包 `declare module` 合并。
- 运行时服务 `ctx.slots`：`packages/client/ui-renderer/src/client/registry.ts:95`，服务名在 :134。
- 键清单权威：`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:81` 的 `CLIENT_SLOT_API`，共 63 条，由 `scripts/gen-client-catalog.ts` 生成。
- 契约声明分散在各包 `src/client/contract/slots.ts`；运行时声明在渲染组件的 children 表。
- 注册唯一入口：`ctx.slots.register(options, component)` → 幂等 disposer，两个重载在 `ui-slots/src/index.ts:780` / `:807`。
- 必须包一层 `ctx.slots.inject(key, cb)` 等待声明（`registry.ts:172`）。
- 注册进未声明槽会抛错（`ui-slots/src/index.ts:829`）。
- options 形状按 kind 分：list 需 `id`（可 `order` / `label` / `priority`）；keyed 需 `key`；chain 需 `select`；single 只需 `priority`（`:519` / `:566`）。
- 注销：调 disposer；插件 fiber 卸载时由 `ctx.effect` 级联（`registry.ts:606-613`）。
- 组件 props = `ComposedProps`（`:481`）：运行期 + 槽渲染 + store + inject face + locale。
- 组件**拿不到 `ctx`**（`docs/subsystems/slots.md:75`）；私有数据只能走注册项的 `inject` 工厂。
- 动态包注册被 guard 自动分配最低 priority（`guard.ts:119-126`）；list 槽 + 新 id 不受影响。

### 两个目标槽

| 键 | kind | scope | owner props | 原生占用者 | replaceRisk |
|---|---|---|---|---|---|
| `sidebar.footer.action` | list | root | `{ wide: boolean }` | cordis-panel ×1 | none |
| `settings.section` | list | root | `{ close: () => void }` | general / models / plugins / agent-presets / archived-sessions | none |

- 契约位置：`packages/client/ui-sidebar/src/client/contract/slots.ts:50`、`packages/client/ui-settings/src/client/contract/slots.ts:54`。
- 渲染点：`SidebarRoot.tsx:270`、`SettingsRoot.tsx:100`（带 `{ only: active }` 过滤）。
- `wide` 直接由 shell 下发；`false` 对应 56px rail（`ui-sidebar/src/client/contract/slots.ts:100,106`）。
- 折叠 / 展开两套排版按该字段分支，无需自行探测容器宽度。

---

## 0.2 原生余额 / 状态 / 设置类 UI

- 仓库内**无** balance / quota / credit / billing / 套餐 类 UI；`packages/client` 下 `QUOTA` 命中 0。
- 余额缺口只表现为一次失败的 LLM 请求：`packages/llm/llm/src/error.ts:28` `QUOTA_EXCEEDED_CODE='QUOTA'`，分类器 :94-100，deepseek transport :30 把 HTTP 402 也判为 QUOTA。
- 用量类指示器两个：
  - `ContextMeter` 上下文占用环，`ui-conversation/src/client/skeleton/ContextMeter.tsx`，无数据 `return null`。
  - `StatsPills` 会话统计胶囊，`ui-chat/src/client/chat/StatsPills.tsx`，注册在 `conversation.composer.dock`。
- 状态表达统一走原语 + 语义 token：`StateDot`（done / warning / ongoing / error / idle）、`Tag`（8 tone）、`ConnectionIndicator`。
- `ConnectionIndicator` 就挂在侧栏 Settings 行旁（`SettingsRoot.tsx:225-233`）。
- 设置外壳几何：面板 800px 宽、左导航 188px（`SettingsRoot.module.css:83-113`）。
- 分区只消费 `id` / `order` / `label`；**外壳不自动生成表单**，字段由各分区自画。
- 共享「暂存 + 保存」模型在 `ui-settings-plugins/src/client/card-form.ts`：`CardFieldSpec:25-35`、`numberField:116`、`textField:137`。
- 保存态三件套：`CardShell { saving, failed, dirty, invalid, writable }`（`:64-77`）；失败保留草稿不丢输入（`PluginCard.tsx:86-103`）。
- 关键限制：`card-form` 的构件**不是运行时导出**（只有 `apply` / `inject`），且跨插件值导入被 bundle-purity gate 拒绝 → 只能照抄模式，不能 import。

---

## 0.3 Design token

- 单一 token 包 `@deepseek-ai/dsh-client-ui-theme`；风格表在 `packages/client/ui-theme/src/styles/`，共 6 张。
- 变量前缀 `--dsw-*`，共 357 个；声明在 `body` 上，**不是 `:root`**。
- 类别：static 73 / alias 79 / specific 11 / font 181 / shadow 4 / elevation 5 / linear 2 / mask-blur 1 / corner-shape 1。
- **不存在**：间距 token、圆角 token、层级 token（`--dsw-space` / `--dsw-radius` / `--dsw-z-` 全仓 0 命中）。
- 语义别名分组：label 9 / bg 13 / border 7 / state 11 / brand 4 / interactive 5 / button 15 / link 1 / markdown 8 / scrollbar 4 / tooltip+toast 2。
- 状态色 11 个，**无 neutral**：
  - `--dsw-alias-state-success-{primary,secondary,tertiary}`
  - `--dsw-alias-state-warn-{primary,secondary,tertiary,label}`
  - `--dsw-alias-state-error-{primary,secondary}`
  - `--dsw-alias-state-business-{primary,tertiary}`（info 蓝）
- 亮基座 `body{...}`（`design-platform.css:4,156`）→ 暗覆盖 `body[data-ds-dark-theme]{...}`（`:80,251`），逐 token 重写同名变量。
- 规范全文我已通读：`docs/web-styling.md`。硬规则：
  - 用 CSS Modules + `clsx`；不加组件库、不加 Tailwind。
  - 业务组件只用 `--dsw-alias-*`；不拷贝静态色阶、不写字面颜色。
  - 主题选择器不进业务组件 CSS。
  - 字号必须配行高。
  - 表现放 CSS；内联 style 只能传组件局部 CSS 变量。
  - 全圆角必须配 `corner-shape: round`。
  - 高程表面 `border: 0` + `box-shadow: var(--dsw-elevation-panel|prominent|soft)`；不与 `--dsw-alias-border-*` 同时用。
  - 中性实线边框统一 `0.5px`；虚线 / 状态色边框保持 1px。
  - 保留键盘焦点可见性与 reduced-motion。

---

## 0.4 ui-primitives 组件清单

包 `@deepseek-ai/dsh-client-ui-primitives`；导出面 `packages/client/ui-primitives/src/index.ts:1-73`。

| 需求 | 有无 | 组件与要点 |
|---|---|---|
| 开关 | 有 | `Switch`，36×20，`label` 必填 |
| 文本输入 | 有 | `Input`，h32 / r8 |
| 数字输入 | **无** | 无原子 |
| 下拉 | 有 | `Menu`，自绘卡片，非 `<select>` |
| 按钮 | 有 | `Button`，primary / ghost / outline / toolbar；md36 / sm28 |
| 卡片 | **无** | 无通用原子，各 feature 自实现 |
| 表格 | **无** | 无通用原子 |
| 状态点 | 有 | `StateDot`，done / warning / ongoing / error / idle |
| tooltip | 有 | `Tooltip`，`{ label, side, delayMs, disabled, maxWidth }` |
| popover | 有 | `HoverCard`（244px r12）/ `Menu` portal |
| 徽标 | 有 | `Tag` 8 tone / `Pill` |

- 其他可用：`Modal`、`RiskConfirmation`、`Toast`、`DisclosureRow`、`ConnectionIndicator`、`JsonTree`、`MarkdownText`、`CodeBlock`、`FishLogo`、`BrandWordmark`、`icons/*`。
- 原生浮层实现方式：`Tooltip` 克隆锚点 + fixed；`HoverCard` / `Menu` / `Modal` portal 到 body。
- 跨插件值导入被 bundle-purity gate 拒绝；只能使用公共导出。
- 状态色映射既有实现：`StateDot.module.css:35-51`、`Tag.module.css:39-57`。
- 官方范式是「业务状态 → 枚举 → 组件内映射 token」，**没有 `ok/warn/critical` 字符串常量表**。

---

## 0.5 现有余额插件与注册范例

- **无余额类插件。** 本机 web profile 仅装 4 个仓外插件：`dsh-usage-statistics-panel` 0.2.2 / `dsh-opencode-session` 0.1.1 / `@xmanrui/dsh-im` 4.21.0 / `dsh-zhihu-search` 1.6.3。
- 其中只有 `@xmanrui/dsh-im` 是符号链接（→ `D:\ProjectSomething\dsh-im`），其余是拷贝快照。

### 范例一：原生 `ui-cordis`（注册 `sidebar.footer.action` 的完整写法）

- 注册代码：`packages/extensions/ui-cordis/src/client/index.ts:87-115`。
- 组件：`src/client/CordisPanel.tsx`（491 行全可读）；空态 `return null`（:179）。
- 浮层：`position: fixed` + `useLayoutEffect` 量测锚点（:127-138）+ `useDismissOnOutsidePointer`；面板 420px / `max-width: calc(100vw - 24px)` / `max-height: 60vh` / `z-index: 30`（`CordisPanel.module.css:82-101`）。
- 样式：`CordisPanel.module.css:3-35`，42px 行；badge `width: calc(100% + 4px)` / `margin: 0 -2px`。

### 范例二：`dsh-usage-statistics-panel`（最贴近需求）

- 一次 `apply` 注册 3 个 slot（`src/client/index.tsx:80-111`）：
  - `settings.section`，id `usage-statistics`，order 30。
  - `sidebar.footer.action`，id `usage-statistics`，order 0。
  - `conversation.composer.dock`，id `stats`，priority -1（遮蔽官方）。
- `SidebarEntry.tsx:67-84` 用 `wide` 决定图标尺寸与是否显示文字；CSS 对齐官方 42px 行 / 36px rail。
- 风险点：它从 footer 按钮「打开设置并跳到指定分区」靠 DOM 遍历（`:35-60`），原生无公开 API。
- 另一风险：包内 `cordis.patch.yml` 注释警告同包双挂载会因路由前缀重复导致整棵插件树启动失败。

### 范例三：`D:\ProjectSomething\dsh-zhihu-search`（你自己的仓外插件模板）

- 结构：`src/` 每目录双件 + `docs/ARCHITECTURE.md` + `docs/postmortem/` + `.agents/notes/` + `scripts/` + `test/` + `.node-version` + `cordis.patch.yml` + 中英双 README。
- `package.json` 已具备我们要的全部形态：`type: module`、`exports["."]` + `exports["./client"]`、`dsh.bundle.patch`、`dsh.client.{platform, inject}`、scripts `build/typecheck/test`。
- `scripts/build-client.mjs` 是仓外构建的现成答案（见 0.6）。
- 它的「活跃坑」清单含 9 条与本项目直接相关的平台陷阱（见 0.11 / 0.12）。

---

## 0.6 cordis.patch.yml 与 dsh.client 清单

- `dsh.client` 只有 4 个键（`packages/util/package-manifest/src/types.ts:68-82`）：
  - `platform`：必填，Web 只认 `"web"`（仓内 49 个 package.json 全是它）。
  - `inject`：包名级 graph 边，**不是** Cordis 服务注入。
  - `immediately`：stage-one 注册屏障。
  - `external`：在基线之外追加的精确模块表请求。
- 运行期校验只读这 4 个键，不拒绝未知名（`manifest.ts:157-177`）。
- 客户端入口不是清单字段，而是 `exports["./client"]`（`docs/subsystems/client-modules.md:77`）。
- 样式也没有清单字段：构建期编成注入 `<style data-plugin-css>` 的 JS（`packages/client/tsdown.client.ts:1-11,43-55`）。
- `lib/client.js` 形态是硬约束，必须是 CJS + 信封：
  - `window.__ModuleLoader__.load({ id: "<pkg>", factory: (require) => { ... } })`
  - 逐字来源 `tsdown.client.ts:566-580`。
- 官方预设**不对外发布**（`docs/cookbook/adding-a-settings-card.md:102` 明写仓外必须自行复刻）。
- 仓外可抄的两份 esbuild 实现：`dsh-zhihu-search/scripts/build-client.mjs`、`dsh-im/plugin-src/client/build.mjs`。
- `cordis.patch.yml` 语法：顶层必须是 YAML 数组（`packages/boot/app-boot/src/index.ts:373-380`）；项形状 `{ id?, insert?, name?, config?, group?, disabled?, inject?, intercept?, isolate? }`（`vendor/include/src/index.ts:129-141`）。
- 层序：profile bundles → profile 自己的 patch → `$DSH_HOME/cordis.patch.yml` → `--patch` overlay。
- `id` 未命中只告警跳过（`include:104-113`）。

---

## 0.7 数据获取模式

宿主 ↔ 浏览器共 4 类入口。

| 方式 | 语义 | 真实范例 |
|---|---|---|
| `ctx.connection.rpc.handle/intercept` + 客户端 `rpc.call` | 自定义 RPC | `dsh-im/plugin-src/management-rpc.mjs:41-77` |
| `ctx.connection.fetch.register({ path, methods, requestBody, fetch })` | 注册 HTTP 端点；载体已先施加信任 + 浏览器鉴权 | `client/connection/src/rpc.ts:115-135` |
| Typert `@Remote` | 类型化 RPC；一元调用永不 reject，返回 `RemoteResult<T>` | `packages/goal/goal/src/index.ts:240` |
| `ctx.webServer.register({ kind, path, handler })` | 任意 HTTP 路由，**无鉴权** | `packages/webhook/webhook-github/src/index.ts:46-62` |

- React 组件拿不到 `ctx`；只用 slot 标准 props（`useSession` / `useProjection` / `useSessions` / `useWorkspaces` / `useChat` / `useConversation`，表见 `docs/subsystems/slots.md:81-93`）。
- 私有数据走注册项的 `inject` 工厂；hooks 里裸 observable 转成 `useX(selector)`。
- 本任务不写后端：mock 层在客户端内部，`/api/v1/*` 只作为 mock 数据的契约形状。
- `inject` 门禁按服务名**逐字**判，点号键不展开成父级。

---

## 0.8 配置持久化

- 文件：`$DSH_HOME/settings.yaml`；命名空间 = 顶层键（`settings-file/README.md:42-47`）。
- 宿主侧：`ctx.settings.register(ns, Schema, { base })` 或 `ctx.settings.installSection(...)`。
- 客户端侧：`ctx.settingsScope.bind({ namespace })`，再用 `scope.set/unset/mutate`。
- 校验：Schemastery schema，加载期校验，非法配置 fail loud。
- 保存带 revision 栅栏（`settings-scope.ts:106-144`）；失败重读镜像恢复（`:147-151`）。
- 本机 `settings.yaml` 现有顶层键：`ui-onboarding` / `llm-deepseek` / `llm-pi-ai` / `agent-default-model` / `locale` / `permission` / `ui-theme` / `subagent-model-selection` / `agent-loop` / `zhihu-search` / `ui-chat`。
- 先例约定：`zhihu-search` 用包名当命名空间，与 package.json `name` 同名。

---

## 0.9 本地化

- 词典是 TS 对象；`zh` 为键集真源，`en` 用 `satisfies Record<Key, string>` 做编译期完整性检查（`packages/client/ui-goal/src/client/locales.ts:1-36`）。
- 命名空间需 `declare module` 合并 `LocaleNamespaceMap`。
- 注册：`ctx.locale.register(NS, { zh, en })`，作为 fiber effect。
- 取文案两条路：注册项声明 `locale: NS` → 组件 `t` prop；组件外用 `ctx.locale.bind(ns)`。
- 只内建 zh / en；外部语言包 `ctx.locale.addLanguage({ id, label, fallback })`，fallback 链必须终止于 `en`。
- 切换入口 Settings → General，持久化到 `locale.preference`（本机实测为 `en`）。
- 第三方多语言真实写法：`dsh-usage-statistics-panel/src/client/index.tsx:59-64`。

---

## 0.10 主题

- 载体：`body[data-ds-dark-theme]` 布尔属性；无 class、无 `data-theme`。
- 写入：`packages/client/ui-layout/src/client/theme-presenter.ts:14,45-46`。
- 偏好三档 `light | dark | system`；`system` 由 `matchMedia` 解析（`ui-theme/src/client/index.ts:181-193`）。
- 首屏防闪：`boot-theme.ts:31` 预置属性 + head CSS 画布色（`:15-21`）。
- 切换入口：设置 → General → Appearance（`ui-theme/src/client/index.ts:454-461`）。
- 插件消费：**直接读 CSS 变量即可，无需 import 任何东西**。
- 禁止在功能组件 CSS 里写 `body[data-ds-dark-theme]` 选择器。

---

## 0.11 HMR 与调试

- 宿主半边**无默认热更**：`packages/bundle/base/cordis.patch.yml:19-25` 把 `cordis-plugin-hmr` 挂成 `disabled: true`。
- `patchReload: "live"` 只覆盖配置监听，不等于宿主代码热更。
- 浏览器半边**有**热更：`dsh-client-hmr` 轮询 `lib/client.js`，符号链接安装下 build 即换，无需刷新页面。
- 开发环因此是：改客户端 → build → 浏览器自动换；改宿主 → 必重启。
- 构建：`tsc && tsc -p tsconfig.client.json && node scripts/build-client.mjs`。
- 挂载：只用官方 CLI `dsh plugin --profile web add <path>`（会顺带 reconcile `dsh.profile.bundles`）；不要手改 `cordis.patch.yml`。
- 安装形态：`<DSH_HOME>/profiles/<profile>/node_modules/<pkg>` → 插件仓库。
- 符号链接模式下 `npm run build` **直接写线上**，未验证的构建会立刻影响正在使用的界面。
- 日志：无官方日志文件；宿主日志 = 启动终端控制台。
- token 不落盘；重启后旧标签页 401。

---

## 0.12 版本兼容矩阵

- slot 层**完全没有**版本机制：`SlotEntryDef`（`ui-slots/src/index.ts:110-132`）无 version 字段。
- ui-slots 内所有 `version` 命中都是运行时变更计数器。
- 全仓无 slot 的 `@deprecated` 标记；无 allowlist 校验。
- 插件声明宿主兼容的唯一途径：`package.json.engines.dsh`（`package-manifest/src/types.ts:39-49`）。
- 但 `:21` 注释明写「DSH compatibility is declarative until a reader enforces it」，全仓找不到执行它的代码。
- 所有相关包同为 `0.1.6-alpha.1`；仓内一律 `workspace:^`，无 semver 下限可参照。
- 第三方先例 `dsh-zhihu-search` 声明 `^0.1.5-rc.2`，其待办自记「声明面已落后于实际部署」。
- dist-tag 语义：`next` = 当前承诺线，`alpha` = 前瞻线，`latest` **不可用**（多数包指向很早的版本）。
- 结论：插件无法声明「需要某个 slot 键存在」；只能靠 `ctx.slots.inject` 等待，或接受注册抛错。

---

## 附 A：本机现状（只读探测）

- `DSH_HOME=C:\Users\speak\.dsh`；活动 profile `web`；`DSH_WEB_URL=http://127.0.0.1:3080`。
- 宿主 `0.1.6-alpha.1`；进程 PID 11464，启动于 2026/9/17 01:57:02。
- profiles：`web`（活动）/ `add` / `node_modules`。
- web profile bundles：dsh-base / dsh-web-app / dsh-usage-statistics-panel / dsh-opencode-session / `@xmanrui/dsh-im` / dsh-zhihu-search。
- `$DSH_HOME/cordis.patch.yml` 不存在；web profile 自己的 patch 是空数组。
- 工具链：git 2.55.0 / node v24.18.0 / pnpm 11.17.0 / npm 12.0.1 / corepack 0.35.0。
- 工作区 `D:\ProjectSomething\dsh-ds-balance` 目前不是 git 仓库。

## 附 B：sidebar 空间约束

- 渲染顺序：`.footArea` 内 `footerActions`（`sidebar.footer.action`）在上，`settingsArea`（`sidebar.settings`）在下（`SidebarRoot.tsx:267-275`）。
- 宽度归 `ui-layout`：`SIDEBAR_MIN 264` / `MAX 420` / `DEFAULT 280` / `COLLAPSED 56` / `AUTO_COLLAPSE 1024`（`columns.ts:13-23`）。
- 侧栏内边距 `--dsh-sidebar-inline-padding: 12px`；rail padding `18px 10px 6px`。
- 插件容器 `width: 100%; min-width: 0`；官方与第三方通用技巧是 `width: calc(100% + 4px); margin: 0 -2px`。
- 换算（源码常量推导，非实测）：宽态默认可用约 260px，最小约 240px，最大约 396px；rail 态 36×36。
- 竖向不会被挤（`.footArea flex: none`）；溢出被裁剪，宽内容必须自带 ellipsis。
- 侧栏 tooltip 的标准用法是 `disabled={wide}`（`SidebarRoot.tsx:62,211,230`）。

## 附 C：未找到与不确定项

- 未找到：slot 版本号 / 兼容范围 / 弃用标记 / `engines.dsh` 强制读取器 / slot 键别名迁移表。
- 未找到：余额 / 额度 / 计费类 UI 或设置分区；`dsh-official` 插件包不存在。
- 不确定：`engines.dsh` 是否在仓库外（发布流水线 / profile launcher）被执行。
- 不确定：`CLIENT_SLOT_API` 与真实 bundle 是否漂移（未运行 verify 脚本）。
- 不确定：文档 `docs/subsystems/slots.md:50-52` 与代码 `ui-settings/src/client/contract/slots.ts:89` 对 `settings.general.item` 的说法不一致。
- 不确定：从 footer 打开设置并跳分区无公开 API；第三方靠 DOM 遍历（风险点）。
- 不确定：`settings.section` 导航图标按 id 硬编码，未知 id 回落齿轮（`SettingsRoot.tsx:30-37`）。
- 未实测：本报告所有像素值为源码常量推导，未在屏幕上量过。

---

## 阶段 1 待拍板清单

| 编号 | 决策 | 选项 | 倾向 |
|---|---|---|---|
| Q1.1 | 左下角落点 | `sidebar.footer.action` | 已勘察确认，可用 |
| Q1.2 | 设置页落点 | A `settings.section`（任务书写法）/ B `settings.plugin.item`（你 zhihu-search 先例） | 按任务书 A，需你确认 |
| Q1.3 | 折叠态 SVG 形态 | 圆环 / 鲸鱼 / 其他 | 待你定 |
| Q1.4 | 是否保留鲸鱼品牌图标 | 保留 / 不用 | 待你定 |
| Q1.5 | 状态点实现 | A 复用 `StateDot` 原语 / B 自绘 CSS 圆点 | 建议 A |
| Q1.6 | 浮层宽度与行数 | 420px（跟 CordisPanel）/ 自定义 | 待你定 |
| Q1.7 | 刷新图标位置与交互 | 任务书已定：浮层右下角 16px `currentColor` | 确认即可 |
| Q1.8 | 语言策略 | 跟随 dsh（zh/en 双词典）/ 固定中文 | 建议跟随 |
| Q1.9 | 「启用左下角」关闭后的行为 | A 注册后 `return null` / B 不注册 / C 灰显 | 待你定 |
| Q1.10 | 配置命名空间 | `ds-balance` / `balance` / `deepseek-balance` | 建议 `ds-balance` |
| Q1.11 | 构建链 | 自研 esbuild 包装 | 你的 zhihu-search 已确认此路 |
| Q1.12 | 宿主半边程度 | A 最小 settings schema / B 纯前端 state 不落盘 | 待你定 |
| Q1.13 | 依赖锚点 | `^0.1.5-rc.2` / `^0.1.6-alpha.1` | 待你定 |
| Q1.14 | 数字字段控件 | A `Input` + 校验 / B 照抄 `card-form` 的 `numberField` 模式自绘 | 待你定 |
| Q1.15 | `severity` → 组件映射 | 见下表 | 待你确认 |
| Q1.16 | 是否声明 `engines.dsh` | 写 / 不写 | 待你定 |
| Q1.17 | 本报告文件名与位置 | `docs/recon-native-integration.md` | 待你定 |

### Q1.15 映射草案

| `severity` | StateDot | 颜色 token |
|---|---|---|
| `ok` | `done` | `--dsw-alias-state-success-primary` |
| `warn` | `warning` | `--dsw-alias-state-warn-primary` |
| `critical` | `error` | `--dsw-alias-state-error-primary` |
| `unavailable` | `error` | `--dsw-alias-state-error-primary` |
| `unknown` | `idle` | `--dsw-alias-label-tertiary` |

- 官方无 neutral 状态色；`unknown` 只能走 `label-tertiary`，与「unknown 灰」一致。

---

## 来源

- 勘察方法：4 个 subagent 并行只读扫描，结论均带 `路径:行号`。
- 原始长文（临时，将被 `.gitignore` 忽略）：`recon/01-slots.md` / `recon/02-design-system.md` / `recon/03-native-precedents.md` / `recon/04-runtime-integration.md`。
- 关键规范原文：`deepseek-harness/docs/web-styling.md`。

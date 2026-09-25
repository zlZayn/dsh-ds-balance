# 深链落点：宿主有那条服务才谈得上

**类型**：决策记录（问题 / 事实 / 决策 / 替代方案 / 影响）。
**缘起**：维护者实机反馈——① 浮层右上角图标**仍然**到不了本插件的配置格（深链）；② 它的悬浮文字写的是「打开插件页」，按钮的意思却是「打开插件配置页」，措辞要精确。

## 问题

上一轮把深链接上了（[src/client/index.tsx](../../src/client/index.tsx) 的 `pluginNavigation` 注入 + `openBundle(BUNDLE_CONFIG_KEY)`），判据写的是「服务在不在」。可维护者点下去还是只到 Plugins 列表页 —— 到底是产物没生效、还是**服务压根不在**？

## 事实（实测，出处给到文件）

- **本机跑着的宿主是哪一版**：`Get-CimInstance Win32_Process` 里 `dsh web` 的命令行指向 `%APPDATA%\npm\node_modules\@deepseek-ai\dsh\lib\bin.js`，该包 `package.json` 的 `version` = **0.1.7-rc.1**（目录写入时间 2026-09-23 21:52）。
- **这一版没有深链服务**：同一条安装路径下 `node_modules/@deepseek-ai/dsh-client-ui-plugin-manager`（**0.1.7-rc.1**）的 `lib/client.js` 里，`pluginNavigation` / `openBundle` **一个都搜不到**；它的 `lib/types/client/index.d.ts` 只导出 `NS` / `PANEL_ID` / `inject` / `apply`。`ctx.inject(['pluginNavigation'], …)` 因此**永不触发**，图标只剩 `ctx.layout.selectPanel('plugins')` 这一档 —— 这正是维护者看到的「仍然到不了」。
- **这条缝是后一条 rc 才有的**：rc 线的下一版源码（本机快照 `_dsh-rc2/packages/client/ui-plugin-manager`，包版本 **0.1.7-rc.2**）在 `src/client/index.ts:122` 里 `ctx.reflect.provide('pluginNavigation', { openBundle })`；`openBundle` 做两件事：`ctx.layout.selectPanel(PANEL_ID)` + 导航 store `setView({ kind: 'package', name })`（`navigation-store.ts` 的 `createNavigationStore`）。它在 `ctx.slots.inject('main', …)` 里 provide，**随面板注册同生**；`tests/browser-plugin.client.spec.tsx:70` 演示了跨插件 ctx 直接调用它。
- **alpha 线至今没有**：`deepseek-harness/packages/client/ui-plugin-manager`（**0.1.7-alpha.1**）里同样搜不到这两个词。
- **三条 dist-tag**（本轮现查 `npm view @deepseek-ai/dsh dist-tags`）：`latest` = 0.1.5-rc.3、`alpha` = 0.1.7-alpha.2、`next` = **0.1.7-rc.2**。**本机装的那份（rc.1）当时既不是 latest 也不是 next** —— 它是更早从 next 线装下来的快照，之后 next 前进了 rc 而本机没跟。
- **插件这一侧早就写对了**：仓库 `lib/client.js` 与 profile 里装的那份 **SHA256 逐字节相同**（= npm 上的 2.1.0，`E44C0713…D37EC`），里面就有特征检测与 `openBundle(BUNDLE_CONFIG_KEY)` 调用 —— 「到不了」不是产物的缺陷。
- **浏览器实机复现**（Tabbit，另开一个带同一 token 的临时标签页，验完即关）：浮层右上角那个按钮 `aria-label` 与悬浮气泡**逐字都是 `Open the Plugins page`**；点下去浮层关闭、主区切到 Plugins 面板的**列表页**（`Add and manage plugins`，Official 6 / Installed 5），**不是**本插件的配置格。即 `selectPanel('plugins')` 这一档跑通了，深链那一档因为服务不在而整条不存在。

## 决策

1. **深链实现一个字不改**：签名、`this` 绑定、先切面板再定位都与 rc.2 的源码逐条对过。要让它生效只能**把宿主换到 provide 了这条服务的线上**（判据仍不是版本号，是服务在不在）。
2. **措辞按落点分档**（本轮唯一的代码改动）：快照里带上 `reachesConfig`，浮层据此选词典键 —— 能直达配置格说「打开插件配置页」，只能到列表说「打开插件页」。
   **一句话盖不住两种落点**：说了去哪就得去哪。这条与「不留按不动的死按钮」「不假装写入成功」是同一条纪律。
3. **两档都给 `aria-label` 与 tooltip 逐字同源**：读屏与悬浮看到的是同一句话。
4. **两个服务各有挂载点**：旧形状只有一个 `attach` 槽，第二次 `attach` 会把第一次顶掉；现在 `attachPanel` / `attachDeepLink` 各管一条链，谁先到都不影响另一个（并各自触发一次重发）。

## 替代方案（想过，为什么不选）

1. **把文案一律改成「打开插件配置页」**。不选：在没有那条服务的宿主上（本机当时就是）它点下去只会到列表页 —— 界面说了句自己做不到的话，比旧文案更糟。维护者要的「精确」是**与落点一致**，不是把字写长。
2. **没有深链服务时干脆不渲染这个图标**。想过（与 `layout` 缺席时的做法一致），没选：退回列表页仍是个有用的落点，把名字改准就够了；真删掉会让旧宿主上连这一个入口都没有。
3. **插件侧自己造一个「配置页」**。不选：配置卡片挂在宿主的 `plugins.bundle.config` 槽上、页面与视图状态都归 ui-plugin-manager；插件侧另造页面等于在宿主界面里开一个平行入口。

## 验证（实机，两档各跑一次；两档都用本轮构建的产物）

- **档 ①（宿主没有那条服务）= 本机主实例那条线**：另起一个隔离实例（独立 `DSH_HOME`、把本仓以**符号链接**装进 `verify` profile、端口分开），Tabbit 真机点一遍：浮层右上角按钮的 `aria-label` 与悬浮气泡逐字都是 **`打开插件页`**；点下去浮层关闭、主区落在 **Plugins 列表页**（`添加和管理插件` / 官方 6 / 已安装 1）。
- **档 ②（宿主 provide 了深链服务）**：另装一份 `@deepseek-ai/dsh@next`（当时 = **0.1.7-rc.2**）到临时目录，同样独立 `DSH_HOME` + 符号链接装本仓，起在另一个端口，同一套动作再来一遍：`aria-label` 与悬浮气泡逐字都是 **`打开插件配置页`**；点下去落在 **本插件的 bundle 详情页**（面包屑「插件列表」、标题 `DeepSeek 余额 v2.1.0`、描述，以及我们的配置卡片「连接 / 展示 / 阈值 / 刷新 / 保存」）。
- **维护者的主实例（rc.1 + npm 上那份 2.1.0）在改动前也点过一遍**：`Open the Plugins page` + 列表页 —— 与档 ① 同形，说明当时的症状就是「服务不在」，不是产物没生效。
- 截图留在会话工作区（不在仓库里）：`_verify/rc1-new-build-hover-tooltip.png`、`_verify/rc1-new-build-plugins-list.png`（档 ①）、`_verify/rc2-hover-tooltip.png`、`_verify/rc2-config-page.png`（档 ②），另有改动前主实例的两张。
- 两个隔离实例用完即撤：进程停掉、端口释放、临时目录与带 token 的启动日志一起删掉。

## 影响

- 代码：`src/client/locales.ts`（两档措辞）、`BalancePopover.tsx`（`PluginsAction` 契约）、`SidebarBalance.tsx`（快照类型与关浮层的位置）、`src/client/index.tsx`（入口快照带落点、两个挂载点）。
- 活文档：根 [README.md](../../README.md) / [README_en.md](../../README_en.md) 的界面表、[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的阶段边界、[sidebar 手册](../../src/client/sidebar/README.md)。
- **本机要看到深链真的生效，先换宿主线**（`npm view @deepseek-ai/dsh dist-tags` 现查；升级要重启进程，重启后旧标签页 token 失效）。在那之前，本机的正确表现就是「打开插件页 ⇒ 列表页」。

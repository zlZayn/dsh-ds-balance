# 配置入口回到 bundle.config，浮层材质与圆环几何对齐官方

**类型**：决策记录（问题 / 决策 / 替代方案 / 影响）。
**取代**：[2026-09-22-settings-seam-migration.md](2026-09-22-settings-seam-migration.md) 的「决策 2」与「决策 3」
（探测目标槽、只注册 `plugins.row.config` 两条）。接缝本身不变 —— 仍然是 `configForms` + volatile 引用。

## 问题

同一天早些时候的设置接缝迁移把配置卡片从 `plugins.bundle.config` 挪到了 `plugins.row.config`，
理由是「bundle 那一格渲染时不带 `form`」。落地的结果是**使用者要多点一次**：
插件列表 → 点插件名进详情页 → **再点那一行右端的 Configure** → 才看到配置。

反馈是直接的：「配置页都在直接页面，不要多点一下」「又不是要多个 components」。

同批还有三条渲染面的反馈：浮层是半透明的但没有磨砂；圆环比左栏所有图标都重；
以及 `src/client/index.tsx` 那条把「缺服务」说轻了的注释。

## 事实（实测，出处给到文件）

- **两个槽都活着，而且两版宿主上都在**：`slot-contract.ts:94` 与 `:102` 各声明一格；
  0.1.6 的 `PluginManagerPage.tsx:470`（bundle）与 `:393`（row）同样都在渲染。
  所以「换个槽名」从来不是版本兼容问题。
- **`plugins.bundle.config` 永远不传 `form`**：`:584` 是
  `renderSlot('plugins.bundle.config', { view: 'page' }, { entryKey: pkg.name })` —— 只有 `view` 与 `entryKey`。
  对照 `:500`（row 槽）与 `:455`（item 槽）都多一个 `form`。**两版宿主在这点上同形**。
- **key 是包名**：`config-ledger.ts:51,66` 的 `keysOf('plugins.bundle.config')` 与
  `PluginManagerPage.tsx:1269` 的 `configured={ledger.bundles.has(openPkg.name)}`。
- **它只渲染 `page`**：`slot-contract.ts` 模块头原话 *Bundle configuration renders only `page`*；
  全仓 `renderSlot('plugins.bundle.config' …)` 只有 `:584` 一处。
- **表单只有一条官方路径**：`ctx.configForms.get(entryId)`，而 `entryId` 是**设置命名空间**
  （`ui-settings/src/client/config-form.ts:289-293` 的 jsdoc `Unique Host plugin entry id`；
  宿主侧 `PluginManagerPage.tsx:1123` 的 `if (!configurations?.some(view => view.ns === id)) return undefined`）。
  本插件那个命名空间 = Loader 条目 id = 包名 = `cordis.patch.yml` 的行 id（三条由 `test/artifacts.test.ts` 对账）。
- **官方为「半透明菜单」立了档也立了门禁**：`ui-theme/docs/web-styling.zh.md`，
  门禁 `ui-theme/tests/elevation-styles.client.spec.ts` 的 `translucentMenusWithoutBackdrop()`。
  官方把菜单材质拆成了两条 token：填充 `--dsw-specific-menu`（变半透明）与
  模糊 `--dsw-menu-backdrop-filter`（新加）。
- **那条门禁只扫官方仓的 `packages/`** —— 插件仓不在覆盖里，这就是本轮浮层没有磨砂的原因。
- **官方左栏图标的量**：`ui-primitives/src/icons/index.tsx:21` 的 `ICON_REGULAR_STROKE = 1`，
  每个 `Icon*Artwork` 都是 `viewBox="0 0 16 16"`；墨迹跨度 12–13.75 units。
- **浮层里有两个非 portal 的 Tooltip 气泡**（`BalancePopover.tsx:162` 的 Plugins 图标、`:211` 的刷新按钮）：
  原语的气泡是 `position: fixed`、`portal` 默认 `false`，所以它们是面板的 DOM 后代却按视口坐标定位。

## 决策

1. **注册回 `plugins.bundle.config`，key = 包名**（`BUNDLE_CONFIG_KEY`）。一个 bundle 一份配置，
   渲染在它自己的详情页里 —— 点插件名进去**就是**配置区。
2. **不两个都注册**：同一张卡片会出现两次，且两处状态可能说不一致的话；也正是「要多个 components」那条反馈。
3. **表单自取，且只此一条读路径**：`apply` 期 `ctx.configForms.get(ENTRY_ID)` 一次，引用稳定，
   卡片与左下角条目共用同一个对象。（座位 props 里那个 `form` 本来就是同一个对象，见宿主
   `manager-store.ts:455` 的 `configForm: id => this.ctx.configForms.get(id)`。）
4. **能力探测改成盯服务，不盯槽名**：`markDeclared()` 移进 `ctx.inject(['configForms'])` 的回调里。
   理由是**结构性**的，不是版本问题（见「替代方案 1」）。
5. **`summary` 档连同文案一起删**：回退后没有任何渲染路径会问它（事实第 4 条）。
   留着就是一个「谁都不敢删、也没人渲染」的死分支 —— 本仓对假信号敏感（`orderPairWrites` 退役那条注释就是先例）。
6. **浮层材质改用隔离背景层**：容器 `.panel` 只留 `isolation: isolate` / 阴影 / 圆角，
   填充与 `backdrop-filter: var(--dsw-menu-backdrop-filter)` 画进 `.panel::before`，
   配方抄同槽邻居的官方 cordis 面板（`packages/extensions/ui-cordis/src/client/CordisPanel.module.css`）。
7. **落成本仓红线**「菜单材质成对」：判据与官方那条**逐条同形**，因为官方门禁扫不到我们。
8. **圆环换成官方图标网格**：`viewBox 16` + 笔画 1，半径走与官方 `ContextMeter` **同一个公式**
   （边长/2 − 圆留白 − 笔画/2）⇒ `r=6.5`、墨迹外径 14、四周各留 1。
   **比勘察稿给的 `r=6` 大半格**：那一版是从「外径 13、四周各留 1.5」反推的，
   而它漏了「墨迹 = 圆 + 笔画/2」这一项 —— 落成红线时被算出来了（见替代方案 8）。
   弧的读法（`strokeDasharray` + `rotate(-90 8 8)`）仍照 `ContextMeter`；叉号笔画与环**同宽**（都是 1）；
   `idle` 档改走官方为它新增的 `--dsw-alias-state-idle-primary`（与官方 `StateDot` 同源）。
9. **`test/redlines.test.ts` 的「已删接缝」表删掉 `plugins.bundle.config`** —— 它从来不是「已删的接缝」，
   上一轮把它误分类了（两个槽在两版宿主上都在）。留下的四个仍成立：
   `settingsScope` / `SettingsScope` / `ctx.settings.register` / `installSection`。
10. **`src/client/index.tsx` 的 inject 注释改成实情**：旧注释说「缺 `configForms` 只丢卡片」，
    而两条注册都在同一个 `inject` 回调里 —— 实际是整个浏览器半边不渲染（左下角条目也要读 `displayCurrency`）。
    **只改注释，不解耦**：把一个不带设置的圆环画出来是产品决策，不在本轮范围。

## 替代方案（试过或想过，为什么不选）

1. **只把探测的槽名换回去**（= 派活书的字面）。**不选**：`plugins.bundle.config` 在两版宿主上都存在、
   且都不传 `form`，所以这一格「在不在」**推不出**「拿不拿得到表单」—— 那是一条恒为真、说不了什么话的探测。
   正确做法是执行那条规则的**意图**（盯住「拿不到 form」这个故障），盯真正会断的那一环：服务。
2. **保留 `row.config`，在浮层里加一句提示引导用户去点**。**不选**：那是把一次点击换成一句解释，
   而这一步本来就是宿主为「一个 bundle 有多行、每行各有配置」设计的，本插件只有一行。
3. **`whileServed` 门禁**（「没有命名空间就不注册」）。**不选**：它是给「编辑另一个插件拥有的命名空间」用的，
   本插件拥有自己的命名空间；而且我们要的是「没有命名空间也把卡片画出来、只是只读」——
   复用既有只读文案（`available` 为假时什么都不渲染），比静默消失好。
4. **给两个 Tooltip 传 `portal` 代替隔离背景层**。**不完整**：只治了已知的两个气泡，
   `.panel` 里将来任何一个 fixed / absolute 后代都会再踩一次；而且 `.bubble[data-portal]` 会把
   z-index 从 100 提到 1100 —— 与面板同级，变成「谁在 DOM 里靠后谁赢」。
5. **把填充留在 `.panel`、只把滤镜放 `::before`**。**不可行**：官方那条门禁是**按规则**过滤的，
   容器那条带 elevation 投影、会被判成材质层，所以**填充与滤镜必须待在同一个规则块里**。
   而容器那个规则块被 Tooltip 的包含块问题堵死，于是两者只能都进伪元素。
6. **圆环方案 B（中心官方状态点）/ C（换成官方 Gauge 字形）**。**不选**：B 的中心点与
   `unavailable` 的叉号抢同一个位置，形状编码与状态编码撞车；C 会让「余额占 warn 阈值多远」
   这个信息在界面上消失（`ringRatioOf` 失去唯一消费者，三条规则条款同时作废）。
   两个都是产品决策，不该由一次样式反馈顺带做掉。
7. **引入 `ConfigForm` 的真类型边**（`import type` 自 `dsh-client-ui-settings/client`）。
   **本轮没动**：本仓已经这么用了（`use-config-form.ts:17`），而工作区那条「两仓对
   `dsh-client-ui-settings` 的依赖类别不一致」是**跨仓取舍**，不在子仓里定。
8. **圆环半径照勘察稿写死 `6`**。**不选**：官方 `ContextMeter` 的关系是
   `RADIUS = 边长/2 − 圆留白 − 笔画/2`（代进它的数：`7 − 0.5 − 1 = 5.5`，与源码一致）。
   照抄「外径 13 / 留 1.5」会得到 `r=6`，而那时墨迹外径是 13、四周实际只留 1 ——
   数没错，但公式与官方不同构，下一个改笔画的人会算错。落成红线（`test/redlines.test.ts` 的
   「圆环几何」）之后这条算术当场露出来，于是改成用同一条公式推。
9. **把 `package.json` 版本留在 `2.0.0-alpha.1`**。**不可行**：那个版本**已经发布在 npm 上**
   （`alpha` dist-tag），不能覆盖；本轮有可观察的界面变化，必须发一个新号。

## 影响

- **入口变短**：插件列表 → 点插件名 → 配置区就在描述下面。那一行上不再有 Configure 控件，
  因此也**没有行子页**（`[data-plugin-row-detail]`）这条路了。
- **两张设置卡片图失效**（`settings-card*.png`：入口 + 版本 tag 都变了）。
  `settings-cards-position*.png` 两张**不用动** —— 它们拍的是 Plugins 列表结构，本轮没碰它。
- **两张侧栏图失效**（`sidebar-popover*.png`：浮层从「半透明无模糊」变成磨砂，圆环也换了几何）。
- **不需要重启宿主**：改动全在浏览器半边（`src/client/**`），profile 用 `link:` 挂绝对路径，
  `npm run build` 出来的 `lib/client.js` 就是宿主读的那一份，HMR 一轮询即换。
  上一轮「重拍要重启一次宿主」是那一轮改宿主半边时的要求。
- **新增一个静默耦合点并落了断言**：槽 key 取包名、`configForms.get()` 取 Loader 条目 id，
  今天同串。漂开的表现分别是「整段配置不出现」与「卡片在、表单永远只读」，**都不报错**。
  断言在 `test/redlines.test.ts`（两条字面量与注册项）与 `test/artifacts.test.ts`（产物里照字面找键）。
- **缺 `configForms` 的表现仍是整个浏览器半边不渲染**（圆环与浮层一起消失），
  因为左下角条目也要读 `displayCurrency`。注释已改成实情；要解耦是产品决策，本轮不做。
- **版本号**：`2.0.0-alpha.2`。定档理由与预发布线怎么算台阶，见 [发布手册](../../docs/PUBLISHING.md)。

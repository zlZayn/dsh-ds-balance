# ds-balance 架构说明

本文件写不变的设计决策、数据流与防错清单；文件级清单归各子目录 `README.md`。

## 项目定位

- 只做 Core：左下角余额显示 + 设置卡片，数据来自 DeepSeek 官方余额接口。
- 设置卡片只做配置，不展示任何额度信息。
- 左下角只显示状态与名称，**金额只在两处出现：展开态悬浮条目时的气泡（官方 `Tooltip` 原语，只报余额那一条的金额）与点击后的浮层**；「今日已用」与「本轮消耗」不做。折叠态不挂气泡 —— 那里沿用原生 `title`。
- **不做 Estimation**（账本 / 投影 / 定价 / 融合估算）—— 第二版。
- mock 仍在，但只是**显式旁路**：URL 参数或 localStorage 明确选过场景才用它。

## 数据流

- 宿主半边分五层，依赖方向单向：`domain`（纯逻辑）← `ports`（类型）← `adapters`（实现）
  ← `services`（应用服务）← `http`（端点）；`index.ts` 只做组装。
- 一次抓取：密钥解析 → 调上游 → 归一化成快照（金额 `bigint` 最小单位）→ 落存储 → 折成视图。
  所有失败都在服务层被吸收成 `state` + `error`，**从不抛给宿主**。
- 端点经 `ctx.connection.fetch` 注册在 `/api/v1/*`；物理载体已做完信任与浏览器鉴权。
- 浏览器半边：取后端响应（或 mock 旁路）→ 映射成视图模型 → 渲染左下角与设置卡片。
- 视图模型只消费后端契约字段，不感知阈值策略。
- 颜色由 `severity` 机械映射，前端不做金额比较。
- **severity → 形态**：颜色编码数值严重度（绿 / 琥珀 / 红），形状编码账户可用性。
  官方 token 里 `error-primary` 与 `error-secondary` 在深色主题下同值，没有第五种色相，
  所以 `unavailable` 用红弧加**中心叉号**与 `critical` 区分。这是维护者拍板的取舍，不要改回红系双色。
- **`selected` 由后端权威**：前端不挑币种，只把设置里的 `displayCurrency` 当查询参数传过去。
- **圆环与左栏图标共用同一套度量**：viewBox 16×16、笔画 1（官方 `ICON_REGULAR_STROKE`），
  半径走与官方 `ContextMeter` **同一个公式**（边长/2 − 圆留白 − 笔画/2）⇒ 墨迹外径 14 落在格里；
  弧的读法（`strokeDasharray` + `rotate(-90 …)`）也照它。四档颜色逐条对齐官方 `StateDot` 的
  `data-state`，`idle` 走官方为它新增的那条 `--dsw-alias-state-idle-primary`。
  几何口径由 [test/redlines.test.ts](../test/redlines.test.ts) 的「圆环几何」一组守住，别在组件里另写一套数。
- **菜单材质必须成对**：凡用 `--dsw-specific-menu` 画填充的表面，必须在**同一条规则**里带
  `backdrop-filter: var(--dsw-menu-backdrop-filter)` —— 官方把菜单材质拆成了这两条 token（填充半透明、
  模糊另起一条），只写前者就是「透光但不磨砂」。
  带 fixed 浮层的表面（本仓的余额浮层里有非 portal 的 Tooltip 气泡）还要把这两句画在**隔离的背景伪元素**
  （`isolation: isolate` + `::before`）上 —— 容器自己带 `backdrop-filter` 会换掉那些浮层的包含块。
  官方那条门禁只扫官方仓，所以本仓自己有一条同形的红线。
- **弧长是唯一读阈值的去处，且只读 `warn`**：弧长 = 余额 / 该币种 `warn` 阈值，封顶 1，金额比较走整数不走浮点。
  阈值没配或非正数时退回按 `severity` 定性：`ok` 与 `unavailable` 满环、`warn` 3/4、`critical` 1/4、`unknown` 空环。
  判据只有 [../src/client/model.ts](../src/client/model.ts) 的 `ringRatioOf` 一处 —— 别在组件里再算一遍。

## 关键决策

- 左下角落点 = `sidebar.footer.action`；折叠 / 展开由该槽的 `wide` prop 决定，不自行探测宽度。
- 配置卡片落点 = `plugins.bundle.config`，**key 逐字就是包名** —— 一个 bundle 一份配置，渲染在它自己的详情页里
  （描述与「包含的组件」之间），于是从插件列表点插件名进去**就是**配置区，不多一次 Configure。
  **这个落点往返过一次**（bundle 槽 → 行槽 → bundle 槽），两次都不是版本问题：行槽的唯一增量是那次点击，
  而 bundle 槽的座位 props **永远不带 `form`**（宿主两条线上同形，`PluginManagerPage.tsx:584`），
  表单只能自己取。两件事都能满足之后，槽的选择就是纯 UX —— 取「直接页面」。
  **卡片的视图档只剩 `page`**：宿主 `slot-contract.ts` 明写 *Bundle configuration renders only `page`*，
  `summary` 只出现在行槽（行缺描述时的回退）。所以那一档连同它的文案一起删了 ——
  本仓对假信号敏感，不留「谁都不敢删、也没人渲染」的死分支。
- **设置命名空间 = 本插件那一行的 Loader 条目 id**（`dsh-ds-balance`）。宿主半边的 `ctx.settings.mutate` 与
  浏览器半边的 `ctx.configForms.get` 都按它索引。
  **它与 `plugins.bundle.config` 的 key（包名）今天同串，但不是一个概念** —— 这是本轮引入的静默耦合点：
  槽 key 写成别的，整段配置不出现；`get()` 传错，卡片在、表单永远只读。两者都不报错，靠红线对账。
  它也与左下角条目的 slot id（`ds-balance`，纯 UI 身份）**是两个不同的值**，别合并成一个常量。

  **`dsh-` 串的三层（本仓的命名耦合地图）**：

  | 层 | 字符串 | 谁定的 | 单真源 |
  | :--- | :--- | :--- | :--- |
  | 宿主强制 = 包名 | `package.json.name` / `cordis.patch.yml` 的 `name` / 槽 key `BUNDLE_CONFIG_KEY` / 信封 `BUNDLE_ID` | 宿主按包名索引 | `package.json`（构建脚本读它；测试断言字面量 = `pkg.name`） |
  | 自选同串 | 设置命名空间 = `ENTRY_ID` = patch 行 `id` | 我们选的约定 | **独立手写字面量**（两半各一份，红线对账 + 钉「今天 = 包名」） |
  | 故意不同 | `SIDEBAR_ENTRY_ID`（`ds-balance`） | 纯 UI 身份 | 独立手写字面量 |

  改名时：第一层跟着 `package.json` 走（构建自动）；第二层要**手动**改两处字面量并迁移用户设置（旧命名空间的值不会自动搬）；第三层与配置无关。
- **配置值活在引用里，不活在 `apply` 的参数里**：11 个字段全是 `.volatile()`，`apply` 收到 `Volatile` 引用面，
  读值一律 `ref.get()`。收益是改配置**永不重挂** —— Loader 只把新值提交进引用并发一次 `loader/volatile-update`；
  代价是没有 setter，写回必须走宿主的设置域。
- 卡片外壳照原生 `PluginConfigForm`：**无外框**（控件直接铺在 bundle 详情页里，不是卡中卡）、标题由页面画，卡内没有折叠头、也没有「放弃」控件 —— 只有保存才写，草稿随 unmount 丢弃。
- 样式只用 CSS Modules + `--dsw-alias-*` 语义 token；禁 Tailwind、禁组件库、禁字面色值。
- 主题由 `body[data-ds-dark-theme]` 承载，插件直接读 CSS 变量，不写主题选择器。
- 构建 = `tsc` + `tsc -p tsconfig.client.json` + 自研 esbuild 打包（复刻 `window.__ModuleLoader__.load` 信封）。
- `sidebar.footer.action` 的宿主容器缺 `flex-direction`，插件侧用 `:has()` 反选父元素补成纵向堆叠；这是唯一一处插件覆盖宿主布局的地方。
- 依赖锚点跟随宿主运行的 alpha 线。
- **配置表单只做能力探测，不查宿主版本号**：客户端半边拿不到宿主版本，而「卡片拿不拿得到 form」当场可观测。
  更早的宿主没有配置服务、这个 profile 里没装 Plugins 页 —— 两种情形对使用者是同一个现象，探测把它们归成一句话。
  **探测盯的是 `configForms` 服务，不是槽名**（本轮定案，推翻上一轮）：`plugins.bundle.config` 在宿主两条线上
  都在座、且两版渲染它都不传 `form`，所以「槽在不在」与「拿不拿得到表单」**结构性无关** ——
  盯槽名就是一条恒为真、说不了什么话的探测。真正的判据是嵌套 `ctx.inject(['configForms'])` 在窗口内
  有没有回调（回调里报 available），注册照旧交给 `ctx.slots.inject`。
  三态**可逆**：服务晚到会把提示撤掉，不会留下误报。探测失败不中断圆环、浮层与后端。
  它答不了的那一半（宿主服务不服务我们的命名空间）由卡片自己看快照的 `status`：不是 `ready` 就什么都不渲染。
  **缺 `configForms` 的实际表现是整个浏览器半边不渲染**（圆环与浮层一起消失，不是只丢卡片）：左下角条目
  也要读 `displayCurrency`，那条路同样走这个服务。要解耦是产品决策，不在本轮范围。
- 设置卡片分四组、各自可折叠，顺序是 连接 → 展示 → 阈值 → 刷新（按使用频率排）；宿主 `Config` 的字段顺序是 连接 → 刷新 → 展示 → 阈值（按任务书排）。**两者有意不同，不要改成一样。**
- 四组默认**全部收起**，各自可展开（进页面先看到四个组名，要哪组点哪组）；组内有非法草稿时该组**强制展开**（`groupOpenNow`）—— 非法会禁用保存，收起的组会让 footer 的「请检查标红的字段」指向看不见的地方。
- 凭据行在标签行右侧只带两态胶囊：已配置密钥。/ 未配置密钥。（官方 `ui-settings-plugins` 原文）；
  四档判据（覆盖 > 环境 > 配没配）仍在 `credentialViewOf` 里，但它只影响二级折叠字段的状态，不再影响徽章。
- 「显示币种」是整行左右布局（左文字 + 右选择器胶囊），不是上下结构。
- **连接组照搬官方「模型」卡片的两段式**：外面是只读的凭据状态（常态空输入框 + 标签行右侧的状态徽章 + 它下方那行说明）
  与可编辑的 Base URL；二级「自定义设置」折叠里只有凭据引用名 `apiKeyRef`（默认收起）。
  **卡片不提供填 API Key 的入口**：界面上唯一的 Key 框是那个继承官方、只读的（官方「网页搜索」卡片同款）。
  **框内不写占位符** —— 灰字写在框里读起来像「这里该填但没填」，状态改由徽章与它下方那行说明承担。
  官方那两条同义措辞属于 `settings.models` 命名空间、别的插件拿不到，所以文案自备。
- **阈值改动立刻反映到界面**：设置快照变化 → 前端按**配置指纹**重问一次 `/api/v1/balance`；
  后端从缓存快照按新阈值重算 severity，**不打上游**。宿主侧只有取数节奏相关字段变化才重排调度。
- **阈值成对约束：同一币种内 `critical` 必须严格低于 `warn`。** 相等也拒绝 —— 压线时「预警」这一档等于不存在。
- **这条约束宿主侧已经拦不住**，现在只有两道，且都不在 schema 上：
  ①**消费侧守卫** —— 每次现读时把违规的那一对回落成默认值，并记一次 warn（不抛：一次手改配置文件写错，
  惩罚不该是全部功能消失；也不能不判：那会产生「预警档不存在」的静默错误）。
  ②**我们自己的写路径** —— `POST /api/v1/config` 在 mutate 之前先跑同一个判据，违反回 `422` 且什么都不写。
  **官方 Plugins 页那条写路径拦不住**：它是宿主直连的原子 mutate，只跑 schema。前端置灰保存只管体验。
- **保存是一次原子提交**：全部草稿折成一组 path 操作交给 `form.mutate(ops, revision)`，
  共享一道修订栅栏、一次宿主校验、一次落盘决定 ⇒ **不存在中间态**。历史上那条「成对写入必须排序」
  随逐字段写入一起退役（`orderPairWrites` 已删），不要加回来。
- 金额在进程内一律 `bigint` 最小单位，只在序列化时变成八位小数字符串；**截断，不四舍五入**。
- 配置用 schemastery，存储记录 schema 用 zod —— 两套 schema 各管一段，不混用。
- 可选服务（`connection` / `storageDomain`）**不进顶层 `inject`**：缺它只该丢掉那一半功能，
  由 `ctx.inject` 单独把门并留降级路径。
- 落盘失败**不算抓取失败**：快照留在内存里，界面照常，代价只是重启后不恢复。
- 密码学派生：`accountTag = HMAC-SHA256(serverSalt, apiKey)` 前 32 hex，只作账本作用域，
  日志里只记前 8 位。凭据轮换即换账本，旧快照视为不存在。

## 契约

`GET /api/v1/balance` 响应形状（后端实现，mock 场景与之同形）：

- `state`：`empty` / `ok` / `stale` / `error`
- `severity`：`ok` / `warn` / `critical` / `unavailable` / `unknown`
- `balances[]`：金额是字符串，可能多币种，数组顺序可能跳变
- `todayUsage`：可为 `null`；`source` 为 `blended` / `balance-observed` / `projection`

**余额端点的状态码始终 `200`**，业务错误走 `state` + `error` —— 前端要拿到 `error` 结构才能分支。

完整字段清单、`severity` 映射表、币种回落规则、配置契约与后端移交说明 → [UI 侧契约与移交](ui-handoff.md)。
端点表、通道选择与请求体约定 → [后端架构](backend-architecture.md) 的 §8。

### 插件展示元数据（宿主直读，不进我们的代码）

插件页上的标题与描述来自**包内**的 `locale/en.json` / `locale/zh.json`，图标来自包根的 `icon.svg`（`package.json` 的 `icon` 指过去）；
宿主按包名解析它们（经 Node 的子路径导出读），而**两半体一个字节都不读** —— 它们不进 `lib/`，也不参与渲染。
推论有三条：

- 想改插件页上那个名字或那句话，**只有那两份 JSON 一处可改**：我们这边没有可加逻辑的地方。
- 坏了**没有信号**：字段缺失逐字段回落成包名与 `package.json` 的 `description`，字段非法或文件读不到则
  整包元数据降级成一条诊断 —— 界面照常渲染。守它的是断言而不是注意力，见 [locale 规则层](../locale/AGENTS.md)。
- **同一件事只有一个 home**：本插件自己界面的文案在 [../src/client/locales.ts](../src/client/locales.ts)
  （运行时词典，经 `ctx.locale` 注册），与那两份 JSON 不是一回事，别互相抄。

## 防错清单

- 金额一律按字符串处理，禁止用浮点数做相等比较或累加。
- 多币种时不得依赖数组顺序，按 `currency` 取值。
- `state` 与 `severity` 是两个独立维度，不得互相推导。
- 折叠态与展开态都必须能吃下所有 `severity`，未知值回落 `unknown`。
- 组件拿不到 `ctx`；数据只能走注册项的 `inject` 工厂。
- 跨插件值导入会被 bundle-purity gate 拒绝，只能用公共导出。
- **不许把 `backdrop-filter` 写在带 fixed 浮层的容器上**：它会成为那些后代的包含块，把按视口算好的坐标变成
  相对容器的偏移。本仓的余额浮层里有两个非 portal 的 Tooltip 气泡，踩中就是气泡跑到屏幕外。
- **包根 `icon.svg` 必须是良构 XML**：宿主只把字节编成 data URL 交给浏览器当图片解析，解析失败的表现是
  **静默回落成默认图形**。最容易踩的一条是 XML 规范不许注释里出现连续两个连字符（写 CSS 变量名时尤其容易）——
  第一版就这么坏过，红线「插件图标」的良构检查现在守着它。
- `lib/client.js` 路径被浏览器信封占用，`src/client.ts` 会造成宿主启动崩溃。
- 侧栏底部的按钮**不得**写 `aria-haspopup`：已装邻居用它做 DOM 遍历来找设置触发按钮，会先命中我们。
- 浮层在关闭态**不得**留下可命中区域；向上展开时盖住上邻是既定取舍，不许靠改定位去「顺便修好」。
- **handler 内部异常不得外抛**：抛出去会被宿主包成 `500`，前端拿不到 `error` 结构。
- 凭据**不得**出现在日志、异常消息或任何响应体里；配置接口只回固定长度的掩码串。
- **端点基址留空表示官方默认**（界面照官方卡片默认留空）：空串只在 [../src/config.ts](../src/config.ts) 的 `endpointOf` 翻译一次，抓取与测连接都走它，不许各自判空。
- 读服务必须显式 `inject`；直接访问会抛错，而降级路径会把这条配置错误伪装成运行时故障。
- **客户端读宿主新增字段一律加防御**：客户端半边由 HMR 立刻换新，宿主半边要重启才换，
  新客户端会读到旧宿主的响应。形状守卫 + 可选链，缺失就退化成保守默认，不许让组件崩掉。

## 阶段边界

- 不做：Estimation（账本 / 投影 / 手工校正）、诊断层、独立页面、图表、多厂商模板、SSE。
- **不做（宿主还没给这条缝）**：到某个 bundle 详情页的深链。浮层右上角图标只落在 Plugins 面板（列表页）—— 宿主没有公开的面板深链入口，等它给出（`selectPanel` 带参数或 `openBundle(name)` 一类的客户端服务）再补深；不在插件侧另造页面。现状与证据 → [../src/client/sidebar/README.md](../src/client/sidebar/README.md)。
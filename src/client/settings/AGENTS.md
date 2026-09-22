# settings/ — 规则层

继承根规则，见 [../../../AGENTS.md](../../../AGENTS.md)（仓库根）；直接上层是 [../AGENTS.md](../AGENTS.md)（src/client 规则层）。

settings/ 特有约束：

- 卡片**只做配置**：不许出现任何额度信息、金额、图表、快照列表或估算明细。
- 数值一律按字符串处理；阈值**只存不判**，界面不得依据阈值给任何东西上色 —— 颜色只由后端 `severity` 决定。
  - 唯一的读阈值处是圆环弧长（`../model.ts` 的 `ringRatioOf`），且只读 `warn`。
- 不许 import 官方 `ui-settings-plugins` 的内部构件（bundle-purity gate 会拒），只能照抄模式。
- 数字字段用 `type="text"` + `inputMode="numeric"`，不用 `type="number"`（[fields.tsx](fields.tsx) 的 `TextControl`）。
- 新增字段必须同时改宿主 schema（[src/config.ts](../../config.ts) 的 `Config`）与 `CONFIG_FIELDS`（[use-config-form.ts](use-config-form.ts)），否则两半漂移。
- **跨字段约束宿主侧已经拦不住**：登记用的 `ctx.settings.register` 连同它的 `validate` 选项一起被删，
  schemastery 也没有 refine 这类跨字段钩子，而官方文档承诺的 `.check()` 在实现里根本不存在。
  现在只剩两处：**消费侧** `../../config.ts` 的 `resolveThresholdPairs`（违规即回落默认值 + 一次 warn），
  与**我们自己的写路径**（`POST /api/v1/config` 在 mutate 之前先跑 `validateThresholds`，违反回 422）。
  前端这道只管体验（失焦提示 + 置灰保存），**判据不许另抄一份** —— 只有 [use-config-form.ts](use-config-form.ts) 的 `thresholdsOk`。
- **保存是原子的，所以没有写入顺序这回事**：一次 `form.mutate(ops, revision)` 提交全部草稿，
  共享一道修订栅栏与一次宿主校验。历史上那条「成对写入必须排序」（`orderPairWrites`）随逐字段写入一起退役，
  **不要再把它加回来** —— 它现在只会给出「这个约束还在被强制执行」的假信号。
- 纵向间距只有两个所有者：`.group` 的顶部 12px 与 `.groupLast` 的尾部 12px（[fields.module.css](fields.module.css)）；新加元素不许在旁边叠 margin。
- 分组折叠头一律用原语 `DisclosureRow`，不自己画（[fields.tsx](fields.tsx) 的 `FieldGroup`）。
  - **例外**：连接组里的二级「自定义设置」用原生 `<details>`（[fields.tsx](fields.tsx) 的 `DetailsGroup`），因为官方 `ProviderEditor` 那一处就是这么做的；本插件照搬官方形态优先于自定规则。
- 凭据字段的只读形态照官方「网页搜索」卡片：**常态空框（只 `readOnly`，不 `disabled`、不降透明度）**，**不隐藏字段、不另做只读块、框内不写占位符**。
  **它与静态文本的唯一差别只剩「它在 DOM 里是个 input」**：悬停、指针、焦点、打字全不响应（`pointer-events: none` + 固定描边），改它之前先想清楚「为什么这一格要看起来能编辑」。
  状态走标签行右侧的徽章（`settings.credential.*`，**只有「已配置密钥。/ 未配置密钥。」两态**，与官方一致），说明走它下方那行（`settings.hint.credential`，一句与状态无关的常量）。
  **措辞逐字抄官方**：徽章取自 `ui-settings-plugins` 的 `webSearchApiKeySet` / `webSearchApiKeyUnset`，说明取自 `webSearchApiKeyHint`，标签取自 `webSearchApiKey` / `webSearchBaseUrl` —— 官方那套词在 `settings.models` / `settings.plugins` 命名空间、别的插件拿不到，所以抄进 [../locales.ts](../locales.ts)。
- **端点基址默认留空**：界面显示空串（官方卡片同款），填空即覆盖、留空即官方默认；空串到官方地址的翻译只有 [../../config.ts](../../config.ts) 的 `endpointOf` 一处。
- 只读凭据行的四档只有一个判据：[use-credential-state.ts](use-credential-state.ts) 的 `credentialViewOf`（覆盖 > 环境 > 配没配）。**不许在组件里另写一份分支。**
- **读宿主新增字段必须先过形状守卫**：客户端半边由 HMR 立刻换新，宿主半边要重启才换。见 [../data.ts](../data.ts) 的 `readCredential` 与 [use-credential-state.ts](use-credential-state.ts)。
- 错误文本用 `var(--dsw-alias-state-error-primary)`；官方 `--dsw-alias-label-error` 从未定义，照抄会静默失效。
- 选择器触发 pill 没有公共组件，取值照抄 `packages/client/locale/src/client/LanguageRow.module.css:28-51`。
- `set` / `unset` / `mutate` 的返回值不许丢弃：它就是**宿主是否接受**（`Promise<boolean>`），
  判成败只能用它 —— 不要再去读回 `user` 层猜（那条路已经删了）。
- **`available` 为假时卡片什么都不渲染**：宿主没在服务这个命名空间时，空控件比不渲染更坏。
- 组件拿不到 `ctx`：数据只能走 props，或用注册项的 `inject` 工厂（见 [../index.tsx](../index.tsx)）。
- 文案一律走词典，键集真源是 [../locales.ts](../locales.ts)；组件里不写死字符串。
- **字段说明只回答「为什么关心」**：一句、一行，不重复标签和分组说明已经说过的信息（[../locales.ts](../locales.ts) 的 `settings.hint.*`）。空话（「请填写兼容的地址」）不算说明。
- 相对导入保留 `.ts` / `.tsx` 后缀。

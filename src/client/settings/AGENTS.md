# src/client/settings/ — 规则层

继承根规则，见 [../../../AGENTS.md](../../../AGENTS.md)（仓库根）；直接上层是 [../AGENTS.md](../AGENTS.md)（src/client 规则层）。

settings/ 特有约束：

- 卡片**只做配置**：不许出现任何额度信息、金额、图表、快照列表或估算明细。
- 数值一律按字符串处理；阈值**只存不判**，界面不得依据阈值给任何东西上色 —— 颜色只由后端 `severity` 决定。
  - 唯一的读阈值处是圆环弧长（`../model.ts` 的 `ringRatioOf`），且只读 `warn`。
- 不许 import 官方 `ui-settings-plugins` 的内部构件（bundle-purity gate 会拒），只能照抄模式。
- 数字字段用 `type="text"` + `inputMode="numeric"`，不用 `type="number"`（[fields.tsx](fields.tsx) 的 `TextControl`）。
- 新增字段必须同时改宿主 schema（[src/config.ts](../../config.ts) 的 `Config`）与 `CONFIG_FIELDS`（[use-config-form.ts](use-config-form.ts)），否则两半漂移。
- **跨字段约束要两半各写一道**：宿主挂在 `ctx.settings.register` 的 `validate` 上（schemastery 没有跨字段钩子），前端负责体验。
  前端那道不许另抄一份判断 —— 判据只有 [use-config-form.ts](use-config-form.ts) 的 `thresholdsOk`。
- **加跨字段约束时必须一并处理写入顺序**：宿主在**合并后的完整值**上校验，而一次保存是逐字段写的，
  单字段写入会让中间态短暂非法。排序在 [use-config-form.ts](use-config-form.ts) 的 `orderPairWrites`。
- 纵向间距只有两个所有者：`.group` 的顶部 12px 与 `.groupLast` 的尾部 12px（[fields.module.css](fields.module.css)）；新加元素不许在旁边叠 margin。
- 分组折叠头一律用原语 `DisclosureRow`，不自己画（[fields.tsx](fields.tsx) 的 `FieldGroup`）。
  - **例外**：连接组里的二级「自定义设置」用原生 `<details>`（[fields.tsx](fields.tsx) 的 `DetailsGroup`），因为官方 `ProviderEditor` 那一处就是这么做的；本插件照搬官方形态优先于自定规则。
- 凭据字段的只读形态照搬官方：`disabled` + 60% 透明度，**不隐藏字段、不另做只读块、框内不写占位符**。
  状态走标签行右侧的徽章，因由走它下方那行说明；两处的键分别是 `settings.credential.*` 与 `settings.hint.credential.*`（[../locales.ts](../locales.ts)）。
  官方那两条同义措辞属于 `settings.models` 命名空间、别的插件拿不到，所以文案自备。
- 只读凭据行的四档只有一个判据：[use-credential-state.ts](use-credential-state.ts) 的 `credentialViewOf`（覆盖 > 环境 > 配没配）。**不许在组件里另写一份分支。**
- **读宿主新增字段必须先过形状守卫**：客户端半边由 HMR 立刻换新，宿主半边要重启才换。见 [../data.ts](../data.ts) 的 `readCredential` 与 [use-credential-state.ts](use-credential-state.ts)。
- 错误文本用 `var(--dsw-alias-state-error-primary)`；官方 `--dsw-alias-label-error` 从未定义，照抄会静默失效。
- 选择器触发 pill 没有公共组件，取值照抄 `packages/client/locale/src/client/LanguageRow.module.css:28-51`。
- `set` / `unset` 的返回值不许丢弃：宿主拒绝写入时不抛错，成败只能靠读回快照的 `user` 层判定（[use-config-form.ts](use-config-form.ts) 的 `landedWrite`）。
- 组件拿不到 `ctx`：数据只能走 props，或用注册项的 `inject` 工厂（见 [../index.tsx](../index.tsx)）。
- 文案一律走词典，键集真源是 [../locales.ts](../locales.ts)；组件里不写死字符串。
- **字段说明只回答「为什么关心」**：一句、一行，不重复标签和分组说明已经说过的信息（[../locales.ts](../locales.ts) 的 `settings.hint.*`）。空话（「请填写兼容的地址」）不算说明。
- 相对导入保留 `.ts` / `.tsx` 后缀。

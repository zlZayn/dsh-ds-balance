# src/client/settings/ — 规则层

继承根规则，见 [../../../AGENTS.md](../../../AGENTS.md)（仓库根）；直接上层是 [../AGENTS.md](../AGENTS.md)（src/client 规则层）。

settings/ 特有约束：

- 卡片**只做配置**：不许出现任何额度信息、金额、图表、快照列表或估算明细。
- 数值一律按字符串处理；阈值**只存不判**，界面不得依据阈值给任何东西上色 —— 颜色只由后端 `severity` 决定。
- 不许 import 官方 `ui-settings-plugins` 的内部构件（bundle-purity gate 会拒），只能照抄模式。
- 数字字段用 `type="text"` + `inputMode="numeric"`，不用 `type="number"`（[fields.tsx](fields.tsx) 的 `TextControl`）。
- 新增字段必须同时改宿主 schema（[src/index.ts](../../index.ts) 的 `Config`）与 `CONFIG_FIELDS`（[use-config-form.ts](use-config-form.ts)），否则两半漂移。
- 纵向间距只有两个所有者：`.group` 的顶部 12px 与 `.groupLast` 的尾部 12px（[fields.module.css](fields.module.css)）；新加元素不许在旁边叠 margin。
- 分组折叠头一律用原语 `DisclosureRow`，不自己画（[fields.tsx](fields.tsx) 的 `FieldGroup`）。
- 错误文本用 `var(--dsw-alias-state-error-primary)`；官方 `--dsw-alias-label-error` 从未定义，照抄会静默失效。
- 选择器触发 pill 没有公共组件，取值照抄 `packages/client/locale/src/client/LanguageRow.module.css:28-51`。
- `set` / `unset` 的返回值不许丢弃：宿主拒绝写入时不抛错，成败只能靠读回快照的 `user` 层判定（[use-config-form.ts](use-config-form.ts) 的 `landedWrite`）。
- 组件拿不到 `ctx`：数据只能走 props，或用注册项的 `inject` 工厂（见 [../index.tsx](../index.tsx)）。
- 文案一律走词典，键集真源是 [../locales.ts](../locales.ts)；组件里不写死字符串。
- 相对导入保留 `.ts` / `.tsx` 后缀。

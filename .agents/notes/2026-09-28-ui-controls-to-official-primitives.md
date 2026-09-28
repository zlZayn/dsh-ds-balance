# 决策：设置卡片的自绘控件换官方 primitives

状态：生效
日期：2026-09-28

## 问题

审计（根工作区 `ui-primitives-audit.md`）确认：本仓设置卡片的 5 处自绘控件是 0.1.6 时代
官方卡片形态的复刻 —— `TextControl` / `ReadOnlyControl` 的手写 `<input>`、`ActionRow` 与
footer 保存按钮的手写 `<button>`、`DetailsGroup` 的原生 `<details>/<summary>` 加手绘 5px 折角。
2026-09-20 声明下限对齐到 `>=0.1.7-alpha.1`（见
[2026-09-20-declaration-floor-alignment.md](2026-09-20-declaration-floor-alignment.md)）之后，
官方 `@deepseek-ai/dsh-client-ui-primitives` 已导出 `Input` / `Button` / `DisclosureRow`，
自绘的理由（「官方没有，只能抄几何」）不再成立。

## 决策

- `TextControl`（baseUrl + 7 个数字框）→ 官方 `Input`：`id` / `value` / `disabled` / `onChange` /
  `inputMode` / `aria-invalid` 全部原生透传；非法红框改为后代选择器打在官方外壳上
  （官方 Input 的 `className` 落在外壳 span，不进内框）。
- `ReadOnlyControl`（apiKey 空框）→ 官方 `Input readOnly`：「静态文本框」的刻意设计保留
  （外壳 `pointer-events: none`，内框描边 / 背景兜底用后代选择器）。
- `ActionRow`（测试连接）→ `Button variant="outline"`；footer 保存 → `Button variant="primary"`。
- `DetailsGroup`（「自定义设置」二级折叠）→ 受控 `DisclosureRow`（`icon={null}`、整行可点），
  手绘折角与 `::before` 规则随之下线。
- 删掉随之失效的 CSS 死样式：`.input` / `.inputInvalid` / `.inputStatic` / `.detailsSummary` /
  `.actionButton` / `.save`，约 140 行。
- **红线纪律**：不动 `dsh.client.inject`、不动 `engines.dsh`、不动任何 `@deepseek-ai/dsh-*`
  依赖范围；SelectorControl 的 pill 触发器、币种整行选择、侧边栏 / Popover / PercentRing 全部未动。

## 替代方案

- **保留原生 details，只补官方折角几何**：不换组件，只对齐尺寸 —— 仍然自绘，不解决「自绘的理由已消失」。
- **换 settings-form 行组件（SettingsValueField 等）**：语义更专，但会重构字段行结构，超出
  本次「直通转发」范围，留待后续。
- **SelectorControl 的 pill 触发器**：官方没有「整行选择 pill」对应导出，按审计结论维持现状，不改。

## 影响

- 用户可见：输入框 / 两个按钮 / 二级折叠的外观对齐官方原语（测试连接 = outline 胶囊、
  保存 = primary 胶囊、二级折叠 = DisclosureRow chevron 行）。视觉已在本地人工过目通过。
- 兼容：`engines.dsh` 不变；所用 `Input` / `Button` / `DisclosureRow` 在 0.1.7-alpha.1（本仓下限）
  即全部存在，无兼容影响。
- 验证：`npm run build` 通过；`npm test` 355/355 通过；`npx vitest run test/redlines.test.ts`
  44/44 通过。
- 发布：2.1.1 → 2.1.2（patch，档位判定见 docs/PUBLISHING.md 的问题链）。
- **settings-card 截图待补**：README 的设置卡片截图需在 bump 后重拍，本轮未拍。
- **跨仓**：与 `dsh-zhihu-search` 2026-09-28 同款改造同批（zhihu 已发 2.0.1）；
  `dsh-workbuddy-bridge` 候选改动暂缓。

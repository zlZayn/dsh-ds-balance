# 币种收敛成单一真相源（浮层「改用 X」写回设置）

## 问题

浮层的「改用 X」与设置卡片各写一份币种：`SidebarBalance.tsx` 存了一份 `localCurrency` 本地态，
`preference = localCurrency ?? config.displayCurrency`；设置卡片走的是 `ds-balance` 设置作用域的
`displayCurrency`。后果三条，都是活宿主上实测到的：

- 设置里选 USD → 浮层点「改用 CNY」→ 设置页那一格仍是 USD，两个界面各说各话；
- 本地那份覆盖只活在组件挂载期里，HMR 或槽重注册就没了 —— 表现成「有时候记得住、有时候记不住」；
- 「去设置」那条动作因此无法自证：用户回到设置页看到的不是刚才选的那个币种。

## 决策

币种只有一个真相源：设置作用域的 `displayCurrency`。

- `SidebarBalance.tsx` 删掉 `localCurrency`，`preference` 直接等于 `config.displayCurrency`；
  「改用 X」的语义不变（X 仍是后端实际给的那个币种），改走 prop `onSelectCurrency(currency)`。
- 写路径只有一条：`index.tsx` 的座位组件调 `settings/use-config-form.ts` 的
  `writeFieldValue(scope, 'displayCurrency', code)` —— 与设置卡片共用同一个字段、同一份落盘判据
  （`landedWrite`：从读回快照的 `user` 层看这次写入在不在）。
- 不做乐观更新：界面只跟设置快照走。没落盘就什么都不变，浮层那条提示留着让用户重试。
- 不可写（`writable === false`）时浮层的「改用 X」disabled —— config 切片带上 `writable`。

## 替代方案

- **本地态 + 同时写设置**：两个真相源还在。写入被宿主拒绝时界面已经显示新币种，与设置页再次分叉。
- **本地态 + 卸载时回写设置**：分叉窗口一模一样，还把一次写入挂到没人为它负责的生命周期边上。
- **`scope.set` 调完不看结果**：宿主拒绝写入时不抛错，只让快照保持不变 —— 不看读回就等于「假装成功」。
- **不可写时给 no-op 处理器**：按钮看着能点、点了没反应，比 disabled 更容易被当成 bug。

## 影响

- 推翻 [ui-handoff.md](../../docs/ui-handoff.md) §五 的旧口径（「设置页保留用户的选择，不自动改」+ 浮层只改本地）；
  那份文档的同步由 Lead 统一做，不在本条内。
- `writeFieldValue` 成为跨两半的写入口：设置卡片与侧栏条目都从它落盘，判据只有 `landedWrite` 一份。
- 落盘判定的三条路（成功 / 宿主静默拒绝 / `set` 返回 Promise）在
  [threshold-pairs.test.ts](../../test/threshold-pairs.test.ts) 有断言。

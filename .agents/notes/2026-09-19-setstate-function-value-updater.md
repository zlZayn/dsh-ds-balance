# setState 收到函数值：状态是回调时必须走 updater 形式

## 问题

浮层右上角「切到 Plugins 页」的图标在实机上不渲染。逐段探针把嫌疑一个个排除掉之后，
链路只剩最后一跳：

- 产物是新的、`apply` 跑到结尾；
- `ctx.inject(['layout'], cb)` 的门**开了**（回调确实执行）；
- `layoutCtx.layout` 取得到（`prop=object`，`selectPanel=function`）—— 属性代理不背这个锅；
- `pluginsNavigation.attach(...)` 成功，句柄里确实有回调（`snapshot=function`）；
- 座位每次渲染都读到 `nav=function`；
- 但浮层渲染时 `onOpenPlugins=undefined`，标题行只剩那个 `<a>`。

## 根因

[SidebarBalance.tsx](../../src/client/sidebar/SidebarBalance.tsx) 的 `usePluginsNavigation` 用
**非 updater 形式**写回一个「值本身就是函数」的状态：

```ts
setOpenPlugins(navigation.getSnapshot())   // 快照值是一个 () => void 回调
```

React 的 setter 见到函数就当成**更新器**：用上一个状态调用它，并把它**返回值**当成新状态。
回调的返回值是 `undefined`，于是状态恒为 `undefined`，图标永远不渲染。
顺带一提，同一个调用会把回调体当副作用在更新期执行 —— 也就是 `selectPanel('plugins')` 会被
凭空调一次（实机上被应用自身初始化盖回去，没表现成跳页）。

## 决策

状态值是函数时，一律走 updater 形式：

```ts
setOpenPlugins(() => navigation.getSnapshot())
```

惰性初值 `useState(() => navigation?.getSnapshot())` 本来就是 initializer，写法正确；
两者语义不同，注释里点明，免得下一个人「化简」回去。

## 替代方案

- **换成 `ctx.get('layout')`**（当时的头号嫌疑）：实机探针证明属性代理取得到服务，
  另外用最小 cordis 4.0.2 复现（`reflect.provide` + 嵌套 `ctx.inject` + 插件级 `inject`）
  三条路径全通，与宿主那篇 ACP postmortem 的场景不同 —— 换了也不解决问题。
- **把快照换成非函数值**（布尔 + 稳定回调）：能从结构上躲开这个坑，但要改跨文件接口
  （`PluginsNavigation` 声明在 SidebarBalance、实现在 [index.tsx](../../src/client/index.tsx)），
  超出这次缺陷的范围，留作可选加固。
- **在生产者侧让回调「被当更新器调用时返回自己」**：能凑合渲染出来，但会把 `selectPanel`
  变成更新期的副作用，靠 React 内部调用时机吃饭 —— 不采用。

## 影响

- 图标恢复：实机四项 = 按钮数 1、`aria-label` 为「Open the Plugins page」、点击后浮层关闭、
  主区切到 Plugins 页，且无 `[WARN]`。
- 全仓同类审计：`setXxx(...getSnapshot())` 共 6 处，另外 5 处的快照值是对象 / 布尔 / 字符串
  （[index.tsx](../../src/client/index.tsx) 的 `useScopeValue` / `useScopeWritable`、
  [config-slot.ts](../../src/client/config-slot.ts) 的状态、同一 hook 里的常量），
  只有这一处是函数值。

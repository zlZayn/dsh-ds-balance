# src/client/ — 浏览器半边手册

- 职责：注册两个 slot（左下角条目、设置卡片）与中英词典；所有界面都在这里。
- 变更影响路由：改这里的对外行为 → 同步根 [README.md](../../README.md) 与 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)；改完必须 `npm run build`，产物由 `dsh-client-hmr` 自动替换。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。

## 文件

- `index.tsx`：入口。注册词典、把宿主返回的 settings 作用域包成卡片依赖的最小面、向两个 slot 注册组件。`inject` 是运行时门禁，删任何一项都会让 `apply` 静默不跑。
- `locales.ts`：中英词典。`zh` 是键集真源，`en` 用 `Record<LocaleKey, string>` 做编译期完整性检查。同时把命名空间并进 `LocaleNamespaceMap`。
- `model.ts`：纯函数视图模型。`severity` → 状态点、金额字符串格式化、币种回落选择、圆环比例、相对时间分档。**没有 React，没有阈值判断。**
- `api-types.ts`：后端契约类型。本阶段只用来约束 mock。
- `css-modules.d.ts`：CSS Modules 的环境声明。
- `mock/`：开发场景数据，见 [mock/README.md](mock/README.md)。
- `sidebar/`：左下角条目、悬停浮层、圆环。
- `settings/`：设置卡片、字段控件、暂存与保存状态机。

## 关键导出

- `SETTINGS_NAMESPACE`：必须与宿主半边逐字一致，它是两半的配对键，也是设置卡片的 `key` 与左下角条目的 `id`。
- `apply(ctx)`：注册两个 slot；两半都能拿到同一个作用域对象（`apply` 期建一次，引用稳定）。

## 依赖面

- 运行时只会 `require` 到 `react` / `react/jsx-runtime` / `@deepseek-ai/dsh-client-ui-primitives`，其余全部内联进 `lib/client.js`。
- 跨插件值导入会被 bundle-purity gate 拒绝：只能用官方包的公共导出，构件内部实现只能照抄模式。

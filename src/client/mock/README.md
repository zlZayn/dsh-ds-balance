# src/client/mock/ — 开发场景手册

- 职责：给界面开发提供不依赖后端的稳定数据；不进生产路径。
- 变更影响路由：加场景 → 同步根 [README.md](../../../README.md) 的场景清单说明与 [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) 的契约小节。

## 文件

- `scenarios.ts`：全部场景。`make()` 造一个完整响应，每个场景只覆写关心的字段，避免字段漂移。键即 URL 参数取值。
- `index.ts`：场景解析与订阅。解析顺序是 URL 参数 `dsb` → localStorage → 默认；每步失败都静默回落，mock 层不允许把页面搞崩。

## 切换方式

- URL 加 `?dsb=<场景键>`，例如 `?dsb=warn`。会写进 localStorage，刷新后仍生效。
- 场景键见 `scenarios.ts` 的 `scenarios` 对象，权威来源是代码本身，这里不复制清单。

## 场景覆盖

- `state` 四档、`severity` 五档、多币种、币种不匹配、账户无余额、无 Key、今日用量缺失与需复核。
- `todayUsage` 相关场景第一版界面不展示，保留用于契约回归。

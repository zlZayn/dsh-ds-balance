## Postmortem: 客户端半边换新、宿主半边没换，设置卡片崩掉（2026-09-17）

- 摘要：维护者第二轮反馈改完之后，`GET /api/v1/config` 多了一段 `credential`。客户端半边由 `dsh-client-hmr` 立刻换成新代码，宿主半边还是进程启动时那份 —— 新客户端去读旧宿主不存在的字段，`response.credential.writable` 抛 `TypeError`，卡片组件崩、整个 slot 条目从设置页消失。
- 时间线：改 `src/http/handlers.ts` 加 `credential` 段并 `npm run build` → 客户端被 HMR 换新、宿主未重启 → 维护者打开设置页发现卡片不见了 → 定位到 `credential` 为 `undefined` → 客户端加形状守卫 + 可选链、宿主重启后复验通过。
- 根因：**两半的装载时机不同**（客户端每次刷新页面读一次 `lib/client.js`，宿主只在进程启动时读一次 `lib/index.js`），而 `npm run build` 同时覆盖两者。构建一跑就制造出「新客户端 + 旧宿主」的合法中间态，代码里却当成两半永远同版本。
- 防再犯：客户端读宿主**新增**字段一律先过形状守卫（[src/client/data.ts](../../src/client/data.ts) 的 `readCredential`：非对象、缺 `ref`、类型不对一律规整成 `null`），组件侧再用可选链兜一层；未知一律退化成保守默认（凭据未知就当只读）。`test/client-data.test.ts` 加了「对抗旧宿主」的用例组。这条同时写进根 [AGENTS.md](../../AGENTS.md) 的活跃坑与 [src/client/settings/AGENTS.md](../../src/client/settings/AGENTS.md)。
- 关联：[架构说明](../ARCHITECTURE.md) · [进行中计划](../PLAN.md) · [事故复盘目录](.)

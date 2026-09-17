## Postmortem: 没 inject 的存储服务被静默降级（2026-09-17）

- 摘要：隔离实例首次启动时日志出现 `storage domain unavailable ... cannot get property "storageDomain" without inject`。降级吸收让插件照常起来，但**快照一个都没落盘** —— 表面上功能正常，实际丢了持久化。
- 时间线：隔离实例首次启动 → 捕获该日志 → 改用 `ctx.inject(['storageDomain'])` 把门 → 复验 `healthz.store.ok` 为真、`storages/ds_balance.json` 生成 → 再重启实例确认快照被读回。
- 根因：cordis 的服务门禁要求**显式 inject 才可读**，直接访问会抛错；而存储适配器被设计成「打开失败就降级」，于是这条门禁错误被降级路径吞掉，只剩一行 error 日志。**降级路径把配置错误伪装成了运行时故障。**
- 防再犯：可选服务一律走 `ctx.inject` 且不留直接访问；存储适配器改成懒打开 + 失败可重试；`test/artifacts.test.ts` 断言顶层 `inject` 不含可选服务；隔离实例的启动日志纳入验收清单（健康时应当零 `ds-balance` 输出）。
- 关联：[后端架构](../backend-architecture.md) · [验证配方](../../.agents/notes/2026-09-17-verification-recipes.md)

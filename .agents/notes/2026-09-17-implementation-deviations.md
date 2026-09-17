# 决策：实现与本项目既定文档的偏离清单（2026-09-17）

已实施：15 条偏离全部落地并实测；末尾 6 条是仍未拍板的产品决策。

## 问题

后端与界面是按 `docs/backend-architecture.md` 与 `docs/ui-handoff.md` 实现的。
实现过程中有若干处**平台实际能力或官方 token 与文档描述不符**，另有几处文档没写到、实现必须自己定。
这些偏离原先记在已经移除的一次性计划 `docs/PLAN.md` 里，移出时必须换 home，否则下次重诉。

## 决策

15 条偏离，逐条写明「文档说 / 实际做法 / 理由」：

1. `PUT /api/v1/config` → **`POST`**：平台的 `ConnectionFetchMethod` 只有 `GET` / `HEAD` / `POST`，PUT 注册即被拒。
2. `role('secret')` 掩码 → **手动**：`redactSecrets` 是显式开关（`describe({ redactSecrets: true })`），本插件的配置响应自己构造、不走 settings 读。
3. 「只返回 `apiKeyMasked`」→ **固定长度星号串**：不回密钥的任何片段，只让字段名名副其实。
4. `inject = ['settings','credentials','connection']` → **只用前两个**：缺 `connection` 只该丢掉 HTTP 半边，不该让设置与调度一起消失。
5. `storageDomain` → **由 `ctx.inject` 把门**：cordis 不许读没 inject 过的服务（实测报 `cannot get property "storageDomain" without inject`）。
6. 存储适配器构造期打开 → **懒打开 + 失败可重试**：服务可能晚到，一次过早的失败不该把存储永久钉死。
7. 落盘失败即抓取失败 → **只记一次 warn**：存储是可降级的一层，快照留在内存，代价只是重启后不恢复。
8. 「只改 UI 五条」→ **新增 `src/client/data.ts`**：五条改动的前提是前端真能拿到后端数据。
9. mock 从默认来源 → **显式旁路**：默认走真实端点，`?dsb=<场景>` 或 localStorage 选过才用 mock，`?dsb=live` 清回真实数据。
10. §12 四个指标 → **内存登记表 + `healthz.metrics` 暴露**：默认组合没有指标 sink。
11. `.salt` 落在「存档目录」→ **`$DSH_HOME/.salt`**：§10.5 禁止自建 `$DSH_HOME/ds-balance/`；官方先例 `.anonymous-user-id` 也在 home 根。
12. 未提配置响应形状 → **多一个 `credential` 段**：界面要照官方做法决定凭据字段可不可写；用官方 `describe()` 的逐字形状。
13. severity 五档各自一色 → **四色 + 一个形状**：官方 token 的 `error-primary` 与 `error-secondary` 在深色主题下同值；`unavailable` 用红弧加中心叉号（维护者拍板）。
14. 连接组是本插件自己的三个字段 → **照搬官方「模型」卡片的两段式**：只读凭据状态 + 可编辑 Base URL，`apiKey` / `apiKeyRef` 收进「自定义设置」折叠（维护者要求）。
15. 未提阈值变更的刷新时机 → **配置指纹变化即重问一次后端缓存**；宿主侧同时收紧 `scheduler.reset()` 的条件，否则改阈值会顺带打一次官方接口。

**仍未拍板的产品决策**（默认值已实现，等维护者定）：

1. `apiKeyMasked` 的形态：现在不回任何片段。若要用户能核对「是不是这把 key」，需放宽成末 4 位。
2. mock 旁路的开关方式：现在是 URL 参数 / localStorage。若要改成构建期开关或环境变量，需要改法。
3. `.salt` 的文件名：`.salt` 名字很泛。可改成 `.ds-balance-salt`。
4. 左下角默认币种：沿用「自动（跟随账户）」。若要默认固定 CNY，需要改 schema 默认值。
5. `BalanceStatus` 要不要暴露 `lastErrorAt`：原实现里这个字段只写不读，开 `noUnusedLocals` 时被点名，
   已按死状态删除。若原意是要与 `lastSuccessAt` 对称地对外暴露，那是一次对外契约变更，需要单独拍板。

**已拍板**（从上面移下来，结论留档）：

- `LICENSE` 的版权人：`zlZayn`。
- 是否引入 `lint`：不引入，改用 [tsconfig 的四个编译器开关](../../tsconfig.json)
  → [决策记录](2026-09-17-no-linter-decision.md)。

## 替代方案

- **偏离就地改文档、不留清单**：文档是给架构师审过的规格，逐条改回去会让「当时为什么这么定」查不到；清单留在决策记录里，规格本身只在 §8.5 这类确有必要处就地更新。
- **把偏离写进 `docs/ARCHITECTURE.md`**：架构文档写的是**不变的设计**，而这份清单是**一次性的实现对照**，混进去会让架构文档变成变更日志。
- **留在 PLAN.md 里不迁**：PLAN.md 是一次性计划，已从跟踪树移除；不迁等于丢。

## 影响

- 代价：规格文档与实现之间有一份需要人工对照的清单。
- 收益：下次有人照着 §8 写第二个消费方时，能先看到「PUT 不可用」这类平台事实，不会重踩。

## 关联

- [后端架构（修正版）](../../docs/backend-architecture.md) · [UI 侧契约与移交](../../docs/ui-handoff.md) · [架构说明](../../docs/ARCHITECTURE.md)

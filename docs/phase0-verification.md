# 阶段 0 验证报告

范围：架构师划定的阶段 0 —— 只读探针 / 临时脚本 / 秒回滚诊断 / 验完即删。
**未写任何实现代码，未改 UI，未改设置 schema，未改 `lib/index.js`。**

## 结论摘要

| # | 问题 | 结论 |
|---|---|---|
| 1 | 存储域 × 热重挂会不会锁死 | **不会**。用 `ctx.effect` 关闭即正确，无需模块级复用句柄 |
| 2 | `credentials.resolve('DEEPSEEK_API_KEY')` 是否命中 | **命中**，`source: 'env'`，**「凭据继承官方」成立** |
| 3 | `describe().writable` | **`false`** —— 环境层只读，卡片不应提供覆盖入口 |
| 4 | `connection.fetch` 的 `/api` 可达性 | **成立**，组合里挂了 webserver |
| 5 | （意外）`dsh plugin` 会回填 bundles | **是**，需维护者定处置 |

---

## 一、存储域 × 热重挂 —— 通过

**方法**：临时探针插件，`ctx.storageDomain.open` 一个测试域，用 `ctx.effect` 注册关闭；在 profile 的 `cordis.patch.yml` 里对该行做 `disabled: true` → 移除 → 复原，制造两次 apply。

**运行输出**（宿主同一进程两代；原始输出每行都带 pid，这里已略去）：

```json
{"generation":1,"event":"domain.close.begin"}
{"generation":1,"event":"domain.close.done"}
{"generation":2,"event":"apply.enter"}
{"generation":2,"event":"domain.open","ok":true}
```

**源码印证**：`reserved` 在 `open()` 时加入，释放只发生在 `close()` 的 `onClosed` 钩子里（`storage-domain/src/index.ts:157-158`），注释原文：

> only then does the name free up for reopening

**结论**：

- **用 `ctx.effect` 关闭句柄就是正确写法**，§10 不需要「把句柄提到模块级跨重挂复用」。
- 热重挂是**先拆后建**（gen1 的 close 发生在 gen2 的 apply 之前），所以也不会撞「重复注册 namespace」。

**一个旁证**：已装第三方插件 `dsh-usage-statistics-panel` 的 `src/store.ts:99-104` 注释写着它处理过 `already-open` race，且「an escaping rejection here used to be able to take the whole host down」。**我们的实现必须吸收打开失败、不留未观察的 rejection。**

---

## 二、凭据 —— 成立（硬证据）

**运行输出**：

```json
{"event":"credentials.resolve","ok":true,"source":"env","hasValue":true,"valueLength":35}
{"event":"credentials.describe","configured":true,"source":"env","writable":false}
```

只记录了**长度**，没有任何凭据材料落盘或外发。

**结论**：

- **「凭据继承官方」成立。** 用户在模型页配一次，本插件直接继承，不必让用户再填一遍。
- `source: 'env'` —— 来自继承环境层；与在用户级注册表查到的 `DEEPSEEK_API_KEY`（长度 35）吻合。
- **`writable: false`**：环境层只读。

**对文档的影响**：

- §3.1 可以把「待验证」改成实测结论，并补一句「`source` 为 `env` 时 `writable` 为 `false`」。
- §6.2 / §9：**卡片不应把 `apiKeyRef` 呈现为「可覆盖宿主凭据」的入口**。用户要换 key 只能改环境变量。我们的 `apiKey` 字段是**插件自己的**设置项，仍然可写 —— 两者语义要分清。

---

## 三、`connection.fetch` 可达性 —— 成立

- `packages/bundle/web-app/cordis.patch.yml:134-135` 挂 `webserver` = `@deepseek-ai/dsh-host-webserver`。
- 本机 profile 的 bundles 含 `@deepseek-ai/dsh-web-app`。
- 同文件 `:180` 注释：`webserver under /api; browser half is the fetch/SSE client`。

⇒ `connection.fetch.register` 的 `/api` 路由有宿主承载，§9.2 的隐性前提满足。

---

## 四、意外发现：`dsh plugin` 会回填 bundles

**事实**：跑 `dsh plugin --profile <profile> add` 时，**任何声明了 `dsh.bundle` 的已装包都会被写回 `dsh.profile.bundles`**。

- 我们的 `package.json` 声明了 `dsh.bundle.patch` → 每次跑 `dsh plugin` 都会把我们追加回 bundles。
- 对照证据：探针**没有**声明 `dsh.bundle`，安装输出明说「installed as a plain dependency, not a profile layer」，且它**没有**被写进 bundles。

**风险**：bundles 只在启动时读一次，所以现在不炸；**下一次重启会双挂载**（bundles 一行 + patch 一行，同 id）。

**当前状态已清理**：bundles 里没有本插件，patch 里有本插件的 insert 行 —— 正确。

**处置建议（需维护者定）**：

| 方案 | 做法 | 代价 |
|---|---|---|
| A | 开发期从 `package.json` 去掉 `dsh.bundle.patch`，发布前再加回 | 声明与实际短暂不一致 |
| B | 保留声明，把「每次跑完 `dsh plugin` 后手工清一次 bundles」写进挂载流程 | 靠人记得 |
| C | 先验「双挂载到底会不会炸」，不炸就不管 | 未验证风险 |

---

## 五、现场清理

- 探针插件目录、临时日志、profile 依赖**已全部删除**。
- profile 的 `cordis.patch.yml` 只剩本插件一行。
- profile 的 `dsh.profile.bundles` 不含本插件。
- 宿主存活（HTTP 401）。

---

## 六、对后端架构文档的影响

需要改的只有三处：

1. §3.1：`credentials.resolve` 从「待验证」改为实测成立，补 `source: 'env'` 与 `writable: false`。
2. §9.2：把「无 credentials seam 时回落 `NO_KEY`」保留为防御分支（本机命中，但别的装配未必）。
3. §10：确认「用 `ctx.effect` 关闭句柄」是正确写法，**不需要**模块级句柄复用；另加一条「必须吸收打开失败，不留未观察的 rejection」。

**§4 / §6 / §7 / §8 不受影响。**

---

## 参考

- 后端架构（修正版）→ [ds-balance 后端架构](backend-architecture.md)
- 对照审查 → [后端架构文档对照审查](backend-architecture-review.md)

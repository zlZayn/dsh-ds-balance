# 决策：compat 恢复主次 —— alpha 是承诺线，next 停测（2026-09-20）

**已实施**：[compat.yml](../../.github/workflows/compat.yml) 只剩 alpha 一个作业，**不再
`continue-on-error`**（红了就红、就修）；next 作业整个移除。取代
[2026-09-17-compat-lines-advisory.md](2026-09-17-compat-lines-advisory.md) 的"两条都只记录"。

## 依据（当日实测，`git archive` 复制到临时目录跑真实 swap，原仓未动）

| 线 | swap | typecheck | test | verify |
|---|---|---|---|---|
| **alpha** | ✅ | ✅ | ✅ | 12/12 PASS，全部 `0.1.6-alpha.2` |
| **next** | ✅（删锁后） | ❌ | ❌ | 11/11 PASS，全部 `0.1.5-rc.2` |

## 为什么 alpha 升为承诺线

它就是 `engines.dsh` 声明的线、本机宿主在跑的线，而且实测全绿 —— "承诺"与"实测"第一次重合。
承诺线红了必须修，这正是主次的本意。

## 为什么 next 停 —— **理由是语义错位，不是"它红"**

next 线每周把声明换到 `0.1.5-rc.2`，**低于我们 `engines.dsh` 声明的下限** ——
这条作业测的是"我们已经声明不支持的宿主"。也就是说它红了不代表我们有错，
绿了也不代表我们支持 —— 两种结果都没有语义。停。

实测还给了两个事实，留作将来恢复的凭据：

1. **next 线装得上、代码只差一个图标**：`src/client/sidebar/BalancePopover.tsx` 引用的
   `IconPluginPinwheelOutline16` 在 `ui-primitives@0.1.5-rc.2` 里不存在（alpha.2 才有）。
   将来若要"旧宿主上降级运行"的能力，修掉这一个引用即可让 next 变绿。
2. **swap 工具有个安装层缺口**（已另行修复）：CI 原流程 `npm ci → swap`，换线后 `npm install`
   拿 alpha 锁文件与 rc.2 manifest 相撞，**每次都死在 ERESOLVE、根本测不到代码**。
   锁文件冲突和代码构建是两层，混在一起会遮蔽真问题 —— swap 现在在 install 前删锁文件。

## 替代方案（不采用）

- **两条线都升为承诺线**：next 语义错位没解决，只是把"没有意义的红"变成"必须修的红"。
- **next 修到绿后继续测**：修图标是向"支持旧宿主"迈的一步，那是一个**产品决定**（要不要承诺
  降级运行），不该由巡检的方便与否顺手带出来。要做就走发版问题链。
- **维持两条都只记录**：正是 09-17 之后的现状 —— alpha 全绿时它毫无信息量，
  alpha 红时它又把"该修的"和"没意义的"混在一个 continue-on-error 里。

## 影响

- alpha 红了会**阻断**并开跟踪 issue（原来只记录）。
- 巡检每周少跑一个作业（next），省几分钟 runner。
- 将来恢复 next 的入口：修 `BalancePopover.tsx` 的那个图标引用 + 本文件加回 next 作业。

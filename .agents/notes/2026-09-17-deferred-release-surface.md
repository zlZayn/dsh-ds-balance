# 决策：暂缓的发布面项目（2026-09-17）

已兑现（同日）：六项的触发条件成熟，全部落地 —— 见[落地记录](2026-09-17-release-surface-landing.md)。
本文件保留作**触发条件与理由的存档**，不再指导后续工作。

## 问题

对照同一维护者的 `dsh-zhihu-search`，本项目缺七项：

| 项 | 参考项目 | 本项目 |
|---|---|---|
| `assets/`（logo / banner / 截图） | 11 个文件 | 无 |
| `README_en.md` | 有 | 无 |
| `CONTRIBUTING.md` | 有 | 无 |
| `docs/PUBLISHING.md` | 19KB | 无 |
| `vitest.contract.config.ts` | 有 | 无 |
| `.github/workflows/` | 4 个 | 1 个 |
| `scripts/` | 6 个 | 4 个 |

七项都只在「已发布」「有远端仓库」「有真实上游配额」之后才有意义；现在补出来是空壳，
而且空壳会误导下一个人以为这些面已经能跑。

## 决策

**本轮只做 `README_en.md`**：它是门面的一部分，与是否发布无关，成本一行对一行。
其余六项挂起，逐项写明触发条件；触发条件满足前**不建文件、不建空目录**。

| 项 | 触发条件 |
|---|---|
| `assets/` | 有可访问的远端仓库，且准备在门面放 logo / 截图时。放图前先确认图能被 git 跟踪。 |
| `CONTRIBUTING.md` | 出现第一个外部贡献者，或明确要接受外部 PR 时。 |
| `docs/PUBLISHING.md` | 准备第一次发布时。它与 `scripts/check-release.mjs` 是互补关系：脚本卡发布态不变量，文档讲流程。 |
| `vitest.contract.config.ts` | 有真实 DeepSeek 上游配额、能跑打真实接口的契约测试时。 |
| `.github/workflows/` 的 compat / contract / release | 分别依赖「有宿主版本线要盯」「有真实上游」「已发布」。 |
| `scripts/` 的 acceptance / release-guard / compat-swap | acceptance 依赖装好的产物与真实上游；release-guard 依赖 `release.yml`；compat-swap 依赖发布后的宿主版本线。 |

## 替代方案

- **现在全补**：六项里五项是空壳（没有远端仓库、没有配额、没发布），补出来只会让人以为能跑。
- **一项都不做**：`README_en.md` 与发布无关，且门面双语是既定习惯，拖着等于下次改中文门面时又要补一遍。
- **把清单写进根 AGENTS.md 的待办**：仪表盘已经接近几十行的上限，六条带条件的挂起项会把「下一步该干嘛」淹掉；挂在决策记录里、待办只留一行指针更合适。

## 影响

- 代价：这六项在文件树里看不到，只有翻决策记录才知道它们被有意挂起。
- 收益：文件树里没有空壳；每个挂起项都有可判定的触发条件，不需要靠记忆。

## 关联

- [根门面](../../README.md) · [英文门面](../../README_en.md) · [发布前检查](../../scripts/check-release.mjs) · [工程规范对齐](2026-09-17-zhihu-search-alignment.md)

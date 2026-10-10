# Release Drafter — 草稿 Release 的维护

- 层：**活**。它描述的是本仓当前的触发 workflow 与组织级配置，改任一处就同批改它。
- 它**不发布任何东西**。本仓唯一的发布入口是 [release.yml](../.github/workflows/release.yml)（手动 `workflow_dispatch`），
  流程与版本号判定见 [PUBLISHING.md](PUBLISHING.md)。

## 两层分工

| 件 | 位置 | 职责 |
|---|---|---|
| 配置 | 组织级 [.github 仓库](https://github.com/dsh-plugin-lab/.github) 的 [.github/release-drafter.yml](https://github.com/dsh-plugin-lab/.github/blob/main/.github/release-drafter.yml) | 分类、排除、tag 与标题模板、版本解析 |
| 触发 | 本仓 [.github/workflows/release-drafter.yml](../.github/workflows/release-drafter.yml) | 何时跑、权限、runner |

- 本仓**没有**自己的 `release-drafter.yml`：文件已删。
  组织级那份按 GitHub 的约定提供给该组织下所有未自带配置的仓，本仓因此继承它。
- 配置只有一个 home（组织级仓库），本页不复制其内容。

## 它做什么

每次有内容合并进 `main`，组织级配置会让这些 PR
**按标签分类追加进一份草稿 Release**。

它**不碰版本号、不打 tag、不发布** —— 草稿只是「下一版可能包含什么」的草稿，
发布决策权留给人。本仓的版本号由 `npm version` 显式 bump，草稿里那个 `v<版本>` 标题
只是解析器按标签推的**显示值**，不参与任何发版判断。

## 当前状态（本批落地范围）

| 项 | 状态 |
|---|---|
| 配置文件 | 在组织级 [.github 仓库](https://github.com/dsh-plugin-lab/.github) 的 `.github/release-drafter.yml`（本仓不自带） |
| 触发 workflow | 已就位（[../.github/workflows/release-drafter.yml](../.github/workflows/release-drafter.yml)） |
| 草稿 tag | `next`（滚动名，见下「为什么不是 `v<版本>`」） |
| **草稿正文是否接入发布流程** | **否** —— `release.yml` 仍用 `--generate-notes`，本批**没有**改它 |
| 下一步 | 让草稿积累几笔 PR 合并内容后，再决定要不要让发布脚本读它（改 `release.yml` 是独立任务） |

**为什么不一步到位**：草稿正文要接进发布脚本，就得动 `release.yml` 那条 `gh release create` ——
而 `test/redlines.test.ts` 对它有逐字形状断言（见 [PUBLISHING.md](PUBLISHING.md)）。
先让草稿跑起来，确认真能产出内容，再改那条断言不迟。

## 标签映射

分类沿用仓库**既有**标签（这批标签在历史 12 笔 PR 上已实际用过，不是新造的分类法）：

| 分类 | 标签 |
|---|---|
| Features | `enhancement` |
| Bug Fixes | `bug` |
| Compatibility | `compat` |
| Refactoring | `refactor` |
| Documentation | `documentation` |
| Other Changes | `*`（兜底：没打标签、或打了上表之外的） |

**排除**：`skip-changelog`（本批新建）。依赖更新这类「合了但用户看不到」的改动打这个标签，
它会从**所有**分类里排除（`pre-exclude`），不落 Other Changes。

贡献者要做什么，见 [../CONTRIBUTING.md](../CONTRIBUTING.md) 的「PR 标签」一节。

## 本仓的适配情况（重要）

**Release Drafter 读的是 PR，不是 commit。** 而本仓有两段历史：

- **早期（约 #2–#13）走 PR**，那批 PR 都带标签 —— 分类法在它们身上验证过；
- **此后的改动直提 `main`**（当时对小改动的既定做法）。

`main` 现在有 `protect-main` ruleset：合并**必须走 PR**，直推只对 admin bypass 与 `dsh-shipwright` App 开放
（见 [../AGENTS.md](../AGENTS.md) 的 PR 粒度）。

所以：**绕过 PR 落到 `main` 的提交对草稿是不可见的**（admin bypass 直推、App 推送皆然）。
落地后实测确认过 —— 直提一次 `main` 后草稿确实生成了，但正文是 `No changes`，而 workflow 仍然报 `success`。
**空草稿是静默的**，不会有人被红脸提醒。

结论：**要用它就得走 PR**。规则的常态就是走 PR；bypass 只留给发布链这类确实绕不开的推送，
那种推送不进草稿 —— 但注意这意味着草稿会**漏掉**它们，这是取舍不是缺陷。

### 「绕过 PR 的推送进不了草稿」不是缺陷，是设计对上了（本轮结论）

一度把这条当成缺口，想调研「有没有从 commit 解析的选项」。**结论是：不需要，也不该做。**

判据是本仓自己的 [PR 粒度表](../CONTRIBUTING.md)：**绕过 PR 的前提就是「不影响用户可见行为」**
（纯文档、typo、单个事实修正）。而 Release 正文是**给用户看的**（「这一版变了什么」）——
不影响用户的东西**本来就不该进正文**。

所以两件事是同一件事的两面：

| | 绕过 PR | 走 PR |
|---|---|---|
| 影响用户可见行为 | ❌ 不允许（判据） | ✅ 通常 |
| 该进 Release 正文 | ❌ 不该 | ✅ 该 |

「草稿收不到绕过 PR 的推送」正好等于「不影响用户的改动不进正文」——**规则自洽，不是漏收**。

（若哪天出现「不影响用户但确实该写进正文」的改动，那说明 PR 粒度判错了，
该改的是那次改动的走法，不是给草稿加一条 commit 解析路径。）

## 为什么草稿 tag 是 `next` 而不是 `v<版本>`

`release.yml` 用 `gh release view "$tag"` 判断「这一版是否已发过」：

```bash
if gh release view "$tag" >/dev/null 2>&1; then
  echo "$tag 的 Release 已存在，跳过。"
```

草稿 tag 若用 `v$RESOLVED_VERSION`，正式打 `v1.2.3` 时那条判断会**命中草稿**并走「跳过」分支 ——
而 `gh release edit` 不会把草稿变成已发布。结果：**npm 上发了、正式 Release 页面却查不到，且不报错**。

所以草稿 tag 用滚动名 `next`，永远不与 `v<版本>` 相撞。
**标题**仍可用 `v$RESOLVED_VERSION` 显示建议版本号 —— 标题与 tag 是两个字段，互不影响。

## 改配置时

- 改分类 / 排除 / 模板 / 版本解析 → 组织级 [.github 仓库](https://github.com/dsh-plugin-lab/.github) 的 `.github/release-drafter.yml`
  （**影响该组织下所有不自带配置的仓**，不止本仓；改完到各仓的草稿各看一次）。
- 改触发条件 / 权限 / runner → 本仓 [.github/workflows/release-drafter.yml](../.github/workflows/release-drafter.yml)
- **runner 必须 ubuntu-latest**：`windows-latest` 的路径分隔符会让 action 读不到配置（404），
  草稿会静默变空 —— 与上面「空草稿不报错」是同一类静默失败。
- 配置读不到或草稿空，**都不会让 workflow 变红**，所以改完配置要真的看一次草稿内容，别只看 run 状态。

## 关联

- [PUBLISHING.md](PUBLISHING.md) —— 发布流程与版本号判定（本仓唯一发布入口）
- [../CONTRIBUTING.md](../CONTRIBUTING.md) —— PR 标签与 issue 标题约定
- [.github/workflows/release-drafter.yml](../.github/workflows/release-drafter.yml) · 组织级 [.github 仓库](https://github.com/dsh-plugin-lab/.github) 的 `.github/release-drafter.yml`
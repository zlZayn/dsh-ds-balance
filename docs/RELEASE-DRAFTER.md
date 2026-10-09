# Release Drafter — 草稿 Release 的维护

- 层：**活**。它描述的是本仓当前的配置与状态，改配置就同批改它。
- 它**不发布任何东西**。本仓唯一的发布入口是 [release.yml](../.github/workflows/release.yml)（手动 `workflow_dispatch`），
  流程与版本号判定见 [PUBLISHING.md](PUBLISHING.md)。

## 它做什么

每次有内容合并进 `main`，[release-drafter.yml](../.github/release-drafter.yml) 会把这些 PR
**按标签分类追加进一份草稿 Release**。

它**不碰版本号、不打 tag、不发布** —— 草稿只是「下一版可能包含什么」的草稿，
发布决策权留给人。本仓的版本号由 `npm version` 显式 bump，草稿里那个 `v<版本>` 标题
只是解析器按标签推的**显示值**，不参与任何发版判断。

## 当前状态（本批落地范围）

| 项 | 状态 |
|---|---|
| 两个配置文件 | 已就位（[release-drafter.yml](../.github/release-drafter.yml) + [workflow](../.github/workflows/release-drafter.yml)） |
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
- **最近的改动直提 `main`**（本仓对小改动的既定做法，见 [../AGENTS.md](../AGENTS.md) 的 PR 粒度）。

所以：**直提 `main` 的提交对草稿是不可见的。** 落地后实测确认过 ——
直提一次 `main` 后草稿确实生成了，但正文是 `No changes`，而 workflow 仍然报 `success`。
**空草稿是静默的**，不会有人被红脸提醒。

结论：**要用它就得走 PR**（至少改动要有 PR）。直提的小改动（纯文档、typo）不划算开 PR，
那种就让它不进草稿 —— 但注意这意味着草稿会**漏掉**它们，这是取舍不是缺陷。

若将来想让直提也能进草稿，可以看 action 有没有从 commit 解析的选项；本批**没有**调研，
留待需要时再定。

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

- 改分类 / 排除规则 → [release-drafter.yml](../.github/release-drafter.yml)
- 改触发条件 / 权限 / runner → [release-drafter.yml workflow](../.github/workflows/release-drafter.yml)
- **runner 必须 ubuntu-latest**：`windows-latest` 的路径分隔符会让 action 读不到配置（404），
  草稿会静默变空 —— 与上面「空草稿不报错」是同一类静默失败。
- 配置读不到或草稿空，**都不会让 workflow 变红**，所以改完配置要真的看一次草稿内容，别只看 run 状态。

## 关联

- [PUBLISHING.md](PUBLISHING.md) —— 发布流程与版本号判定（本仓唯一发布入口）
- [../CONTRIBUTING.md](../CONTRIBUTING.md) —— PR 标签与 issue 标题约定
- [../.github/release-drafter.yml](../.github/release-drafter.yml) · [../.github/workflows/release-drafter.yml](../.github/workflows/release-drafter.yml)
# 插件展示元数据：本地化标题与描述

**类型**：决策记录（问题 / 决策 / 替代方案 / 影响）。
**关联**：同属 `2.0.0-alpha.2` 的[配置入口回退](2026-09-22-config-entry-back-to-bundle-config.md)（那份讲入口与材质，这份讲「插件页上这个插件叫什么」）。

## 问题

使用者在官方组合包上看到两件事：插件页里显示的是**本地化的标题与描述**，而不是包名；
第三方插件一律只显示包名（`dsh-ds-balance`），详情页也没有那句话说明。
问题因此是：**要不要照做，代价是什么。**

## 事实（实测，出处给到文件）

- **机制是官方的**：`docs/cookbook/adding-a-package.md` 的 §5 *Add optional plugin display metadata*；
  官方自己的包就是这么写的 —— `packages/experimental/agent-team-profile/` 有 `locale/` 与 `icon.svg`，
  `packages/experimental/agent-team/` 只有 `locale/`。
- **读取方是宿主，不经过插件代码**：`packages/boot/app-boot/src/package-meta.ts` 的 `readPluginMeta()` ——
  先解析 `<包名>/locale/en.json`，再**枚举同目录下每一个 `.json`**（`dictionariesOf()` 里的 `readdirSync`），
  两者都经 Node 的子路径导出解析；`package.json` 走同一条路（取 `name` / `description` / `icon`）。
- **回落是逐字段的**：标题 `meta.title` → `package.json.name` → 完整说明符；
  描述 `meta.description` → `package.json.description` → 不显示。
- **坏了的信号是静默的**：字段缺失走上面的回落；字段非法（空串、不是字符串）、JSON 坏、文件名不像语言 id
  都会被 `textOf()` / `dictionariesOf()` 抛出、被外层 catch 成一条诊断 —— **整包元数据一条都不显示**。
  缺 `en.json` 时连别的语言文件都不会被读（`englishPath === undefined` ⇒ 空字典）。
- **画面上是两处**：`ui-plugin-manager/src/client/presentation.ts` 的 `packageText()`（列表卡片 + 详情页）与
  `rowText()`（bundle 里的行）。详情页除了标题，还会另起一行写出**完整包名**（`PluginManagerPage.tsx` 的 `data-plugin-name`）。
- **本仓的包名不带 scope**（`dsh-ds-balance`），`barePackageName()` 照样认它 —— 这是元数据读得到的前提。
- 官方校验器 `scripts/verify-package-meta.ts` 检查「字段 / 资源导出 / 发布覆盖」三面；
  但它只扫官方仓库的 `packages/*/*`，**插件仓不在覆盖里**。

## 决策

1. **照做**：加 [locale/en.json](../../locale/en.json) 与 [locale/zh.json](../../locale/zh.json)，各只写 `meta.title` 与 `meta.description`。
   中文标题取「DeepSeek 余额」—— 与左边栏条目**同名**；英文取 `DeepSeek Balance`。
   描述一句话讲清这个插件干什么，面向使用者而不是开发者。
2. **`exports` 加 `"./locale/*.json"`**（`"./package.json"` 本来就在），**`files` 加 `"locale/*.json"`**。
3. **不加图标**，理由见替代方案 2。
4. **发布面落成本仓断言**（官方那条门禁扫不到我们）：[check-release.mjs](../../scripts/check-release.mjs) 按**目录扫描**对账 ——
   `locale/` 下每个 `.json` 都要被 `exports` 与 `files` 覆盖、`en.json` 在、字段非空、文件名是语言 id；
   [redlines.test.ts](../../test/redlines.test.ts) 守两份文件的**键集一致**与**门面点名的显示名逐字一致**。
5. **规则写进 [locale/AGENTS.md](../../locale/AGENTS.md)**：回落链、硬约束、改文案要顺带查什么。
6. **定档 patch 档，台阶落在已就位的 `2.0.0-alpha.2` 上**（该版本尚未发布，判例库在[发布手册](../../docs/PUBLISHING.md)）。

## 替代方案（试过或想过，为什么不选）

1. **不加，继续显示包名**。不选：使用者是照官方组合包的观感提的，而这套机制本来就是给第三方包准备的；
   代价只有两个 JSON 与两条导出 / 打包条目。
2. **顺手造一个 `icon.svg`**（比如把左边栏那个状态环画成图标）。不选：仓库里**没有**可当图标的自包含图形资产，
   造一个等于替维护者做设计决定，而图标是门面的一部分。代价说白：插件页上本插件仍用宿主的默认图形。
3. **把它读进我们自己的界面**（客户端 import 这两份 JSON）。不选：读取方是宿主，我们读它等于**同一件事两个 home**，
   还会把它拖进 `lib/`（那份副本不会再跟着包根的 JSON 变）。
4. **每个语言文件里多写几个字段**（比如将来想加主页）。不选：宿主只认那两个字段，多写的没人读；
   红线因此把键集锁成这两个，免得「写了以为生效」。
5. **只写散文（README / docs）不上断言**。不选：缺文件、少导出、字段拼错的表现**全是静默回落**，散文拦不住。

## 影响

- 插件页上这个插件从包名变成显示名（中文「DeepSeek 余额」、英文「DeepSeek Balance」），并第一次有了描述；
  详情页仍在标题下面写出完整包名。
- **`settings-cards-position*.png` 两张从「不用动」变成要重拍**：上一轮的判据是「只改了入口」，
  而列表卡片画的正是标题与描述。加上 `settings-card*.png`（入口 + 版本 tag + 标题描述）与
  `sidebar-popover*.png`（材质 + 几何），**六张门面图现在都要重拍**，已登记进[根 AGENTS.md](../../AGENTS.md) 的待办。
- **发布面多了一个会静默坏的面**：`files` 少收录、`exports` 少一条、字段拼错，界面都照常渲染。
  三道保护（发布检查、红线、规则层）都已就位。
- **文案的真源多了一处**：`locale/*.json` 管插件页上的名字，[locales.ts](../../src/client/locales.ts) 管插件自己界面里的字。
  两处不是一回事，各自的规则层都写了指针，免得互相抄。
- **版本号**：`2.0.0-alpha.2`（未发布，所以不必再占一位预发布计数）。

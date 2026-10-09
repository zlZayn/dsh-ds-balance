# 换版必须连带换 `engines.dsh`

状态：生效

**类型**：决策记录（问题 / 事实 / 决策 / 替代方案 / 影响）。
**缘起**：兼容巡检（tracking issue #1）在 2026-10-05 那轮红了，红在
[test/redlines.test.ts](../../test/redlines.test.ts) 的「每个 `@deepseek-ai/dsh-*` 区间与 `engines.dsh` 逐字相同」，
而 `typecheck` 是绿的 —— 一次与「不兼容」无关的红。

## 问题

`compat-swap.mjs swap` 只改写 `dependencies` / `devDependencies` / `peerDependencies` 三个依赖段，
**不碰 `engines.dsh`**。两者由同一条红线要求逐字相同，于是每次换线都产生一次结构性矛盾：

| | 换线前 | 换线后 |
| --- | --- | --- |
| 23 处 `@deepseek-ai/dsh-*` | `>=0.2.0-rc.1` | `>=0.2.0-rc.2` |
| `engines.dsh` | `>=0.2.0-rc.1` | **仍是 `>=0.2.0-rc.1`** |
| 那条红线 | 绿 | **必然红** |

宿主本体被漏掉有两层原因，且**两层都成立**：

1. 它不在任何依赖段里 —— `engines.dsh` 是 `engines` 对象的键，不在 `MANIFEST_FIELDS` 覆盖的三个键里；
2. 它也不在受管名单里 —— `PREFIX` 是 `@deepseek-ai/dsh-`（**带尾横线**），而宿主本体是
   `@deepseek-ai/dsh`（**没有尾横线**），`managedNames()` 因此收不到它。

## 事实（实测，非推断）

- 2026-10-05 巡检（run `37285593853`）：`swap=success typecheck=success test=failure`，
  `482 tests` 里只有那一条红，报错 `expected [ '>=0.2.0-rc.2' ] to deeply equal [ '>=0.2.0-rc.1' ]`。
- **`typecheck` 绿** ⇒ 宿主 `0.2.0-rc.2` 上代码本身兼容，那次红不是不兼容信号。
- 本机把「只动依赖段」的结果手工写进 `package.json` 后复跑那条红线，**稳定复现同一条失败**
  （本轮实测，非引用 CI 日志）。
- 本机 `check:declaration` 全程绿（24 条声明都罩住 `0.2.0-rc.2`）⇒ 声明面本身没问题，
  矛盾只由换版过程制造。
- 该巡检自 2026-09-19 起红过三轮（`swap=failure` → `alpha` 线 → `test=failure`），
  前两轮各有别的根因，这一轮是本条。

**代价被放大的原因**：那条红线本来的用途是「声明面自相矛盾时拦住」，
而换版制造矛盾 ⇒ 它在**每次**换线时都亮，且亮的位置**恰好是会掩盖真正不兼容点的那一条** ——
真出现不兼容时，红线仍然只说「engines.dsh 对不上」，增量信息为零。

## 决策

**`swap` 一并改写 `engines.dsh`，`verify` 也先验它。** 换版覆盖声明面的**全部**位置，
而不是依赖段这一半。

实现上把改写逻辑从 `swap()` 抽成纯函数 `applyPlan(manifest, plan, hostVersion)`，
理由与本仓既有惯例一致：**能落成可执行断言的不写散文**（见
[2026-09-17-prepare-script-decision.md](2026-09-17-prepare-script-decision.md) 的同一条取向）。

三处守卫：

| 守卫 | 位置 | 拦什么 |
| --- | --- | --- |
| `selftest` 的整份换版断言 | [compat-swap.mjs](../../scripts/compat-swap.mjs) | `engines.dsh` 与依赖段不同进同退 |
| `swap` 的存在性前置 | 同上 | manifest 没有 `engines.dsh` 时抛错，不把声明面落在半路 |
| `verify` 的 `engines.dsh` 先验 | 同上 | 半换过的 manifest 被读成「这次换版是干净的」 |

`verify` 那条是**独立价值**，不是重复：依赖段全绿而 `engines.dsh` 落后时，
原 `verify` 会报「N 个包全部落在目标线上」——一个假的干净结论。

## 替代方案（试过，为什么不选）

1. **让红线在 swap 场景下跳过**（给那条断言加「换线中」旁路）。不选：它把症状藏起来 ——
   换版**本来就应该**产出前后一致的声明面，跳过等于承认换版产物是坏的，只是假装没看见。
2. **把红线改成「只要依赖段彼此相同即可」，不要求与 `engines.dsh` 相同**。不选：
   那条红线的语义是「使用者按我们给的区间装不出可用的宿主」，而宿主本体正是使用者选宿主的那一半。
   放宽它会真放过矛盾声明面。
3. **把宿主本体并入 `PREFIX`（改成 `@deepseek-ai/dsh` 前缀匹配）**。不选：
   那会同时把 `cordis` / `schemastery` 拖进替换面 —— 它们不带这个前缀正是**有意排除**
   （见脚本里 `PREFIX` 的注释：它们的 next 线比 latest 还旧，换过去等于降级）。
   换个前缀等于把那条排除决定推翻。
4. **在 `swap` 之后由人手工同步 `engines.dsh`**。不选：那正是当前状态 —— 换版是每周自动跑的，
   「记得手工改一行」在自动化流程里等于「迟早忘了」，而忘了的后果就是那条必红的线。

## 影响

- compat 巡检的 `test` 步不再因换版本身而红 ⇒ 恢复成真正的**兼容性信号**。
- 换版后 `package.json` 的改动多一处（`engines.dsh`），这在 diff 里是**预期内**的。
- 那条红线的强度不变：它在「有人在别处手改声明面」时照常拦。
- 顺带修掉一个既有的**假绿**：`verify` 现在会看 `engines.dsh`（原先只看 `node_modules`）。

**验收判据**（本轮实跑）：`npm test` 482/482 绿（含那条红线）；`node scripts/compat-swap.mjs selftest` 15/15；
把「删掉 `engines.dsh` 换版」的副本喂给 `selftest` → 退出码 1 且指名缺陷（证明守卫真的会响）。

## 关联

- tracking issue [#1](https://github.com/zlZayn/dsh-ds-balance/issues/1)（本条修的是 2026-10-05 那一轮）
- [承诺线从 alpha 换到 RC 线](2026-10-01-track-rc-line.md) —— 那次换线是本条问题的触发条件
- [换线脚本保形](2026-09-17-compat-lines-advisory.md) 的后续（compat 线主次），以及
  [scripts/README.md](../../scripts/README.md) 的「文件」节
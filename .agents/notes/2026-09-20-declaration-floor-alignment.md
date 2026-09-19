# 声明面下限对齐：所有 `@deepseek-ai/dsh-*` 声明的下限抬到 `engines.dsh` 的下限

## 问题

`package.json` 的 `engines.dsh` 是 `^0.1.6-alpha.2`，但同一份清单里 **10 条**官方声明的下限比它低：

| 声明位置 | 条数 | 当时的区间 |
|---|---|---|
| `peerDependencies`（同时也在 dev） | 8 | `^0.1.6-alpha.1` |
| 只在 `devDependencies`（`dsh-client-ui-renderer` / `dsh-client-ui-sidebar`） | 2 | `^0.1.6-alpha.1` |

两份声明自相矛盾：peer 允许的宿主下限**低于**我们声称支持的下限 —— 使用者按 peer 区间装出来的宿主，
未必有我们需要的那个 `plugins.bundle.config` 槽。这不是洁癖问题，是"我们给使用者的区间装不出能用的东西"。

同源的另一仓 `dsh-zhihu-search` 更落后：9 条 peer 停在 `^0.1.5-rc.2`。

## 决策

**把 10 条全部抬到 `^0.1.6-alpha.2`**，peer 与 dev 两处同改（两处原本逐条相等，改完仍相等）。

依据是**实测**而不是推断：alpha 线上这些包的实际版本就是 `0.1.6-alpha.2`
（`node scripts/compat-swap.mjs check` 与官方源 dist-tags 一致），所以这次抬升是"把事实说出来"，
不是提前承诺一个还没发布的版本。

## 替代方案

- **降 `engines.dsh` 到 `alpha.1` 去迁就 peer** —— 否。`engines.dsh` 的下限是**历史事实**：
  `plugins.bundle.config` 槽由 `0.1.6-alpha.2` 引入。降它等于声明"支持没有该槽的宿主"，
  而插件的配置界面正是注册在那个槽上。
- **只抬 peer、不抬 dev** —— 否。两处会立刻漂开，而本地类型检查用的是 dev 装的版本 ——
  红线会假绿（这也是本次把红线从「存在」升级成「版本相等」的原因）。
- **不动，等候选 7 的断言落地再说** —— 否。断言只能**发现**矛盾，不会**消除**它；
  而且断言一落地两仓立刻红，等于把一次改动拆成两次。

## 影响

- **对外是 major**：使用者必须改变依赖声明（按本仓自己的判定链：使用者要改声明 → major）。
  两仓各付一次。
- 本仓红线同时升级：`test/redlines.test.ts` 的依赖分层那条从「peer 的包在 dev 里存在」
  改成「peer 与 dev 版本逐条相等」。
- 工具侧：`compat-swap.mjs` 的换版与 verify 都按"声明在哪"分档判定（见
  [plugin-manager 依赖形态](2026-09-20-plugin-manager-dependency-kind.md)）。
- **改完必须跑一次 `npm install`**：lockfile 的根条目也记着声明区间，不重跑就与 `package.json` 不一致。
  本次实测：抬完 10 条后锁文件仍停在旧区间，跑一次 install 才对齐（顺带把两个仅 dev 的包从
  `alpha.1` 实际装到 `alpha.2`）。

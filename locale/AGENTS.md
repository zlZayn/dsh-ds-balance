# locale/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

这里放的**不是本插件界面的文案**（那是 [src/client/locales.ts](../src/client/locales.ts)，运行时经 `ctx.locale` 注册），
而是**包的展示元数据**：插件页上那个标题、那句话说明，以及（可选的）图标。区别是承重的 ——

- 这两份 JSON 由**宿主直接读**（从 `<包名>/locale/en.json` 起头，再枚举同目录下的 `*.json`），
  **我们的代码一个字节都不读它**，它也不进 `lib/`。所以想改插件页上显示什么，只有这一处可改。
- 读不到或读坏了的信号是**静默**的：宿主按「缺字段」回落，界面照常渲染，只是显示成了包名或
  `package.json` 的 `description`。唯一的保护是断言 —— 发布面（`exports` / `files` 的覆盖）在
  [../scripts/check-release.mjs](../scripts/check-release.mjs)，两份文件的键集与门面引用在
  [../test/redlines.test.ts](../test/redlines.test.ts)。

## 回落链（逐字段独立）

- **标题**：本目录的 `meta.title` → `package.json` 的 `name` → 完整 Cordis 名。
- **描述**：本目录的 `meta.description` → `package.json` 的 `description` → 不显示。
- **图标**：`package.json` 的 `icon`（路径相对清单目录、必须在包内、自包含、≤256 KiB）。
  本包声明的是包根的 [icon.svg](../icon.svg) —— 与左边栏那个状态环**同一个图形**（等比放大到官方 36 画布）：
  一圈轨道 + 七成弧。弧写死 `#F59E0B`（宿主 warn 档语义色，亮暗两块表同值）；轨道写死 `#7F8287` 加 45%
  不透明度（那条真轨道跟随主题、烘不进来，这个组合在两种主题下都落在它附近）。
  几何、选色依据与可读性测算见[决策记录](../.agents/notes/2026-09-22-plugin-icon.md)。

## 硬约束

- **`en.json` 是发现入口**：宿主先解析它；它不在，其余语言文件根本不会被读。
- **文件名就是语言 id**（`en` / `zh` / `zh-CN` 这种形状）。
- **只放 `*.json`**：宿主会枚举这个目录下每一个 `.json` 并逐个解析。非 `.json` 文件不被枚举。
- **字段只有 `meta.title` 与 `meta.description`**，值必须是**非空字符串**。
- **中英两份的键集必须逐字相同**：少一个字段只会在那种语言下露出另一种语言。

字段**缺失**走上面的回落链；字段**非法**（空串、不是字符串、JSON 坏、文件名不像语言 id）会让
**整包**元数据降级成一条诊断 —— 标题与描述一起不显示。所以宁可少写一个字段，也不要写空串。

## 改这里的文案要顺带查

- 门面 [README.md](../README.md) / [README_en.md](../README_en.md) 里点名插件的地方 —— 红线钉着逐字一致。
- [assets/AGENTS.md](../assets/AGENTS.md) 的「什么时候必须重截」：插件页上的标题与描述**画在图上**，
  所以改了这两份 JSON，`settings-card*.png` 与 `settings-cards-position*.png` 四张都要重拍。
- **换图标**（`icon.svg`）：`package.json` 的 `icon`、`files` 与文件本身必须同批改 ——
  `check:release` 照宿主 `iconOf()` 的判据对账（相对路径 / 扩展名 / 留在清单目录内 / 普通文件 / ≤256 KiB / 进包）；
  [红线](../test/redlines.test.ts) 的「插件图标」钉住它与圆环同形、弧长 70%、颜色就是 warn 档那个值。
  **改它的时候注意 XML 的规矩：注释里不许出现连续两个连字符** —— 第一版就是把宿主那几条 token 的
  原名写进了注释（它们以两个连字符开头），文件于是**不是良构 XML**，浏览器当图片解析直接失败、
  插件页一声不响地用回默认图形（宿主不校验，它只把字节编成 data URL）。红线里有一条良构检查守着它。
- 加了新语言文件不用动 `files`（`locale/*.json` 这条模式罩得住），但要跑一次 `npm run check:release`：
  它按**目录扫描**对账，绕不开。

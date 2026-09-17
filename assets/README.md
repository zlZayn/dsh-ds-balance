# assets/ — 门面截图手册

- 职责：放**界面实拍截图**，供根门面引用。
- 变更影响路由：换图或改名 → 同步 [README.md](../README.md) 与 [README_en.md](../README_en.md) 的引用；改判据 → 同步 [AGENTS.md](AGENTS.md)。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。

## 文件与引用面

- `settings-card.png`：设置卡片的中文实拍，被根 [README.md](../README.md) 引用。
- `settings-card_en.png`：同一画面的英文版，被 [README_en.md](../README_en.md) 引用。

**这两张现在是占位图** —— 一张灰底斜纹块，不是界面。
替换流程、重截判据与验收标准见 [AGENTS.md](AGENTS.md)。

## 风格基准

- 只拍**卡片本体**：标题、副标题、四组折叠头、展开后的字段行、底部「放弃 / 保存」。
- 不拍整屏、不拍侧栏、不拍浏览器标签 —— 那些内容与本插件的能力无关，还会带出维护者的其他会话。
- **图里不许出现真实凭据、真实余额、真实 Base URL**。凭据行只允许出现掩码或「由启动环境提供（只读）」。
- 不写死像素尺寸：截图工具的 viewport 各不相同，写死一个数字只会让下一次重截对不上。

## 与发版的关系

- 图**不进 npm 包**：[package.json](../package.json) 的 `files` 里没有 `assets`。
  改图不改产物，[release-guard.mjs](../scripts/release-guard.mjs) 把它归在「不影响产物」那一档。
- 但图是门面的一部分：改了卡片外观却不重截，README 上挂的就是一张与界面不符的图。

# src/services/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

services/ 特有约束：

- **不 import `@deepseek-ai/cordis`，不碰 `ctx`** —— 依赖一律构造注入，否则没法用替身测。
- **配置一律现读**，不许在构造期缓存成字段；用户改设置要立刻生效。
- **凭据绝不进日志、绝不进异常消息**；日志里只允许出现引用名与 `accountTag8`。
- 任何「可能没有」的依赖（如 credentials seam）都要有回落路径，不许让它变成抛错。
- 时间、随机、环境变量都要可注入。

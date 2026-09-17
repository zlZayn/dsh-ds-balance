# ports/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

ports/ 特有约束：

- **只有类型、常量与纯函数**，不许有实现、不许 import `adapters/` 或更上层。
- 端口方法必须能用替身实现（测试里不许需要网络或宿主）。
- 任何会触碰外部世界的方法都要接受可注入的依赖（`fetchImpl` / `now` / `signal`）。
- 新增端口必须同步 [docs/backend-architecture.md](../../docs/backend-architecture.md) 的 §5。

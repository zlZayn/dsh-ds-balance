# src/domain/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

domain/ 特有约束：

- **纯逻辑**：不 import dsh 服务、不发网络请求、不碰文件系统、不读环境变量。
- 金额一律 `bigint` 最小单位；**绝不用浮点数做比较或累加**。
- 解析失败**抛错，绝不静默归 0** —— 这是契约级红线。
- 阈值只允许在本目录被读；`severity` 的输入是阈值，不是配置对象。
- 结构校验用 `ShapeError`，数值解析用 `ParseError`，两者不混用。
- 宿主半边相对导入用 `.js` 后缀（会 emit，没有 `allowImportingTsExtensions`）。
- 新增领域类型必须同步 [docs/backend-architecture.md](../../docs/backend-architecture.md) 的 §4。

# src/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

src/ 特有约束：

- 两个半体共享的只有命名空间字符串与契约类型；不许跨半体值导入。
- 宿主半边不许出现业务逻辑；本阶段它只登记 schema。
- 浏览器半边不许读 `ctx`（组件拿不到），数据一律走注册项的 `inject` 工厂或 props。
- 相对导入保留 `.ts` / `.tsx` 后缀；客户端 tsconfig 开了 `allowImportingTsExtensions`。

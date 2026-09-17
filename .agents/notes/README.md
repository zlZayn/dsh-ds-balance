# .agents/notes/ — 决策记录与备忘

- 职责：记「当时为什么这么定」，以及被这个决定排除掉的替代方案。
- 一条一档，文件名 `YYYY-MM-DD-<主题>.md`；决策类按「问题 / 决策 / 替代方案 / 影响」写，备忘类按「事实 / 处置 / 影响」写。
- **这里写死当时的事实**：它们是记录，不随代码更新；结论变了就新添一条，不改旧的。
- 现状看 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 与 [docs/README.md](../../docs/README.md)；过程流水看 git log。

## 索引

| 记录 | 结论 |
|---|---|
| [verification-recipes](2026-09-17-verification-recipes.md) | 验证配方：隔离实例、stub 上游、探针脚本，含双挂载那条坑。 |
| [integration-decisions](2026-09-17-integration-decisions.md) | 阶段 1 集成方案拍板，另附六条补充决策（设置卡片只做配置、第一版只显示余额等）。 |
| [footer-stack-override](2026-09-17-footer-stack-override.md) | 宿主 footer 容器是 row flex：插件侧用 `:has()` 反选父元素改回纵向堆叠。 |
| [collapsible-groups](2026-09-17-collapsible-groups.md) | 设置卡片改可折叠分组，默认四组全收起。 |
| [zhihu-search-alignment](2026-09-17-zhihu-search-alignment.md) | 工程面照 `dsh-zhihu-search` 对齐：批 A–J 的取舍清单。 |
| [no-linter-decision](2026-09-17-no-linter-decision.md) | 不引 lint，改用四个编译器开关顶上。 |
| [prepare-script-decision](2026-09-17-prepare-script-decision.md) | 不声明 npm `prepare`：否则 CI 的 `npm ci` 会先产出 `lib/`，看不见干净检出。 |
| [compat-lines-advisory](2026-09-17-compat-lines-advisory.md) | compat 两条线暂时都只记录、不阻断；恢复主次的判据在文内。 |
| [release-surface-landing](2026-09-17-release-surface-landing.md) | 发布面十一项落地，分「抄 / 改后抄 / 不抄」三类。 |
| [deferred-release-surface](2026-09-17-deferred-release-surface.md) | 当时暂缓的发布面项目；现已全部落地，落地记录见上一条。 |
| [implementation-deviations](2026-09-17-implementation-deviations.md) | 实现与既定文档的偏离清单，末节是六条待产品决策。 |
| [implementation-roadmap-archive](2026-09-17-implementation-roadmap-archive.md) | 实施路线与给实现 Agent 的开场白归档。 |
| [host-fetch-path-jsdoc-memo](2026-09-17-host-fetch-path-jsdoc-memo.md) | 备忘：宿主 `ConnectionFetchRoute.path` 的 JSDoc 与实现矛盾。 |

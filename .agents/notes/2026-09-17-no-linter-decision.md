# 决策：不引入 lint，改用编译器开关（2026-09-17）

已否决：本仓库不加 eslint / biome / oxlint，也不设 `lint` 脚本。

## 问题

脚本入口的约定里有一档 `lint`，本仓库一直缺。
要判的是：缺的这部分检查，是「没做」，还是「已经用别的手段做了」。

## 决策

不引入 linter。把通用 lint 里真正有价值的那一档，改成四个编译器开关，写在
[tsconfig.json](../../tsconfig.json) 的 `compilerOptions`：

- `noUnusedLocals` / `noUnusedParameters` —— 未使用的局部变量与参数。
- `noImplicitReturns` —— 有的分支返回值、有的不返回。
- `noFallthroughCasesInSwitch` —— switch 里没写 break 就落到下一个 case。

三个 project（宿主 / 客户端 / 测试）都 extends 主配置，所以一起生效，不需要第二个命令。

其余部分本来就有更准的落点：

| 通用 lint 的检查 | 本仓库的替代 |
|---|---|
| 类型错误 | `tsc --strict`（`npm run typecheck`） |
| 未使用变量 / 参数、隐式返回、switch 落穿 | 上面四个编译器开关 |
| 项目特有红线（依赖分层、导入面、产物路径…） | [test/redlines.test.ts](../../test/redlines.test.ts) |
| 文档链接、换行一致性 | `check-links.py` / `check-line-endings.py` |
| 上游契约漂移 | [test/contract-live-balance.test.ts](../../test/contract-live-balance.test.ts) |

四个开关本身也进了红线断言，理由写在测试里：缺任何一个，「不引入 lint」这个决定的覆盖面就不再成立。

## 替代方案（强制）

- **eslint + typescript-eslint**：配置与插件是一笔长期负担；而本项目的红线已经写成断言，
  比通用规则集更精准。两套规则并存时红线会分裂到两个地方，改一处查不到另一处。
- **biome / oxlint**：启动快、配置少，但解决的问题与上面同一档；
  换来一份新配置与一条新升级线，收益仍然只是「未使用变量」这一档。
- **什么都不做**：`noUnusedLocals` 这类检查是**零配置**就能拿到的，不做等于白丢一档。
  本次一开就抓到一处真实死状态，见下。

## 影响

- 代价：格式类规则（缩进、引号、import 排序）仍然没有机器兜底，靠人工与评审。
- 收益：零新增依赖、零新增配置；检查与 `npm run typecheck` 同一次跑出来，不多一条命令。
- 开启后立刻命中一处真实死状态：`BalanceService.lastErrorAt` 只写不读，已删除。
  它该不该作为对外状态暴露，记在[实现偏离清单](2026-09-17-implementation-deviations.md)的未拍板项。
- 重新评估的时机：变成多人协作，或代码量涨到评审看不完时。

## 关联

- [实现偏离清单](2026-09-17-implementation-deviations.md) · [测试手册](../../test/README.md) · [根维护索引](../../AGENTS.md)

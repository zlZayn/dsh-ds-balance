# test/ — 测试手册

- 职责：领域层与服务的单元测试。**只测纯逻辑与端口替身，不做端到端。**
- 运行方式：`npm test`（**自带 `npm run build`** —— 产物级测试要读 `lib/`）。只想跑用例时用 `npx --no-install vitest run`，但那要求 `lib/` 已是最新。
- 契约测试单独一条入口：`npm run test:contract`（要 `DSH_CI_API_KEY`，缺了回落 `DEEPSEEK_API_KEY`；打真实上游，**不进 ci.yml**）。
- 变更影响路由：改 `src/domain/` 的判定规则 → 必须同步对应测试；改契约形状 → 同步 [docs/backend-architecture.md](../docs/backend-architecture.md) §13 的测试表。
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)。

## 文件规则

- **一个被测模块一个同名测试文件**，平铺在 `test/` 下；清单以目录为准，**不在此复制**（复制必漂）。
- `redlines.test.ts` 是唯一的例外：它不是某个模块的测试，而是**把约定变成断言**。改红线等于改约定，要单独说明理由。
- `contract-key.ts` 是唯一的**非测试**文件：契约测试的凭据解析放在这里，只为让它**可单测** ——
  契约测试本体在模块加载时就 throw，那条「两个变量都空」的路径没法当用例断言。
  它的同名测试 `contract-key.test.ts` 不匹配 `contract-live-*`，因此归日常配置收，不发任何请求。

## 覆盖范围（按类别）

- 领域层：金额往返与边界、错误分类、严重度五档、币种选择、归一化与错误体解析。
- 端口替身下的服务：密钥解析优先级与回落、配置现读、余额状态机、调度退避与抖动。
- 适配器：HTTP 客户端各失败路径、存储记录往返与降级、盐文件生成与复用。
- HTTP 层：`wire` 的序列化与契约对齐、六个端点的契约行为（含 `200 + state: error`、「每次现读配置」、掩码不回传密钥）、路由表与注册形状。
- 浏览器半边：视图模型映射、severity → 环形态、mock 场景自洽性、数据层的 URL 构造与失败路径，以及**对抗旧宿主的形状守卫**（宿主没有新字段时不能把组件打挂）。
- 配置的跨字段约束：阈值成对（告急严格低于预警）—— 判据本身的边界、消费侧回落的取值、
  `POST /api/v1/config` 的写入侧先验（违反回 422），以及两个半体的默认值表对账。
- 产物级：`artifacts.test.ts` 只读 `lib/`，断言宿主入口可求值、信封 id、样式内联、`exports` 指向真实产物、设置接缝（槽名 / key / 不再出现旧服务）。
- 约定守卫：`redlines.test.ts`；**脚本自检**：`compat-swap.test.ts` 跑 `scripts/compat-swap.mjs selftest`，
  守「换版保形」那条不变量（形状表在生产脚本里，测试不重写规则）。
- 契约层：`contract-live-*.test.ts` 打真实上游核对响应指纹，由 [vitest.contract.config.ts](../vitest.contract.config.ts) 单独收集；
  日常 [vitest.config.ts](../vitest.config.ts) 显式排除它，所以 `npm test` 不会去真上游。缺凭据时它失败而不是跳过。
  凭据先取 `DSH_CI_API_KEY`、缺了回落 `DEEPSEEK_API_KEY`，判据在 [contract-key.ts](contract-key.ts)（纯函数，已被单测覆盖）。
- 待覆盖：真机端到端（要真实宿主与凭据），需要独立实例，做法见 [决策记录](../.agents/notes/2026-09-17-verification-recipes.md)。

## 约定入口

- 测试文件与被测模块同名，放平铺在 `test/` 下；**不建子目录**，直到类别超过三类再分。

# 决策：验证配方（2026-09-17）

已实施：三条配方在本项目各验证过至少一次。

## 问题

本插件的「真实验证」有三个约束，直接决定了怎么做：

- 主实例的 launch token 只在维护者终端里，Agent 拿不到，`/api/*` 一律 401。
- 宿主半边无热更，客户端半边由 HMR 立刻换新 —— 两半会版本错位。
- 上游是真实计费接口，不能让验证跑出真实调用。

## 决策

**配方一：隔离实例跑端到端。**

```powershell
$env:DSH_HOME = "<临时 home>"                 # 不复用真 home，避免两个实例共用数据
dsh --profile <新 profile> --from-default-profile web --dump-config   # 只建 profile，不启动
dsh plugin --profile <新 profile> add <仓库路径>
# 把 insert 行写进该 profile 的 cordis.patch.yml —— 是**替换**模板里的 []，不是在它后面追加
dsh --profile <新 profile> --port <空闲端口> --no-open *> server.log  # 后台跑
# token 在 server.log 里；解析进变量直接用，不要回显
```

- 界面用 Python Playwright 验（`webapp-testing` skill 的做法）。
- 首启的「内测声明」弹窗会拦截所有点击，先把它从 DOM 里摘掉再操作。
- 每次带 token 导航时服务端会重定向并丢掉 query —— **token 只在第一次登录用，之后靠 cookie 带 `?dsb=` 之类的参数**。
- 验完即删：kill 占端口的进程 + 删临时 home + 删临时脚本。

**配方二：上游用临时 stub 顶。**

- 写一个几十行的 `node:http` 服务，按官方 `/user/balance` 的形状回固定 JSON，另开 `/__set` 改状态、`/__hits` 读计数。
- 把插件配置的 `baseUrl` 指过去，就能离线驱动「余额变化 / 账户不可用 / 上游 5xx / 401」全部路径。
- **`/__hits` 是判断「这次操作有没有穿透到上游」的唯一硬证据** —— 改阈值不该让它涨。

**配方三：宿主侧探针只能落文件。**

- 宿主进程的 stdout 在维护者终端里，Agent 读不到 → 探针把结果写进系统临时目录的文件。
- **绝不在触发动作之后立刻删日志** —— watcher 可能比删除更快，证据会被自己删掉。
- 探针必须吸收打开失败、不留未观察的 rejection。
- **绝不打印凭据文件的整行**：只取捕获组或只做布尔判断。

**四件套**：`npm run typecheck` / `npm test`（自带 build）/ `check-links.py --fragments` / `check-line-endings.py --quiet`。

## 替代方案

- **直接打主实例**：拿不到 token；且未验证的构建会立刻影响正在使用的界面（符号链接安装直接写线上）。
- **只跑单测**：单测读的是函数返回值，覆盖不到宿主校验层、slot 渲染与真实存储接缝 —— 本项目两次崩溃都是单测全绿时发生的。
- **打真实上游**：有配额成本，且失败路径（401 / 429 / 5xx）无法按需复现。
- **把 token 落盘复用**：token 由服务在启动时生成、不落盘，这是平台的安全设计，不该绕。

## 影响

- 代价：一次端到端验证要起一个实例、一个 stub、一个无头浏览器，约数分钟。
- 收益：端点契约、severity 各档、错误路径、持久化读回、界面渲染都能在一次运行里核到；上游零真实调用。

## 关联

- [后端架构（修正版）](../../docs/backend-architecture.md) · [架构说明](../../docs/ARCHITECTURE.md) · [实现偏离清单](2026-09-17-implementation-deviations.md)

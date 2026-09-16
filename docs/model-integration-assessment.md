# 连接模块与官方模型机制：融合假设的验证结论

验证对象：假设「本插件的『连接』应当继承官方模型机制的配置，而不是独立配置一套」。

## 结论

**部分成立。** 必须拆成四块看，方向并不一致。

| 块 | 判定 | 一句话依据 |
|---|---|---|
| 凭据（API Key） | **成立** | 官方有同构先例，且逐字共用同一个引用名 |
| 端点（Base URL） | **不成立** | 同一个先例刻意独立端点，并写明理由 |
| 「当前 provider / 模型」 | **可继承，但本插件有硬约束** | 官方有接口，我们的槽位拿不到 |
| 余额 / 额度展示位 | 官方没有，但留了两个第三方扩展槽 | |

一句话：**该继承的是凭据，不该继承的是端点。**

---

## 一、凭据：成立

### 官方同构先例

`packages/web/web-search-deepseek/src/index.ts` 是官方另一个「在对话适配器之外调 DeepSeek REST」的插件，与本插件处境同构。

- 它共用引用名：`DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'`（`:43`），与 `llm-deepseek` 的默认**逐字相同**（`llm-deepseek/src/config.ts:13`）。
- 解析路径也一样：`ctx.get('credentials')` → `credentials.resolve(ref)`，环境层兜底（`:100-106`）。

### 接口与边界

- 宿主半边：`ctx.credentials.resolve(ref)` → `{ value, source }`（`credentials/src/index.ts:183`）。
- **浏览器半边永远拿不到值**：Remote 只有 `describe` / `set` / `unset`，`describe` 只回 `{ configured, source, writable }`（`api/settings-controller/src/credentials.ts:45-51`），文件头原文「no method here returns one」。
- 引用名的语法：`CredentialRef` 是**环境变量名形状**，`^[A-Za-z_][A-Za-z0-9_]*$`（`credentials/src/index.ts:19`）。
- `role('credential-ref')` **没有任何运行时消费点**，纯声明；只有 `role('secret')` 会被 redact 读（`settings/src/redact.ts:52`）。

### 陷阱：`deriveKeyRef` 对官方行算错

- 模型页的兜底约定是 `deriveKeyRef(provider)`（`ui-settings-models/src/client/store.ts:113-115`）。
- `deriveKeyRef('deepseek-official')` = `DEEPSEEK_OFFICIAL_API_KEY`，而官方行实际用的是 `DEEPSEEK_API_KEY`。
- **第三方盲目套这个函数会查错名字。**

---

## 二、端点：不成立（官方先例相反）

同一个 `web-search-deepseek` 刻意**不继承**对话适配器的端点：

```ts
const SEARCH_BASE_URL_ENV = 'DEEPSEEK_SEARCH_BASE_URL'   // :80
```

`:76-79` 写明了理由：

> Auxiliary-search endpoint, independent of the conversation adapter's `$DEEPSEEK_BASE_URL` and selected protocol.

它还自建了独立设置命名空间。

**含义**：官方对「旁挂 REST 消费方」的既定做法是**凭据共享、端点独立**，因为端点跟着对话适配器当时选的协议走。我们自带 `baseUrl` 不是偏离，而是遵循官方模式。

---

## 三、「当前 provider / 模型」：可继承，但有硬约束

### 它不是独立概念

「当前 provider」永远是 `{ provider, model }` 二元组的一半（`core/agent/src/model-selection.ts:15-23`）。

### 「当前」有三层语义，可能互不一致

| 层 | 读法 |
|---|---|
| 进程默认 | `ctx.agentDefaultModel.currentSelection()` |
| 会话「下一请求将用」 | `modelSelection` 投影的 `next` |
| 会话「最后一次真实请求」 | `session.requestHeader()?.config` |

官方自己的折叠顺序（`api/session-controller/src/agent.ts:283-302`，可直接照抄）：

```
pending → 最后一次 request header → 进程默认
```

### 切换信号

- **没有任何宿主事件专门广播「模型切换」。**
- 唯一写入点：`agent.ts:327` 的 `session.append('model/selection', selection)`。
- 浏览器侧**不需要监听事件**：`modelSelection` 投影本身就是信号，订阅它即可。
- 客户端可订阅的宿主事件白名单共 20 条，与模型/provider 相关的只有 `llm/adapters-updated` 与 `settings/document-updated`。
- `/model` 弹窗与 composer 座位**同一条路径**（共用 `ModelDirectory`），不会给出不同信号。

### 我们槽位的硬约束

- `sidebar.footer.action` 是 **`root` 作用域**，**没有 `useProjection`**。
- 能用的只有 `useSessions` / `useSessionPendingInteraction` / `useWorkspaces` / `usePanelInfo` / `useStore` / `t`。
- 要跟会话模型，两条路：
  - **路 1**：`useSessions(s => s.current)` 拿 session id → `ctx.sessions.binding(id)?.session.projections.faceOf('modelSelection')` → 经注册项的 `inject` 工厂转成 hook。**代价**：需要新增类型依赖 `@deepseek-ai/dsh-api-session-controller`（本仓未装）。
  - **路 2**：不跟会话，直接用 `ctx.remote.session.modelCatalog()` 的 `default`（进程默认）。

### API 陷阱

`llm.listModels(provider)` **不是 `@Remote`，客户端调不到**。`llm` 服务全仓只有三个 `@Remote`：`listProviders` / `listConfigurableProviders` / `discoverModels`。

---

## 四、余额展示位：官方没有，但留了两个槽

三种检索路径（`packages/client` 全目录、已构建前端 dist、官方宿主包）对 balance / quota / credit / 余额 全部 **0 命中**。harness 从不调用 DeepSeek 余额接口。

可用的第三方扩展槽（`ui-settings-models/src/client/slot-contract.ts`）：

| 槽 | 类型 | key |
|---|---|---|
| `settings.models.provider-card` | keyed | 该行的设置命名空间；官方 deepseek 行是 `llm-deepseek` |
| `settings.models.footer` | list | 排在 provider 行与新增控件之后 |

- 两者 `replaceRisk` 都是 `none`，`occupants` 都为空。
- owner props：`{ provider, configured, keyConfigured }`。
- 官方原文：这是「a plugin distributed outside this repository adds UI to the Models settings section without editing it」的两个席位。

---

## 五、「插件不该重复配置 provider」：没有明文禁令，三条间接约定

1. **类型层**：`GenerateOptions` 与 `LlmCallConfig` **都没有连接字段** → 结构上无法自带连接。
2. **机制层**：一条路由只能挂一个适配器，重复抛 `DUPLICATE_ADAPTER` → 想自带连接就必须自造路由键，与用户目录分叉。
3. **行为层**（最强）：官方旁挂 LLM 消费方**优先继承已记录的路由**，显式配置只是覆盖（`session-title-llm/src/index.ts:173-185`）。

**未找到**任何一句写死的「插件不得自带 provider / baseUrl」。

---

## 六、多 provider 与「余额跟随什么」

- 官方**完全没有账户 / 余额 / 配额 / 计费概念**：`balance` / `account` 在 harness 里全指 token 配对平衡与工作区记账。
- DeepSeek 适配器只有两个基址，**没有余额端点**。
- **唯一有官方依据的分组键**：`provider route` 就是**凭证的 owner id**（`credentials/src/index.ts:65,109`）。
  - 所以「余额按 provider route 分组」站得住。
  - 「余额按模型分组」**没有依据**。
- 本机实测（`$DSH_HOME/settings.yaml`）：
  - `agent-default-model` = `{ provider: deepseek-official, model: deepseek-flash }`。
  - `llm-pi-ai` 另有一个 provider `opencode-go`（`apiKeyEnv: OPENCODE_API_KEY`）。
  - `llm-deepseek` **没有覆盖 `apiKeyEnv` 与 `baseURL`**，所以走默认 `DEEPSEEK_API_KEY` 与默认端点。

---

## 七、对本插件的直接影响（含两个已确认缺陷）

1. **`apiKeyRef` 默认值不合法**：`src/index.ts` 用 `default('deepseek-api-key')`，但引用名要求 `^[A-Za-z_][A-Za-z0-9_]*$`，**连字符非法**。要用官方凭据，默认值必须是 `DEEPSEEK_API_KEY`。
2. **宿主半边 `inject` 只有 `['settings']`**：要读凭据必须再加 `'credentials'`。
3. 本机 `.credentials.yaml` 的 `refs` 里**没有 `DEEPSEEK_API_KEY`**（只有飞书 / OpenCode / 知乎三条），四个可能的 `.env` 也都不存在。
   - 所以 key 只可能来自**宿主进程的启动环境**。
   - 若如此，`describe().writable` 可能为 `false`（环境层只读），我们的卡片就不该允许用户覆盖它 —— **待验证**。

---

## 八、待验证（未实跑，不许当成结论）

1. **`ctx.credentials.resolve('DEEPSEEK_API_KEY')` 在宿主半边是否真的命中** —— 这是「复用官方凭据」成立与否的**唯一硬证据**，必须在宿主进程里实测。
2. 加 `inject: ['credentials']` 后在无 credentials seam 的装配下会拿到什么。
3. `ctx.settings.get('llm-deepseek')` 的返回形状是否稳定 —— 由那个包的私有 schema 决定，且**跨包读别人命名空间全仓无生产先例**。
4. 环境层供应时 `describe().writable` 是否为 `false`。
5. `settings.models.provider-card` 的实际观感（位置与间距）—— 未跑起来看过。
6. ACP 模型控制是否走同一条 `selectModel` 路径。

---

## 九、未找到

- **未找到**任何「插件不得自带 provider / baseUrl」的明文禁令。
- **未找到**跨包读别人设置命名空间的生产先例（`ctx.settings.get(ns)` 的唯一生产命中是 `ui-theme` 读自己的命名空间）。
- **未找到**官方的账户 / 余额 / 配额概念与展示位。
- **未找到**社区插件 `dsh-model-balance` 与 `dsh-model-catalog-sync`：六个位置、四组关键词全 0 命中（已装插件含全部 scope、npm 全局 244 个包、`D:\ProjectSomething` 深度 6、`%DSH_HOME%` 全域、pnpm store、本机插件市场历史 59 行）。**本机不存在这两个插件**，本文不对它们的行为作任何陈述。

---

## 参考

- 原始勘察（临时目录，被 `.gitignore` 忽略）：`recon/13-model-provider-api.md` / `recon/14-credentials-and-model-page.md` / `recon/15-active-model-and-signals.md`
- 本插件的后端契约 → [UI 侧契约与移交](ui-handoff.md)
- 原生集成勘察 → [原生 UI 与插件机制勘察](recon-native-integration.md)

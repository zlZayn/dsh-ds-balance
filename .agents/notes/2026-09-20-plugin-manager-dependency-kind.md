# plugin-manager 的依赖形态：类型面必需、运行时不必需 → 只留 dev

## 问题

`@deepseek-ai/dsh-client-ui-plugin-manager` 同时声明在 `peerDependencies` 与 `devDependencies`，
但它**在 npm 上没有 `next` 版本**（只有 `latest` 与 `alpha`，都是 `0.1.6-alpha.2`）。
按兼容性巡检的判定（peer 里点名的包在某条线上没有版本 → 失败），`next` 线**每周必红**，
而且症状看起来像安装 / peer 冲突，不是"这个包没发到那条线"。

先要回答的是：这个包到底是不是运行时依赖？

## 事实（本次实读）

- 全仓搜索该包名，**源码里唯一的引用**是 `src/client/index.tsx:19` 的
  `import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'` ——
  **空花括号 + `type`**：不导入任何值，编译后整行消失。**所以不是运行时依赖。**
- 但它**不是装饰**：该包带 module augmentation，安装目录里
  `lib/types/client/index.d.ts` 有 `declare module '@deepseek-ai/dsh-client-ui-slots' { … }` ——
  正是它把 `plugins.bundle.config` 槽键合进 SlotMap。源码注释也写着「类型导入即声明」。
- 运行时关系本来就不靠 peer：两仓都在 `package.json` 的 `dsh.client.inject` 里声明了它，
  那是浏览器半体的装载顺序契约。

## 决策

**从 `peerDependencies` 移除，保留在 `devDependencies`。**

1. 运行时关系由 `dsh.client.inject` 表达，peer 是重复声明。
2. 类型面仍然需要它可解析（否则 `tsc` 报 TS2307），dev 覆盖这一点。
3. `scripts/compat-swap.mjs` 采用分档判定：**peer 缺失 = 失败；仅 dev 缺失 = 告警并跳过**。
   于是 `next` 线不再因为这个包而红 —— 它确实不影响使用者装本插件。

`dsh-zhihu-search` 同批同选（同一个上游事实，两仓不能一个说法）。

## 替代方案

- **保留 peer + `peerDependenciesMeta.optional: true`** —— 可行，但语义绕一层：
  "宿主应提供"与"缺了也不算错"同时表达，而这门依赖本来就不需要宿主提供（运行时不用它）。
- **保留现状，在 compat 里记成"上游未就绪"的已知例外** —— 否。每周红靠豁免消化，
  等于把判定从"事实"降级成"人记得"。例外一旦不写理由就会变成永久噪音。
- **连 dev 一起删** —— 否。`import type {}` 也要能解析模块，删了 `tsc` 直接挂。
- **把 `import type {}` 那行删掉** —— 否。删了就丢了槽键的类型契约，
  注册 `plugins.bundle.config` 时类型不再被检查。

## 影响

- 本仓红线的依赖分层那条加了一句注释说明这个例外（`@deepseek-ai/dsh-*` 只留 dev 是允许的）。
- `compat-swap.mjs` 的 `swap` 与 `verify` 都改成按声明位置分档，并在输出里打印跳过项 ——
  **跳过必须可见**，否则"绿"会掩盖"某条线上这个包根本没装"。
- 该改动同时影响两仓；若将来上游把它发到 `next`，把 dev 声明抬上去即可，不需要恢复 peer。

## 补记（2026-09-22）：判据从「一条」升级成「两条」

本文上半只写了一条判据 —— 「只做类型面 → 只写 dev」。它**解释不了 `@deepseek-ai/dsh-client-ui-settings`
为什么在 `peerDependencies` 里**：那个包从第一个提交（`626e074` 工程骨架）起就**同时在 peer 与 dev**
（`package.json` 现查，两处都是 `>=0.1.7-alpha.1`）。**规则与现状对不上时，下一个人会照规则把它删掉** ——
同一轮里另一个插件仓就差点真删。

### 事实（本次实读）

- **它是 `configForms` 这个服务的提供方**：宿主 `packages/client/ui-settings/src/client/config-form.ts:241`
  `export class ConfigForms extends Service`、`:266` `super(ctx, 'configForms')`（行号以当前检出为准）。
- **本仓在运行时真的消费它**：`src/client/config-slot.ts:93` 用它判「服务到没到位」，
  `src/client/settings/use-config-form.ts:6` 真的 `ctx.configForms.get(ENTRY_ID)`。
- **运行时关系不是靠 `dsh.client.inject` 表达的**：本仓的 `inject` 里**只有**
  `@deepseek-ai/dsh-client-ui-plugin-manager`（plugin-manager 那条正是靠它表达的）—— ui-settings 不在里面。
  所以这条关系**只剩 peer 一个落点**。
- **同一份文件里也有类型面**：`use-config-form.ts:17` 的
  `import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'` ——
  **两种关系同时成立**，这正是旧写法会把人带偏的地方（它只描述了后一种）。

### 决策：判据看「我们与它的关系」，不看它住在哪一侧

1. **只做类型面（module augmentation）、我们不消费它提供的服务** → 只写 `devDependencies`。
2. **我们消费它提供的服务（运行时真的要用）** → 必须 `peerDependencies`（外加同版本 dev，红线钉着版本相等）——
   装载器得把它与我们装在同一棵树里，否则 `ctx.<服务>` 在运行期就是 undefined。

两类可以同时成立（`dsh-client-ui-settings` 就是）。**同时成立就两边都写** ——
旧写法把「怎么引用」当成唯一判据，于是把这一类的 peer 声明读成了误植。

### 替代方案

- **「凡 `import type` 就只留 dev」** —— 否。照它做，装在缺 ui-settings 的 profile 上，
  配置卡片会**静默不渲染**（缺服务的表现是「什么都不出现」，不是报错）。
- **「凡 `@deepseek-ai/dsh-*` 一律 peer」** —— 否。本文上半已经给出反例：plugin-manager 运行时不必需，
  而它在某条线上没有版本会让兼容巡检每周必红。
- **靠断言兜住这条** —— 做不到，**已实测**：`test/redlines.test.ts` 现有三条是**单向**的 ——
  遍历 peer 要求每个 peer 都有同版本 dev、禁止官方包进 `dependencies`。
  **「某个服务提供方根本没被声明」它们一条也覆盖不到**，全绿不构成判据。
  要补断言得先有「本仓消费了哪些服务」的可查来源（目前只有 `ctx.inject([...])` 的实参一处），另案。

### 影响

- 根 [AGENTS.md](../../AGENTS.md) 的依赖类别规则改成上面两条判据，并点名 `dsh-client-ui-settings` 属于第二类。
- `package.json` **没动**（两处声明本来就在）、断言**没动** —— 这次只改规则文字。
- **不推翻**本文上半的决策：plugin-manager 仍然只留 dev，理由不变；变的是**判据的完整写法**。

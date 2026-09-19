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

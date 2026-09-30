import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  // 客户端半边用**自动 JSX 运行时**（tsconfig.client.json 的 `jsx: "react-jsx"`），
  // 而根 tsconfig.json 不设 jsx（它管宿主半边与测试）。不在这里对齐的话，
  // 测试里 import 任何 .tsx 组件都会报 `React is not defined` ——
  // 于是「渲染真组件」这条验证路径整条不可用（本轮之前就是这样，所以只能读表）。
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/**/*.test.ts'],
    // 契约测试打真实上游，要凭据、要配额；它有独立的 vitest.contract.config.ts。
    // 漏在这里会让 npm test 在无凭据环境下直接失败。
    // 其余排除项取官方默认值 —— 手抄一份清单，官方加一项我们就漏一项。
    exclude: [...configDefaults.exclude, 'test/contract-live-*.test.ts'],
    environment: 'node',
    // **不要**为了渲染 ui-primitives 的组件（Tooltip / StateDot）而加
    // `server.deps.inline`：那会把它的整棵依赖树拖进 vite 处理，
    // 它自己的传递依赖（`@deepseek-ai/dsh-util-workspace-path` 等）并没有随包发全，
    // 于是报「Failed to load url ... Does the file exist?」—— 从「渲不出来」
    // 变成「测试根本起不来」，更糟。
    // 现在能渲的只有不引 ui-primitives 的组件（如 PercentRing）；这已经够用来
    // 钉「处境 → 环」的形态不变量（render-matrix.test.ts）。要渲浮层得等
    // 测试环境具备解决上游 CSS/依赖的能力，不该在本轮顺手塞一个半成品。
  },
})

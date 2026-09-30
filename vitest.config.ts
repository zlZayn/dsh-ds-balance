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
  },
})

## Postmortem: 浏览器半体产物覆盖宿主模块导致 DSH 启动崩溃（2026-09-17）

- 摘要：`npm run build` 的 esbuild 步骤把 `lib/client.js` 写成浏览器信封，而该路径本是宿主传输层 `src/client.ts` 的编译产物。宿主启动即 `SyntaxError`，模块解析不到导出。当时全部单元测试仍然是绿的。
- 时间线：UI 实现提交（04:04）前后新增 `scripts/build-client.mjs`，`outfile: 'lib/client.js'` → 首次 build 覆盖生效 → 宿主启动崩溃 → 清理 profile 的 patch 行恢复。**精确时刻未记录**，证据是构建脚本里的守卫与根 AGENTS.md 的活跃坑。
- 根因：`tsc`（`rootDir: src` → `outDir: lib`）与 esbuild 的 `outfile` 指向同一路径，**没有任何机制**让后跑的步骤发现它覆盖了前者的产物。
- 防再犯：`scripts/build-client.mjs` 启动时若发现 `src/client.ts` / `src/client.tsx` 存在就直接报错；`test/redlines.test.ts` 断言这两个文件不存在；`test/artifacts.test.ts` 断言 `lib/client.js` 必须是信封且没有同名的宿主编译产物。
- 关联：[架构说明](../ARCHITECTURE.md) · [构建脚本手册](../../scripts/README.md)

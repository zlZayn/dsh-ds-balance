/**
 * 打包浏览器半体。
 *
 * 产物必须是 DSH 客户端模块系统的 lazy-CJS factory 形态：
 * 脚本执行时只**注册**工厂，模块体（含副作用）留到首次 require。
 *
 *     window.__ModuleLoader__.load({ id, factory: (require) => ({ ... }) })
 *
 * 官方在仓库内用 `packages/client/tsdown.client.ts` 的 `clientBundle()` 生成这个信封，
 * 但该预设未发布到 npm（官方 cookbook 明写「a package outside this repository has to
 * reproduce the same output format itself」），所以这里用 esbuild 复现。
 *
 * 两件事必须自己接上：
 * 1. CSS Modules 需要显式 `loader: { '.css': 'local-css' }`，否则 `import css` 拿到 `{}`。
 * 2. esbuild 把 CSS 抽成独立文件，而 DSH 要求样式在 factory 执行时注入
 *    `<style data-plugin="<包名>">` —— HMR 的 `removeOwnedStyles` 按该属性逐字匹配来清理。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

// 路径冲突守卫：tsc 把 src/<name>.ts 编译到 lib/<name>.js，rootDir 是 src、outDir 是 lib。
// 若存在 src/client.ts，它会与本脚本的 outfile 同名 —— 后跑的一方静默覆盖另一方。
// 这个冲突真实发生过：lib/client.js 被浏览器信封顶掉后，宿主侧 import 拿到信封，
// DSH 启动即 SyntaxError 崩溃。
for (const stale of ['src/client.ts', 'src/client.tsx']) {
  if (existsSync(stale)) {
    throw new Error(
      `${stale} 与浏览器半体的输出路径 lib/client.js 冲突：请把它改名或移进 src/client/。`,
    );
  }
}

/** bundle id 必须等于包名：模块表以它作 key，HMR 也按它清理样式。真源是 package.json 的 name。 */
const BUNDLE_ID = JSON.parse(readFileSync('package.json', 'utf8')).name;

/** 样式标签的 id；前缀必须是包名，便于排查。 */
const STYLE_TAG_ID = `${BUNDLE_ID}/client.css`;

/** 宿主基线模块与同侪包，一律不打包进去。 */
const HOST_PROVIDED = ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', '@deepseek-ai/*'];

/** 构建期占位符，构建后替换成真正的样式注入代码。 */
const CSS_PLACEHOLDER = '/*__DSB_STYLE_INJECTION__*/';

/**
 * 生成样式注入代码。形状照 `packages/client/tsdown.client.ts:37-56`：
 * 重复注入用 querySelector 挡住，标签同时带 `data-plugin`（HMR 清理用）
 * 与 `data-plugin-css`（模块系统记账用）。
 */
function styleInjection(cssText) {
  return [
    `var __dsbCss = ${JSON.stringify(cssText)};`,
    `var __dsbTagId = ${JSON.stringify(STYLE_TAG_ID)};`,
    `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + __dsbTagId + '"]') === null) {`,
    `  var __dsbTag = document.createElement('style');`,
    `  __dsbTag.dataset.plugin = ${JSON.stringify(BUNDLE_ID)};`,
    `  __dsbTag.dataset.pluginCss = __dsbTagId;`,
    `  __dsbTag.textContent = __dsbCss;`,
    `  document.head.appendChild(__dsbTag);`,
    `}`,
  ].join('\n');
}

const result = await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  legalComments: 'none',
  external: HOST_PROVIDED,
  loader: { '.css': 'local-css' },
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      `\tid: ${JSON.stringify(BUNDLE_ID)},`,
      '\tfactory: (require) => {',
      '\t\tvar module = { exports: {} };',
      '\t\tvar exports = module.exports;',
    ].join('\n'),
  },
  footer: { js: `\t\t${CSS_PLACEHOLDER}\n\t\treturn module.exports;\n\t}\n});` },
});

const jsOutput = result.outputFiles.find((file) => file.path.endsWith('.js'));
const cssOutput = result.outputFiles.find((file) => file.path.endsWith('.css'));
if (jsOutput === undefined) throw new Error('esbuild 没有产出 JS 文件。');
if (!jsOutput.text.includes(CSS_PLACEHOLDER)) {
  throw new Error('footer 占位符丢失：esbuild 的 footer 行为变了，请检查构建脚本。');
}

const cssText = cssOutput?.text ?? '';
const bundle = jsOutput.text.replace(CSS_PLACEHOLDER, styleInjection(cssText));

mkdirSync('lib', { recursive: true });
writeFileSync('lib/client.js', bundle);

console.log(
  `built lib/client.js as module ${BUNDLE_ID} (styles inlined: ${cssText.length} bytes)`,
);

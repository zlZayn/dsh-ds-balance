import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 产物级测试：读 `lib/`，不看 `src/`。
 *
 * 拦的是「源码对但产物错」那一类事故 —— 单元测试读的是函数返回值，覆盖不到构建链。
 * **依赖 `npm run build` 先跑过**；`npm test` 自带 build，直接跑 vitest 时需要先构建。
 */

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  name: string
  exports: Record<string, { types?: string; import?: string; default?: string }>
  dsh?: { client?: { platform?: string; inject?: string[] } }
}

/**
 * 本插件那一行的 Loader 条目 id —— 0.1.7 起它同时是设置命名空间。
 * 真源是 package.json 的 name，而 `cordis.patch.yml` 的行 id 必须与它逐字相同。
 */
const ENTRY_ID = 'dsh-ds-balance'

/** `plugins.row.config` 的 key：宿主 `rowConfigKey(bundle, rowId)` 逐字是 `<包名>#<行 id>`。 */
const ROW_CONFIG_KEY = ENTRY_ID + '#' + ENTRY_ID

const MISSING = 'lib/ 里没有产物：先跑 `npm run build`（`npm test` 自带这一步）'

describe('构建产物', () => {
  it('宿主入口与浏览器信封都已生成', () => {
    expect(existsSync('lib/index.js'), MISSING).toBe(true)
    expect(existsSync('lib/client.js'), MISSING).toBe(true)
  })

  it('宿主入口能被求值，并导出契约面', async () => {
    const host = (await import('../lib/index.js')) as Record<string, unknown>
    expect(host.name).toBe('ds-balance')
    // settings 仍在：0.1.7 起它不再是「登记命名空间」而是唯一的写入口
    // （ctx.settings.mutate），见 src/index.ts 的 inject 注释。
    expect(host.inject).toEqual(['settings', 'credentials'])
    expect(typeof host.apply).toBe('function')
    expect(host.ENTRY_ID).toBe(ENTRY_ID)
    expect(host.CURRENCY_AUTO).toBe('auto')
    expect(host.Config).toBeTruthy()
  })

  it('ENTRY_ID 与包名、patch 行 id 三者逐字一致', () => {
    // 宿主半边写设置、浏览器半边读表单、plugins.row.config 的 key 都按它索引。
    // 漂开的表现分两种：key 错 ⇒ 那一行没有 Configure 控件；id 错 ⇒ 控件在、点进去拿不到 form。
    expect(pkg.name).toBe(ENTRY_ID)
    const patch = readFileSync('cordis.patch.yml', 'utf8')
    const rowId = /^\s*-\s*id:\s*(\S+)\s*$/m.exec(patch)?.[1]
    expect(rowId, 'cordis.patch.yml 里找不到 insert 行的 id').toBe(ENTRY_ID)
  })

  it('插件的服务门禁不含可选服务（缺它只该丢掉那一半功能）', async () => {
    const host = (await import('../lib/index.js')) as { inject: string[] }
    // connection 与 storageDomain 都由 apply 内的 ctx.inject 把门；
    // 列进顶层 inject 会让缺服务的装配整个插件不装载。
    expect(host.inject).not.toContain('connection')
    expect(host.inject).not.toContain('storageDomain')
  })

  it('浏览器信封的模块 id 等于包名', () => {
    const bundle = readFileSync('lib/client.js', 'utf8')
    expect(bundle.startsWith('window.__ModuleLoader__.load(')).toBe(true)
    expect(bundle).toContain('id: ' + JSON.stringify(pkg.name))
  })

  it('配置卡片挂在该行的 plugins.row.config 上，key 逐字 <包名>#<行 id>', () => {
    const bundle = readFileSync('lib/client.js', 'utf8')
    // 宿主按 rowConfigKey(包名, 行 id) 取这一格；key 写错就整块不出现，也不会报错。
    expect(bundle).toContain('plugins.row.config')
    // 产物里的 key 是一个具名常量（esbuild 不把它内联进注册项），所以这里断言的是
    // 「这串键在产物里」。注册项确实用的是它、且槽名与推导都对，由
    // redlines.test.ts 的源码级断言补上。
    expect(bundle).toContain(ROW_CONFIG_KEY)
    // bundle 那一格**还在宿主里**，但我们有意不注册它：它渲染时不带 form，
    // 挂上去会是「槽在、key 对、卡片没数据」。留着这个字符串就说明改回去了。
    expect(bundle).not.toContain('plugins.bundle.config')
    // 早已退场的槽名，留着等于卡片在活界面上不渲染。
    expect(bundle).not.toContain('settings.plugin.item')
    // 0.1.7 删掉的客户端服务：它一旦回到 inject 里，apply 会静默不执行（整块功能消失）。
    expect(bundle).not.toContain('settingsScope')
    // 槽的 owner props 是两视图：page 出表单，summary 出该行的说明行。
    expect(bundle).toContain('case "page"')
    expect(bundle).toContain('case "summary"')
  })

  it('浏览器信封把样式内联回 factory（DSH 不加载独立的 css 文件）', () => {
    const bundle = readFileSync('lib/client.js', 'utf8')
    expect(bundle).toContain('data-plugin-css')
    expect(existsSync('lib/client.css')).toBe(false)
  })

  it('exports 与 dsh.client 指向真实存在的产物', () => {
    expect(existsSync(pkg.exports['./client']!.default!)).toBe(true)
    expect(existsSync(pkg.exports['./client']!.types!)).toBe(true)
    expect(pkg.exports['.']!.import).toBe('./lib/index.js')
    expect(existsSync(pkg.exports['.']!.types!)).toBe(true)
    expect(pkg.dsh?.client?.platform).toBe('web')
  })

  it('没有别的模块占掉 lib/client.js 这个路径', () => {
    // src/client.ts(x) 会让宿主 tsc 也往 lib/client.js 写，历史上直接让宿主启动 SyntaxError。
    // 断言：那个文件必须是信封，且不存在与它同名的宿主编译产物。
    const bundle = readFileSync('lib/client.js', 'utf8')
    expect(bundle.startsWith('window.__ModuleLoader__.load(')).toBe(true)
    expect(existsSync('lib/client.d.ts')).toBe(false)
    expect(existsSync('lib/types/client.d.ts')).toBe(false)
  })
})

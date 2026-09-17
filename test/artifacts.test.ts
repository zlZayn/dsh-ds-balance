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

const MISSING = 'lib/ 里没有产物：先跑 `npm run build`（`npm test` 自带这一步）'

describe('构建产物', () => {
  it('宿主入口与浏览器信封都已生成', () => {
    expect(existsSync('lib/index.js'), MISSING).toBe(true)
    expect(existsSync('lib/client.js'), MISSING).toBe(true)
  })

  it('宿主入口能被求值，并导出契约面', async () => {
    const host = (await import('../lib/index.js')) as Record<string, unknown>
    expect(host.name).toBe('ds-balance')
    expect(host.inject).toEqual(['settings', 'credentials'])
    expect(typeof host.apply).toBe('function')
    expect(host.SETTINGS_NAMESPACE).toBe('ds-balance')
    expect(host.CURRENCY_AUTO).toBe('auto')
    expect(host.Config).toBeTruthy()
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

  it('配置卡片挂在 Plugins 页的 bundle 槽上，key 逐字等于包名', () => {
    const bundle = readFileSync('lib/client.js', 'utf8')
    // 宿主的 bundle 详情页按包名取这一格；key 写错就整块不出现，也不会报错。
    expect(bundle).toContain('plugins.bundle.config')
    expect(bundle).toContain('key: ' + JSON.stringify(pkg.name))
    // 旧槽已被宿主整体删除 —— 留着它等于卡片在活界面上不渲染。
    expect(bundle).not.toContain('settings.plugin.item')
    // 槽的 owner props 是两视图：page 出表单，summary 留空返回 null。
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

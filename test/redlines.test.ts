import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 红线：把口头约定变成断言。
 *
 * 每条都对应一次真实事故或一次已裁决的决定；改红线等于改约定，要单独说明理由。
 */

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, any>

/** 去掉块注释与行注释，避免注释里的字样触发守卫。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('依赖分层', () => {
  it('@deepseek-ai/* 绝不进 dependencies', () => {
    const runtime = Object.keys(pkg.dependencies ?? {})
    const official = runtime.filter((name) => name.startsWith('@deepseek-ai/'))
    expect(official).toEqual([])
  })

  it('每个 @deepseek-ai/* 平台包都同时在 peer 与 dev', () => {
    const peers = Object.keys(pkg.peerDependencies ?? {}).filter((name) => name.startsWith('@deepseek-ai/'))
    for (const name of peers) {
      expect(pkg.devDependencies?.[name], `${name} 缺 devDependency，本地类型检查会挂`).toBeTruthy()
    }
  })

  it('运行时依赖只有普通 npm 库', () => {
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      expect(name.startsWith('@deepseek-ai/'), `${name} 是官方包，应走 peer`).toBe(false)
    }
  })
})

describe('插件清单', () => {
  it('声明宿主兼容范围', () => {
    expect(typeof pkg.engines?.dsh).toBe('string')
    expect(typeof pkg.engines?.node).toBe('string')
  })

  it('客户端入口是 exports["./client"]', () => {
    expect(pkg.exports?.['./client']?.default).toBe('./lib/client.js')
    expect(pkg.dsh?.client?.platform).toBe('web')
  })

  it('dsh.client.inject 只列真实客户端图行', () => {
    const inject: string[] = pkg.dsh?.client?.inject ?? []
    // 这两个是 staticLinked 平台模块，列进去会被运行期静默跳过。
    expect(inject).not.toContain('@deepseek-ai/dsh-client-ui-slots')
    expect(inject).not.toContain('@deepseek-ai/dsh-client-ui-primitives')
  })

  it('发布产物含 bundle 清单要用的文件', () => {
    expect(pkg.files).toContain('lib')
    expect(pkg.files).toContain('cordis.patch.yml')
    expect(pkg.files).toContain('LICENSE')
  })

  it('dsh.bundle 的有无必须与 private 一致（否则被 dsh plugin 回填成双挂载）', () => {
    // 声明了它的已装包会被写回 profile 的 dsh.profile.bundles，与 patch 层的 insert 行
    // 形成双挂载 —— bundles 只在启动时读，所以下次重启才炸。
    // 所以这条不变量跟着 private 走：开发期（private）不许有，发布态必须有。
    // 两态各自的完整断言在 scripts/check-release.mjs 里。
    if (pkg.private === true) {
      expect(pkg.dsh?.bundle).toBeUndefined()
      return
    }
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  })
})

describe('构建链守卫', () => {
  it('不存在与 lib/client.js 抢路径的源码', () => {
    expect(existsSync('src/client.ts')).toBe(false)
    expect(existsSync('src/client.tsx')).toBe(false)
  })

  const buildScript = readFileSync('scripts/build-client.mjs', 'utf8')

  it('CSS Modules 必须显式开 local-css（否则类名全是 undefined）', () => {
    expect(buildScript).toContain("'.css': 'local-css'")
  })

  it('样式必须内联回 factory（DSH 不加载 lib/client.css）', () => {
    expect(buildScript).toContain('data-plugin-css')
    expect(buildScript).toContain('__DSB_STYLE_INJECTION__')
  })

  it('信封 id 必须等于包名', () => {
    expect(buildScript).toContain(`const BUNDLE_ID = '${pkg.name}'`)
  })
})

describe('宿主半边写法', () => {
  const entry = stripComments(readFileSync('src/index.ts', 'utf8'))

  it('不许用 ctx.get 取服务（绕过 inject 门禁，跨挂载位置不可靠）', () => {
    expect(entry).not.toMatch(/ctx\.get\(/)
  })

  it('inject 里列出 credentials（凭据继承官方）', () => {
    expect(entry).toMatch(/inject = \[[^\]]*'credentials'/)
  })
})

describe('类型检查开关', () => {
  const tsconfig = JSON.parse(stripComments(readFileSync('tsconfig.json', 'utf8'))) as {
    compilerOptions?: Record<string, unknown>
  }

  it('四个「通用 lint 那一档」的开关都在', () => {
    // 它们是不引入 linter 这个决定的全部依据：缺任何一个，覆盖面就不再成立。
    // 见 .agents/notes/2026-09-17-no-linter-decision.md。
    const flags = ['noUnusedLocals', 'noUnusedParameters', 'noImplicitReturns', 'noFallthroughCasesInSwitch']
    for (const flag of flags) {
      expect(tsconfig.compilerOptions?.[flag], flag).toBe(true)
    }
  })
})

describe('UI 约定', () => {
  it('侧栏底部按钮不写 aria-haspopup（邻居的 DOM 遍历会先命中我们）', () => {
    const files = ['src/client/sidebar/SidebarBalance.tsx', 'src/client/sidebar/BalancePopover.tsx']
    for (const file of files) {
      expect(stripComments(readFileSync(file, 'utf8'))).not.toContain('aria-haspopup')
    }
  })
})

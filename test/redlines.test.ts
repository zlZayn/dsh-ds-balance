import { existsSync, readFileSync, readdirSync } from 'node:fs'
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

  it('每个 @deepseek-ai/* 平台包都同时在 peer 与 dev，且版本逐条相等', () => {
    // 版本相等不是洁癖：peer 与 dev 一旦漂开，本地类型检查通过的版本与
    // 声明给使用者的版本就不是同一个，红线会假绿。2026-09-20 起从「存在」升级为「相等」。
    // 例外：只做类型面依赖、不需要宿主在运行时提供的包可以只留 dev ——
    // 目前只有 @deepseek-ai/dsh-client-ui-plugin-manager（它只提供 module augmentation，
    // 且运行时关系由 dsh.client.inject 表达）。见 .agents/notes/2026-09-20-plugin-manager-dependency-kind.md。
    const peers = Object.keys(pkg.peerDependencies ?? {}).filter((name) => name.startsWith('@deepseek-ai/'))
    const devs = pkg.devDependencies ?? {}
    for (const name of peers) {
      expect(devs[name], `${name} 缺 devDependency，本地类型检查会挂`).toBeTruthy()
      expect(devs[name], `${name} 的 peer 与 dev 版本不一致`).toBe(pkg.peerDependencies[name])
    }
  })

  it('运行时依赖只有普通 npm 库', () => {
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      expect(name.startsWith('@deepseek-ai/'), `${name} 是官方包，应走 peer`).toBe(false)
    }
  })
})

describe('锁文件', () => {
  it('resolved 必须指向官方源', () => {
    // 镜像生成的锁文件会让 CI 去镜像取包（供应链隐患），而且 `npm ci` 可能因 peer 未同步而失败。
    // 这条以前只写在 docs/PUBLISHING.md 的散文里 —— 规则住在文字里就没人执行，
    // 所以 2026-09-20 落成断言（当时 balance 实测 129/131 条走 registry.npmmirror.com）。
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages?: Record<string, { resolved?: string }>
    }
    const offenders = Object.entries(lock.packages ?? {})
      // 只看 http(s) 来源；file:/link:/git 之类本就不是包的公开源。
      .filter(([, meta]) => meta.resolved?.startsWith('http'))
      .filter(([, meta]) => !meta.resolved!.startsWith('https://registry.npmjs.org/'))
      .map(([name, meta]) => `${name || '(root)'} → ${new URL(meta.resolved!).host}`)
    expect(offenders, `这些包的 resolved 不指向官方源：\n${offenders.join('\n')}`).toEqual([])
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

describe('文档不抄实测值', () => {
  /**
   * 记录类：写的就是当时的事实，**故意**带着会漂的值，所以不在约束范围内。
   * 判据是「它写的是此刻还是当时」—— 被当现状读的才算活文档；层的登记表在 docs/README.md。
   */
  const RECORDS = [
    /^\.agents\/notes\//,
    /^docs\/postmortem\//,
    /^docs\/recon-/,
    /^docs\/(ui-handoff|model-integration-assessment|backend-architecture-review)\.md$/,
  ]

  /** 门面双件：装之前必须看得见兼容范围，所以允许留值 —— 但必须与真源同行。 */
  const FACADE = ['README.md', 'README_en.md']

  /** 真源。留值的那一行必须自己写出处。 */
  const HOME = 'package.json'

  /**
   * 会漂的宿主版本字面量。
   * 形状跟着宿主主版本走：宿主换主版本号时下面那条「守卫跟着宿主线走」会红，来改这里。
   */
  const HOST_VERSION = /\b0\.\d+\.\d+(?:-[a-z]+\.\d+)?\b/g

  /** 仓库里会被当文档读的 markdown；跳过依赖、产物与版本库目录。 */
  function liveDocs(dir = '.'): string[] {
    const found: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = dir === '.' ? entry.name : `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (['node_modules', 'lib', '.git'].includes(entry.name)) continue
        found.push(...liveDocs(path))
        continue
      }
      if (!entry.name.endsWith('.md')) continue
      if (RECORDS.some((pattern) => pattern.test(path))) continue
      found.push(path)
    }
    return found
  }

  it('活文档里不写会漂的宿主版本；门面要留就得与真源同行', () => {
    const files = [...liveDocs(), ...readdirSync('.github/workflows').map((name) => `.github/workflows/${name}`)]
    // 扫不到文件说明walk的路径规则坏了，先红这个，别让它静默变成一条永不触发的守卫。
    expect(files.length).toBeGreaterThan(10)

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        for (const value of line.match(HOST_VERSION) ?? []) {
          if (FACADE.includes(file) && line.includes(HOME)) continue
          throw new Error(
            `${file}:${index + 1} 抄了会漂的宿主版本 ${value}` +
            ` —— 改成指向 ${HOME} 的指针，或现查 node scripts/compat-swap.mjs check`,
          )
        }
      })
    }
  })

  it('守卫跟着宿主线走：宿主换主版本号时这条会红，来改 HOST_VERSION', () => {
    // 形状是「可选运算符 + 0.」：0.1.7 起声明面统一写成 >=0.1.7-alpha.1，
    // 所以这里必须收 >。改回 [~^]? 会让这条在 >= 上必红。
    expect(pkg.engines?.dsh, '宿主已不在 0.x 线上，HOST_VERSION 的形状要跟着改').toMatch(/^[~^>]*=?0\./)
  })
})

/** src/ 下的全部 TypeScript 源文件。 */
function sourceFiles(dir = 'src'): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path))
      continue
    }
    if (/\.tsx?$/.test(entry.name)) found.push(path)
  }
  return found
}

/**
 * 读一个源文件里 export const <name> = '<字面量>' 的值。
 * 拿不到就抛 —— 悄悄返回空串会让下面的对账静默变成「两个空串相等」。
 */
function exportedLiteral(file: string, name: string): string {
  const match = new RegExp(`export const ${name} = '([^']*)'`).exec(readFileSync(file, 'utf8'))
  expect(match, `${file} 里找不到 export const ${name}`).not.toBeNull()
  return match?.[1] ?? ''
}

/**
 * 设置接缝（0.1.7 迁移）。
 *
 * 这几条守的是同一件事：**接缝换了名字与语义**（旧作用域服务 → configForms、
 * bundle 槽 → row 槽、设置命名空间 ds-balance → dsh-ds-balance）。
 * 它们的共同症状是**静默失效** —— cordis 的 inject 是激活门禁，少一个服务名
 * apply 根本不执行，界面上什么都不报。
 */
describe('设置接缝', () => {
  const hostEntryId = exportedLiteral('src/config.ts', 'ENTRY_ID')
  const clientEntryId = exportedLiteral('src/client/index.tsx', 'ENTRY_ID')

  it('两半体的 ENTRY_ID 字面量逐字相等，且等于包名', () => {
    // 两半不许值导入（src/AGENTS.md），所以它是故意抄的两份；这条就是那份抄写的对账表。
    // 0.1.7 起它同时是设置命名空间：客户端按它取表单，宿主半边按它写设置。
    expect(clientEntryId).toBe(hostEntryId)
    expect(hostEntryId).toBe(pkg.name)
  })

  it('左下角条目的 slot id 两半体一致，且与 ENTRY_ID 不同', () => {
    // 它是 UI 身份标识，不是命名空间；一旦被顺手改成 ENTRY_ID，那一条目的 key 就换了。
    const host = exportedLiteral('src/config.ts', 'SIDEBAR_ENTRY_ID')
    const client = exportedLiteral('src/client/index.tsx', 'SIDEBAR_ENTRY_ID')
    expect(client).toBe(host)
    expect(client).not.toBe(hostEntryId)
  })

  it('ROW_CONFIG_KEY 逐字等于 ENTRY_ID + "#" + ENTRY_ID', () => {
    // 客户端把它写成字面量（产物里要能照字面找到这个键，见 artifacts.test.ts），
    // 所以拼接关系得在这里对账 —— 光靠肉眼看不出两份字面量什么时候漂开。
    expect(readFileSync('src/client/index.tsx', 'utf8'))
      .toContain(`export const ROW_CONFIG_KEY = '${clientEntryId}#${clientEntryId}'`)
  })

  it('卡片注册项用的就是 CONFIG_SLOT 与 ROW_CONFIG_KEY', () => {
    // 产物级的断言只能看到「这串键在不在」（esbuild 把键落成具名常量），
    // 所以「注册项真的用了它们」在这里对账。
    expect(readFileSync('src/client/index.tsx', 'utf8'))
      .toContain('{ name: CONFIG_SLOT, key: ROW_CONFIG_KEY, locale: NS }')
  })

  it('loader/volatile-update 的事件声明在位', () => {
    // 不引它，ctx.on 拿不到那个事件键（TS2345）；而运行时它表达的是「配置变了」这件事，
    // 少了它调度就再也不会按新频率重排。
    expect(readFileSync('src/index.ts', 'utf8'))
      .toContain("import type {} from '@deepseek-ai/cordis-plugin-loader'")
  })

  it('源码里不再出现宿主已删的旧接缝', () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(10)
    const offenders: string[] = []
    for (const file of files) {
      const body = stripComments(readFileSync(file, 'utf8'))
      for (const token of [
        'settingsScope', 'SettingsScope', 'ctx.settings.register', 'installSection', 'plugins.bundle.config',
      ]) {
        if (body.includes(token)) offenders.push(`${file} → ${token}`)
      }
    }
    expect(offenders, `这些文件还在用 0.1.7 已删的接缝：\n${offenders.join('\n')}`).toEqual([])
  })

  it('每个 @deepseek-ai/dsh-* 区间与 engines.dsh 逐字相同', () => {
    // 契约是「engines.dsh 与所有 dsh-* 同形状」：不一致时使用者按我们给的区间装不出可用的宿主。
    // 形状也算 —— 一条写成 ^、另一条写成 >= 就是漂。
    const ranges = new Set<string>()
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        if (name.startsWith('@deepseek-ai/dsh-')) ranges.add(range as string)
      }
    }
    expect([...ranges]).toEqual([pkg.engines?.dsh])
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

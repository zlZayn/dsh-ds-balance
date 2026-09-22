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

/**
 * 插件展示元数据（插件页上的标题与描述）。
 *
 * 宿主**直读**包内的 `locale/*.json` 与 `package.json`，我们的代码一个字节都不读它 ——
 * 所以这两份文件坏了不会有任何编译期或运行期信号，宿主只会**静默回落**成包名与
 * `package.json` 的 `description`。发布面的覆盖（`exports` / `files`）由
 * `scripts/check-release.mjs` 守；这里守两份语言文件之间、以及门面与它们之间的一致性。
 * 规则与回落链见 locale/AGENTS.md。
 */
describe('插件展示元数据', () => {
  /** 一份语言文件的 `meta`。断言失败要好读，所以这里不吞异常。 */
  const meta = (file: string): { title?: unknown; description?: unknown } =>
    (JSON.parse(readFileSync(file, 'utf8')) as { meta: { title?: unknown; description?: unknown } }).meta

  it('中英两份的键集逐字相同，且只有 title / description', () => {
    // 少一个字段只会在那种语言下露出另一种语言（宿主逐字段回落），界面上不报错；
    // 字段名拼错（titel）等于没写，同样只在界面上静默降级。
    const en = meta('locale/en.json')
    const zh = meta('locale/zh.json')
    expect(Object.keys(en).sort()).toEqual(['description', 'title'])
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    for (const [file, fields] of [['locale/en.json', en], ['locale/zh.json', zh]] as const) {
      for (const [field, value] of Object.entries(fields)) {
        expect(typeof value, `${file} 的 meta.${field} 必须是字符串`).toBe('string')
        expect((value as string).trim(), `${file} 的 meta.${field} 不允许为空`).not.toBe('')
      }
    }
  })

  it('门面点名的插件显示名与 locale 的标题逐字一致', () => {
    // 门面按名字喊这个插件（「点进 DeepSeek 余额 的详情页」），而那个名字的真源在这两份 JSON 里。
    // 改名要同批改门面，否则安装者照 README 找不到那一格 —— 与「含版本的那一行必须与
    // package.json 同行」是同一类判据。
    const zh = meta('locale/zh.json').title
    const en = meta('locale/en.json').title
    expect(typeof zh === 'string' && zh !== '', 'locale/zh.json 的 meta.title 不是非空字符串').toBe(true)
    expect(typeof en === 'string' && en !== '', 'locale/en.json 的 meta.title 不是非空字符串').toBe(true)
    expect(readFileSync('README.md', 'utf8')).toContain(zh as string)
    expect(readFileSync('README_en.md', 'utf8')).toContain(en as string)
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
 * 设置命名空间 ds-balance → dsh-ds-balance）。
 * 它们的共同症状是**静默失效** —— cordis 的 inject 是激活门禁，少一个服务名
 * apply 根本不执行，界面上什么都不报。
 *
 * 配置卡片的落点**往返过一次**（bundle 槽 → row 槽 → bundle 槽）；理由与判据见
 * .agents/notes/2026-09-22-config-entry-back-to-bundle-config.md。
 * 所以下面守的不是「哪个槽名」，而是**两条今天同串、却各管一件事的 id**。
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

  it('BUNDLE_CONFIG_KEY 逐字等于 ENTRY_ID（槽 key 取包名）', () => {
    // 宿主按包名索引这一格（slot-contract 对该槽的说明 + config-ledger.ts:51 的
    // keysOf('plugins.bundle.config') + PluginManagerPage.tsx:1269 的
    // configured={ledger.bundles.has(openPkg.name)}）。
    // 客户端把它写成字面量（产物里要能照字面找到这个键，见 artifacts.test.ts），
    // 所以这层相等关系得在这里对账 —— 光靠肉眼看不出两份字面量什么时候漂开。
    //
    // **这是本轮新引入的静默耦合点**：槽 key 取包名、ctx.configForms.get() 取 Loader
    // 条目 id，两者今天同串。它们必须逐字相等，但**不是一个概念** ——
    // 漂开的表现是「卡片在、表单永远只读」，不报错。
    expect(readFileSync('src/client/index.tsx', 'utf8'))
      .toContain(`export const BUNDLE_CONFIG_KEY = '${clientEntryId}'`)
  })

  it('卡片注册项用的就是 CONFIG_SLOT 与 BUNDLE_CONFIG_KEY', () => {
    // 产物级的断言只能看到「这串键在不在」（esbuild 把键落成具名常量），
    // 所以「注册项真的用了它们」在这里对账。
    expect(readFileSync('src/client/index.tsx', 'utf8'))
      .toContain('{ name: CONFIG_SLOT, key: BUNDLE_CONFIG_KEY, locale: NS }')
  })

  it('configForms.get() 的实参是 ENTRY_ID（设置命名空间，不是槽 key）', () => {
    // 宿主 formFor 只认 describe 镜像里存在的设置命名空间（PluginManagerPage.tsx:1123 的
    // `if (!configurations?.some(view => view.ns === id)) return undefined`），
    // 传成槽 key 就是「拿不到 form」—— 两者今天同串，靠这条钉住它用的是哪个常量。
    expect(readFileSync('src/client/index.tsx', 'utf8'))
      .toContain('configForms.get<Record<string, unknown>>(ENTRY_ID)')
  })

  it('能力探测盯 configForms 服务，不再盯槽名', () => {
    // 旧的探测盯槽名，而 plugins.bundle.config 在 0.1.6 与 0.1.7 都存在、且两版渲染它
    // 都不传 form ⇒ 那条信号恒为真，等于一个说谎的探测。现在 markDeclared 必须挂在
    // 那次 inject 的回调里 —— 位置写错就等于把探测退回旧语义。
    const entry = readFileSync('src/client/index.tsx', 'utf8')
    const injectAt = entry.indexOf("ctx.inject(['configForms']")
    const markAt = entry.indexOf('configSlotProbe.markDeclared()')
    expect(injectAt, "src/client/index.tsx 里找不到 ctx.inject(['configForms'])").toBeGreaterThan(-1)
    expect(markAt, '探测没有挂在 configForms 服务到位的那一刻').toBeGreaterThan(injectAt)
  })

  it('loader/volatile-update 的事件声明在位', () => {
    // 不引它，ctx.on 拿不到那个事件键（TS2345）；而运行时它表达的是「配置变了」这件事，
    // 少了它调度就再也不会按新频率重排。
    expect(readFileSync('src/index.ts', 'utf8'))
      .toContain("import type {} from '@deepseek-ai/cordis-plugin-loader'")
  })

  it('源码里不再出现宿主已删的旧接缝', () => {
    // 表里**只放真的被删掉的东西**。上一轮把 'plugins.bundle.config' 也列了进来，
    // 那是误分类：它在 0.1.6 与 0.1.7 都活着（宿主 slot-contract.ts 两个槽都在），
    // 而且本轮卡片正落回那一格 —— 留着这一条会与 CONFIG_SLOT 的断言互相打架。
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(10)
    const offenders: string[] = []
    for (const file of files) {
      const body = stripComments(readFileSync(file, 'utf8'))
      for (const token of [
        'settingsScope', 'SettingsScope', 'ctx.settings.register', 'installSection',
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

/** 一条扁平化后的 CSS 规则：逗号分隔的选择器 + 按源码顺序的声明。 */
interface CssRule {
  selectors: string[]
  declarations: [property: string, value: string][]
}

/**
 * 把一张样式表摊平成规则。
 *
 * **与宿主那份同形、故意不合并**：判据是上游的，抄形状不抄文件（宿主
 * `ui-theme/tests/stylesheet-scan.ts` 的 `parseRules`）。不处理嵌套 —— 本仓的
 * `@supports` 块里是单层规则，外层会作为「无声明的前奏」被跳过。
 * @param css - 样式表文本。
 * @returns 每条规则一项，按源码顺序。
 */
function parseCssRules(css: string): CssRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rules: CssRule[] = []
  for (const [, selector = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = body
      .split(';')
      .map(part => part.trim())
      .filter(part => part.includes(':'))
      .map((part): [string, string] => {
        const colon = part.indexOf(':')
        return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()]
      })
    rules.push({ selectors: selector.split(',').map(part => part.trim()), declarations })
  }
  return rules
}

/** 高程式表面的投影 token（宿主那句 ELEVATED_SHADOW 的等价物）。 */
const ELEVATED_SHADOW = /--dsw-(?:shadow-lv|elevation-)/

/**
 * 画了菜单填充、却没在同一条规则里配 backdrop-filter 的那些规则。
 *
 * 判据与宿主 `ui-theme/tests/elevation-styles.client.spec.ts` 的
 * `translucentMenusWithoutBackdrop()` **逐条同形**（那条也是本仓要复刻的东西）。
 * @param css - 样式表文本。
 * @returns 违规规则的选择器。
 */
function translucentMenusWithoutBackdrop(css: string): string[] {
  return parseCssRules(css)
    .filter(rule => rule.declarations.some(([property, value]) =>
      (property === 'background' || property === 'background-color')
      && value === 'var(--dsw-specific-menu)'))
    .filter(rule => rule.declarations.some(([property, value]) =>
      property === 'box-shadow' && ELEVATED_SHADOW.test(value))
      || rule.selectors.some(selector => /::(?:before|after)$/.test(selector)))
    .filter(rule => !rule.declarations.some(([property, value]) =>
      property === 'backdrop-filter' && value === 'var(--dsw-menu-backdrop-filter)'))
    .map(rule => rule.selectors.join(', '))
}

/**
 * 圆环的几何口径。
 *
 * 断言**从源码文本里读常量**、不从被测模块 import：`tsconfig.test.json` 把 `src/client` 排除在外
 * （它由客户端那份 tsconfig 管），import 进来会把整个浏览器半边拖进测试项目的类型检查。
 */
describe('圆环几何', () => {
  const ring = readFileSync('src/client/sidebar/PercentRing.tsx', 'utf8')
  const ringCss = readFileSync('src/client/sidebar/PercentRing.module.css', 'utf8')
  /** 读一个 `const <name> = <字面量>` 的数字值。 */
  const numberOf = (name: string): number => {
    const match = new RegExp(`const ${name} = ([0-9.]+)\\b`).exec(ring)
    expect(match, `PercentRing.tsx 里找不到 const ${name} = <数字>`).not.toBeNull()
    return Number(match?.[1])
  }

  it('网格与笔画等于官方图标的那两条（viewBox 16 / ICON_REGULAR_STROKE = 1）', () => {
    // 口径的出处是宿主源码，不是我们自己定的数：
    // ui-primitives/src/icons/index.tsx:21 的 ICON_REGULAR_STROKE = 1，
    // 且每个 Icon*Artwork 都写 viewBox="0 0 16 16"。官方改网格时这条会红 —— 那正是要的。
    expect(numberOf('VIEW'), 'viewBox 边长').toBe(16)
    expect(numberOf('STROKE'), '笔画（viewBox 单位）').toBe(1)
  })

  it('环在网格里的比例与官方 ContextMeter 同构，外径落在字形跨度里', () => {
    // 官方那套（宿主 ui-conversation/.../ContextMeter.tsx:17-19）：viewBox 14、RADIUS 5.5、
    // stroke 2 ⇒ 半径 = 边长/2 − 圆留白 − 笔画/2 = 7 − 0.5 − 1 = 5.5，墨迹外径 13 落在 14 的格里。
    // 本仓换到 16 的官方图标网格后必须**用同一个公式**，否则「同网格」只是嘴上说说：
    // 漏掉 − 笔画/2 那一项，墨迹就会比邻居的框粗出去一圈（这条断言就是为它写的）。
    const view = numberOf('VIEW')
    const stroke = numberOf('STROKE')
    const inset = numberOf('RING_INSET')
    const radius = view / 2 - inset - stroke / 2
    expect(radius, '半径（VIEW / 2 − RING_INSET − STROKE / 2）').toBe(6.5)
    const diameter = 2 * radius + stroke
    expect(diameter, '墨迹外径').toBe(14)
    expect(diameter).toBeGreaterThanOrEqual(12)
    expect(diameter).toBeLessThanOrEqual(13.75 + 1)
    // 四周留白必须为正：撑满整格就是旧写法那个「比邻居大一圈」。
    expect(inset).toBeGreaterThan(0)
    // 交叉校验官方那一侧的形状：同一个公式代进它的数应当得到 5.5。
    expect(14 / 2 - 0.5 - 2 / 2).toBe(5.5)
  })

  it('两条 stroke-width 都是 STROKE，叉号与环同宽', () => {
    // svg 上的 stroke-width 由 CSS 写（组件里没有 strokeWidth 属性），所以这两条常量之外
    // 还有一份真源 —— 靠这条对账：漏改一处就是「环 1px、叉号 1.5px」或反过来。
    const stroke = numberOf('STROKE')
    const widths = [...ringCss.matchAll(/stroke-width: ([0-9.]+);/g)].map(match => Number(match[1]))
    expect(widths.length, 'PercentRing.module.css 里的 stroke-width 条数').toBe(3)
    for (const width of widths) expect(width).toBe(stroke)
  })
})

describe('菜单材质成对', () => {
  /** 本仓的全部 CSS Module 源文件。 */
  function moduleStylesheets(dir = 'src/client'): string[] {
    const found: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) found.push(...moduleStylesheets(path))
      else if (entry.name.endsWith('.css')) found.push(path)
    }
    return found
  }

  it('写了 --dsw-specific-menu 的表面必须同规则配 --dsw-menu-backdrop-filter', () => {
    // 0.1.7 把菜单材质拆成了两条 token：填充（--dsw-specific-menu，变成半透明）与
    // 模糊（--dsw-menu-backdrop-filter，新加的）。只写前者就是「透光但不磨砂」——
    // 浮层看着像掉了一层底色，而不是官方那种玻璃。
    //
    // **为什么这条得由我们自己写**：宿主那条门禁（ui-theme/tests/elevation-styles
    // .client.spec.ts）只扫官方仓的 packages/，插件仓不在它的覆盖里 ——
    // 本轮反馈 1 就是这么漏掉的（官方门禁绿着，我们的浮层没有模糊）。
    const missing = moduleStylesheets().flatMap(file =>
      translucentMenusWithoutBackdrop(readFileSync(file, 'utf8'))
        .map(selectors => `${file} ${selectors}`))
    expect(missing, `这些规则画了菜单填充却没有 backdrop-filter：\n${missing.join('\n')}`).toEqual([])
  })

  it('扫描器真的看到了那个菜单表面（否则上一条是永不触发的假绿）', () => {
    // 与「活文档」那条同一个道理：walk 坏掉、或者唯一的消费者被改了命名，
    // 上一条会静默变成一条永远为真的守卫。这条钉住「扫到了什么」。
    const css = readFileSync('src/client/sidebar/BalancePopover.module.css', 'utf8')
    expect(translucentMenusWithoutBackdrop(css)).toEqual([])
    expect(parseCssRules(css).some(rule => rule.selectors.includes('.panel::before'))).toBe(true)
    expect(parseCssRules(css)
      .find(rule => rule.selectors.includes('.panel::before'))?.declarations
      .find(([property]) => property === 'background')?.[1]).toBe('var(--dsw-specific-menu)')
    // 反向控制：把滤镜删掉必须被抓出来（判据本身有牙齿）。
    expect(translucentMenusWithoutBackdrop(
      '.a::before { background: var(--dsw-specific-menu); }')).toEqual(['.a::before'])
  })
})

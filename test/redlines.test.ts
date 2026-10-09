import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 红线：把口头约定变成断言。
 *
 * 每条都对应一次真实事故或一次已裁决的决定；改红线等于改约定，要单独说明理由。
 */

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  name: string
  private?: boolean
  files: string[]
  dependencies: Record<string, string>
  peerDependencies: Record<string, string>
  devDependencies: Record<string, string>
  engines: { dsh: string; node: string }
  exports?: Record<string, { default?: string }>
  dsh?: {
    bundle?: { patch?: string }
    client?: { platform?: string; inject?: string[] }
  }
}

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
    const peers = Object.keys(pkg.peerDependencies ?? {}).filter((name) =>
      name.startsWith('@deepseek-ai/'),
    )
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
 * 发布流程。
 *
 * 顺序是**死**的：先 bump 并提交 → 需要截图就先拍 → 最后发布。
 * 为什么：界面上的版本 tag 是**截图的判废项**，而它显示的就是 `package.json` 里那个号。
 * 只要发布流程自己 bump，工作树就永远停在「上一个已发布版本」，截图必然拍出旧号。
 * 界面出的错比 CI 出的错贵 —— 所以要红在测试里，而不是红在门面图上。
 */
describe('发布流程', () => {
  /**
   * 在一份 YAML 里找**命令位置**上的改写版本调用。
   * 只看命令位置（行首、`run:` 之后、`&&` / `;` 之后）—— 提示文案里写「bump with: npm version …」
   * 是给维护者看的一句话，不是调用，不该被误伤。
   */
  const bumpCalls = (text: string): string[] =>
    text.split('\n').flatMap((line, index) => {
      const body = line.replace(/^\s*(?:-\s*)?(?:run:\s*)?/, '')
      return body
        .split(/&&|;|\|\|/)
        .map((part) => part.trim())
        .filter((part) => /^(?:npm|pnpm)\s+(?:--?[\w-]+\s+)*version(?:\s|$)/.test(part))
        .map((part) => `第 ${index + 1} 行：${part.slice(0, 60)}`)
    })

  it('release.yml 里不得出现改写版本的调用', () => {
    // bump 是发布**之前**的独立一步（在维护者机器上跑），workflow 只发不 bump。
    // 判据与顺序的说明在 docs/PUBLISHING.md；反向控制在同一组的下一条。
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    const found = bumpCalls(workflow)
    expect(found, `release.yml 里出现了改写版本的调用：\n${found.join('\n')}`).toEqual([])
  })

  it('上面那条检测器有牙齿（反向控制）', () => {
    // 防空转：扫不到东西的守卫等于没有守卫。
    expect(bumpCalls('      - run: npm version patch --no-git-tag-version')).toEqual([
      '第 1 行：npm version patch --no-git-tag-version',
    ])
    expect(bumpCalls('run: pnpm version minor')).toEqual(['第 1 行：pnpm version minor'])
    expect(bumpCalls('        npm --no-git-tag-version version prerelease')).toEqual([
      '第 1 行：npm --no-git-tag-version version prerelease',
    ])
    expect(bumpCalls('run: npm ci && npm version patch')).toEqual(['第 1 行：npm version patch'])
    // 正常的发布步骤、以及提示文案里的那串字，都不该被误伤。
    expect(bumpCalls('run: npm ci')).toEqual([])
    expect(bumpCalls('run: npm publish --provenance --tag "$tag"')).toEqual([])
    expect(bumpCalls('run: npm run build && npm test')).toEqual([])
    expect(
      bumpCalls('echo "bump with: npm version <patch|minor|major> --no-git-tag-version"'),
    ).toEqual([])
  })

  /**
   * 发布面 **git 侧产物**的形状：三件事各自可判，也各自可反向控制。
   * 为什么连形状都要断言：tag 名不是给人看的 —— 守卫靠 `git describe --match 'v[0-9]*'` 读它
   * （zhihu 那边就因为版本号换了来源、`v` 前缀丢了，让守卫**看不见**新 tag）；
   * 而 Release 漏建过一次（1.0.0 / 1.1.0 是手工补的），靠的是**人记得**。
   */
  const releaseShape = (text: string) => {
    const tagAssignments = [...text.matchAll(/\btag="([^"]*)"/g)].map((m) => m[1])
    return {
      createsRelease: /(?:^|\s)gh release create\s/.test(text),
      tagAssignments,
      oddPrefix: tagAssignments.filter((value) => !value.startsWith('v')),
      // 预发布段（`*-*`）与 `--prerelease` 必须成对：只写后者 = 正式版也会被标成预发布。
      prereleaseGuarded: /\*-\*/.test(text) && text.includes('--prerelease'),
    }
  }

  it('git 侧两样产物都由流程产出：v 前缀的 tag + 预发布标 --prerelease 的 Release', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    const shape = releaseShape(workflow)
    expect(
      shape.createsRelease,
      'release.yml 里没有建 Release 的步骤：那样每发一次版都要靠人记得补',
    ).toBe(true)
    expect(shape.tagAssignments.length, 'release.yml 里找不到 tag 赋值').toBeGreaterThan(0)
    expect(shape.oddPrefix, `tag 名必须是 v 前缀，出现：${shape.oddPrefix.join('、')}`).toEqual([])
    expect(shape.prereleaseGuarded, '版本带预发布段时没有走 --prerelease').toBe(true)
  })

  it('上面那条形状判据有牙齿（反向控制）', () => {
    // 少 v：换了版本号来源、前缀丢了 —— 守卫看不见这种 tag。
    expect(releaseShape('          tag="${{ steps.probe.outputs.version }}"\n').oddPrefix).toEqual([
      '${{ steps.probe.outputs.version }}',
    ])
    // 有 --prerelease，却没有「按版本预发布段判定」那一步 → 正式版也会被标成预发布。
    expect(releaseShape('run: gh release create "$tag" --prerelease\n').prereleaseGuarded).toBe(
      false,
    )
    // 只打 tag、不建 Release（这就是 2026-09-22 之前的样子）。
    expect(releaseShape('run: git tag "$tag" && git push origin "$tag"\n').createsRelease).toBe(
      false,
    )
    // 正面样本：真东西那个形状三样都得true。
    expect(
      releaseShape(
        [
          '          tag="v${{ steps.probe.outputs.version }}"',
          '          case "${{ steps.probe.outputs.version }}" in',
          '            *-*) flags="--prerelease" ;;',
          '          esac',
          '          gh release create "$tag" --title "$tag" $flags --generate-notes',
        ].join('\n'),
      ),
    ).toEqual({
      createsRelease: true,
      tagAssignments: ['v${{ steps.probe.outputs.version }}'],
      oddPrefix: [],
      prereleaseGuarded: true,
    })
  })

  /**
   * 正文来源两级（草稿 → 回落）与**「草稿真的被读到了吗」那条断言**。
   *
   * 为什么连这个都要钉：读不到草稿与「草稿为空」都会走回落，但前者是**配置坏了**
   * （tag 改名、action 没跑、权限不足），后者是**正常情况**。不区分的话，
   * 「发版成功但正文其实走了回落」是**静默失败** —— 结果看着对，实际少了一层。
   */
  it('发版正文走「草稿 → --generate-notes 回落」，且两级都在', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    // 读草稿：必须点名滚动 tag，不能是 v<版本>（否则会命中存在性判断）。
    expect(workflow, '没有读 Release Drafter 草稿的步骤').toContain('gh release view next')
    // 回落仍在。
    expect(workflow, '回落那一路没了').toContain('--generate-notes')
    // **断言在位**：草稿读不到时必须发 warning，而不是静默回落。
    expect(workflow, '草稿读不到时没有 warning —— 那就成了静默回落').toMatch(
      /warning::读不到 Release Drafter 草稿/,
    )
    // 两条路各自传给 gh release create。
    expect(workflow).toContain('--notes-file /tmp/notes.md')
  })

  it('上面那条判据有牙齿（去掉断言就该被抓出来）', () => {
    // 反向控制：拿一份「只回落、不读草稿」的假 workflow 去比对，必须不满足。
    const noDraft = 'run: gh release create "$tag" --title "$tag" $flags --generate-notes\n'
    expect(noDraft).not.toContain('gh release view next')
    // 拿一份「读草稿但读不到时静默」的假 workflow，warning 那条必须不命中。
    const silent = 'draft="$(gh release view next --json body --jq .body)"\n'
    expect(silent).not.toMatch(/warning::读不到 Release Drafter 草稿/)
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
    (JSON.parse(readFileSync(file, 'utf8')) as { meta: { title?: unknown; description?: unknown } })
      .meta

  it('中英两份的键集逐字相同，且只有 title / description', () => {
    // 少一个字段只会在那种语言下露出另一种语言（宿主逐字段回落），界面上不报错；
    // 字段名拼错（titel）等于没写，同样只在界面上静默降级。
    const en = meta('locale/en.json')
    const zh = meta('locale/zh.json')
    expect(Object.keys(en).sort()).toEqual(['description', 'title'])
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    for (const [file, fields] of [
      ['locale/en.json', en],
      ['locale/zh.json', zh],
    ] as const) {
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
    expect(typeof zh === 'string' && zh !== '', 'locale/zh.json 的 meta.title 不是非空字符串').toBe(
      true,
    )
    expect(typeof en === 'string' && en !== '', 'locale/en.json 的 meta.title 不是非空字符串').toBe(
      true,
    )
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

  it('信封 id 必须从 package.json 的 name 读（不手抄包名）', () => {
    expect(buildScript).toContain("readFileSync('package.json'")
    expect(buildScript).toMatch(/const BUNDLE_ID = .*\.name/)
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
    // 它们是「类型与死代码」这一档的守卫（与 ESLint 的分工见 2026-09-27-adopt-eslint-prettier.md）：
    // 缺任何一个，覆盖面就不再成立。
    const flags = [
      'noUnusedLocals',
      'noUnusedParameters',
      'noImplicitReturns',
      'noFallthroughCasesInSwitch',
    ]
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
    // `UI-HANDOFF.md` 曾在这张表里（当「依据」冻结），本轮改归**活文档** ——
    // 它写的是当前界面契约（处境表 / 通道映射 / 来源标签规则 / mock 覆盖），
    // 必须与代码一致。层的登记表也同步改了，见 docs/README.md。
    // 于是「不写会漂的值」这条红线现在**也管它**。
    //
    // 原先这里还有 `/^docs\/recon-/` 与
    // `/^docs\/(model-integration-assessment|backend-architecture-review)\.md$/` 两条 ——
    // 那三份（勘察 / 评估 / 审查）已移入 `.agents/notes/` 作**依据类**，
    // 被上面第一条前缀正则接住，所以删掉这两条。**不是放宽**：豁免面没变，
    // 只是跟着文件换了路径。
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
    const files = [
      ...liveDocs(),
      ...readdirSync('.github/workflows').map((name) => `.github/workflows/${name}`),
    ]
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
    // 形状是「可选运算符 + 0.」：声明面统一写成 `>=<线起点>`（如 `>=0.2.0-rc.1`），
    // 所以这里必须收 >。改回 [~^]? 会让这条在 >= 上必红。
    expect(pkg.engines?.dsh, '宿主已不在 0.x 线上，HOST_VERSION 的形状要跟着改').toMatch(
      /^[~^>]*=?0\./,
    )
  })

  it('README 让用户装的那条线，必须与 TRACKED_LINE 同名', () => {
    // 这两处漂开过一次（README 指 `@alpha` 而声明线已经换掉），
    // 而漂开的后果是用户照着 README 装到一个**落在声明范围之外**的宿主 —— 不报错、只是不支持。
    // 判据只比「线名」：README 那条命令是本仓唯一告诉用户去哪儿装的地方。
    //
    // **从脚本源码里读那个常量，不 import**：`scripts/` 是 `.mjs`、没有类型声明，
    // 而 tsconfig 的测试项目要求类型完整（同 compat-swap.test.ts 走进程调用而非 import 的原因）。
    // 读不到就报错，不会静默放过。
    const tracked = /export const TRACKED_LINE = '([a-z]+)'/.exec(
      readFileSync('scripts/check-declaration.mjs', 'utf8'),
    )?.[1]
    expect(tracked, 'scripts/check-declaration.mjs 里读不出 TRACKED_LINE').toBeDefined()

    const readmes = ['README.md', 'README_en.md'].map((file) => readFileSync(file, 'utf8'))
    let seen = 0
    for (const text of readmes) {
      for (const match of text.matchAll(/npm install -g @deepseek-ai\/dsh@([a-z]+)/g)) {
        seen += 1
        expect(match[1], `README 让用户装 @${match[1]}，而 TRACKED_LINE 是 ${tracked}`).toBe(
          tracked,
        )
      }
    }
    // 反向控制：README 里必须真的有这条命令（否则上面是空转的假绿）。
    expect(seen, 'README 里 `npm install -g @deepseek-ai/dsh@<线>` 的出现次数').toBeGreaterThan(1)
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

  it('BUNDLE_CONFIG_KEY 字面量逐字等于 package.json 的 name（槽 key 取包名）', () => {
    // 宿主按包名索引这一格（slot-contract 对该槽的说明 + config-ledger.ts:51 的
    // keysOf('plugins.bundle.config') + PluginManagerPage.tsx:1269 的
    // configured={ledger.bundles.has(openPkg.name)}）。
    // 客户端把它写成字面量（产物里要能照字面找到这个键，见 artifacts.test.ts；
    // 浏览器半体不 import package.json），所以真源对账在这里做。
    //
    // **与 ENTRY_ID 是两个概念**：槽 key 取包名、ctx.configForms.get() 取 Loader
    // 条目 id，两者今天同串。漂开的表现是「卡片在、表单永远只读」，不报错。
    const match = /export const BUNDLE_CONFIG_KEY = '([^']*)'/.exec(
      readFileSync('src/client/index.tsx', 'utf8'),
    )
    expect(match, 'src/client/index.tsx 里找不到 export const BUNDLE_CONFIG_KEY').not.toBeNull()
    expect(match?.[1]).toBe(pkg.name)
    // 今天它还等于 ENTRY_ID（设置命名空间）—— 这是约定，不是宿主要求；两条都钉住。
    expect(match?.[1]).toBe(clientEntryId)
  })

  it('卡片注册项用的就是 CONFIG_SLOT 与 BUNDLE_CONFIG_KEY', () => {
    // 产物级的断言只能看到「这串键在不在」（esbuild 把键落成具名常量），
    // 所以「注册项真的用了它们」在这里对账。
    expect(readFileSync('src/client/index.tsx', 'utf8')).toContain(
      '{ name: CONFIG_SLOT, key: BUNDLE_CONFIG_KEY, locale: NS }',
    )
  })

  it('configForms.get() 的实参是 ENTRY_ID（设置命名空间，不是槽 key）', () => {
    // 宿主 formFor 只认 describe 镜像里存在的设置命名空间（PluginManagerPage.tsx:1123 的
    // `if (!configurations?.some(view => view.ns === id)) return undefined`），
    // 传成槽 key 就是「拿不到 form」—— 两者今天同串，靠这条钉住它用的是哪个常量。
    expect(readFileSync('src/client/index.tsx', 'utf8')).toContain(
      'configForms.get<Record<string, unknown>>(ENTRY_ID)',
    )
  })

  it('能力探测盯 configForms 服务，不再盯槽名', () => {
    // 旧的探测盯槽名，而 plugins.bundle.config 在 0.1.6 与 0.1.7 都存在、且两版渲染它
    // 都不传 form ⇒ 那条信号恒为真，等于一个说谎的探测。现在 markDeclared 必须挂在
    // 那次 inject 的回调里 —— 位置写错就等于把探测退回旧语义。
    const entry = readFileSync('src/client/index.tsx', 'utf8')
    const injectAt = entry.indexOf("ctx.inject(['configForms']")
    const markAt = entry.indexOf('configSlotProbe.markDeclared()')
    expect(injectAt, "src/client/index.tsx 里找不到 ctx.inject(['configForms'])").toBeGreaterThan(
      -1,
    )
    expect(markAt, '探测没有挂在 configForms 服务到位的那一刻').toBeGreaterThan(injectAt)
  })

  it('loader/volatile-update 的事件声明在位', () => {
    // 不引它，ctx.on 拿不到那个事件键（TS2345）；而运行时它表达的是「配置变了」这件事，
    // 少了它调度就再也不会按新频率重排。
    expect(readFileSync('src/index.ts', 'utf8')).toContain(
      "import type {} from '@deepseek-ai/cordis-plugin-loader'",
    )
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
        'settingsScope',
        'SettingsScope',
        'ctx.settings.register',
        'installSection',
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
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
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
      .map((part) => part.trim())
      .filter((part) => part.includes(':'))
      .map((part): [string, string] => {
        const colon = part.indexOf(':')
        return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()]
      })
    rules.push({ selectors: selector.split(',').map((part) => part.trim()), declarations })
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
    .filter((rule) =>
      rule.declarations.some(
        ([property, value]) =>
          (property === 'background' || property === 'background-color') &&
          value === 'var(--dsw-specific-menu)',
      ),
    )
    .filter(
      (rule) =>
        rule.declarations.some(
          ([property, value]) => property === 'box-shadow' && ELEVATED_SHADOW.test(value),
        ) || rule.selectors.some((selector) => /::(?:before|after)$/.test(selector)),
    )
    .filter(
      (rule) =>
        !rule.declarations.some(
          ([property, value]) =>
            property === 'backdrop-filter' && value === 'var(--dsw-menu-backdrop-filter)',
        ),
    )
    .map((rule) => rule.selectors.join(', '))
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
    // 中心记号两个取值共用 `css.marker` 一条规则，所以条数仍是 3（track / fill / marker）。
    const stroke = numberOf('STROKE')
    const widths = [...ringCss.matchAll(/stroke-width: ([0-9.]+);/g)].map((match) =>
      Number(match[1]),
    )
    expect(widths.length, 'PercentRing.module.css 里的 stroke-width 条数').toBe(3)
    for (const width of widths) expect(width).toBe(stroke)
  })

  /**
   * 中心记号的半臂长：**求值源码里那条表达式**，而不是读一个数字字面量。
   *
   * 为什么必须求值：`MARK_ARM` 是 `INNER_RADIUS / 2 / Math.SQRT2` 这种派生表达式，
   * 现有的 `numberOf()` 只认 `const X = <数字>`，读不到它 —— 于是表达式写错了也没有任何信号。
   * 这个坑真实发生过：注释写着「取内径 50% 作对角线」，表达式却写成 `(2 * RADIUS - STROKE) / 2 / √2`
   * （= **内径** / 2 / √2，正是注释里那条错公式），算出 4.2426 而不是 2.1213，
   * 于是叉号端点顶到环内壁，「约内径一半」变成「占满内圆」，漂了整整 2 倍且无人发现。
   *
   * 实现方式：把表达式原文交给 `Function` 求值，喂进从源码读出的真实常量。
   * 表达式里出现的标识符必须先声明，所以下面按依赖顺序逐个解析。
   */
  const evaluate = (expression: string, scope: Record<string, number>): number => {
    const names = Object.keys(scope)
    const values = names.map((name) => scope[name])
    // 表达式只该用到我们喂进去的名字与全局 Math；`Function` 比 eval 少一层作用域污染。
    return (Function(...names, `return (${expression})`) as (...args: number[]) => number)(
      ...values,
    )
  }

  /** 读 `const <name> = <表达式到行尾>` 的表达式原文。 */
  const expressionOf = (name: string): string => {
    const match = new RegExp(`const ${name} = (.+)$`, 'm').exec(ring)
    expect(match, `PercentRing.tsx 里找不到 const ${name} = <表达式>`).not.toBeNull()
    return (match?.[1] ?? '').replace(/\/\/.*$/, '').trim()
  }

  /** 按依赖顺序求值几何常量；`numberOf` 只认字面量，这里连表达式一起认。 */
  const geometry = (): {
    view: number
    stroke: number
    inset: number
    radius: number
    innerRadius: number
    markArm: number
  } => {
    const view = numberOf('VIEW')
    const stroke = numberOf('STROKE')
    const inset = numberOf('RING_INSET')
    const scope: Record<string, number> = { VIEW: view, STROKE: stroke, RING_INSET: inset }
    for (const name of ['RADIUS', 'CENTER', 'CIRCUMFERENCE', 'INNER_RADIUS', 'MARK_ARM']) {
      scope[name] = evaluate(expressionOf(name), scope)
    }
    return {
      view,
      stroke,
      inset,
      radius: scope.RADIUS,
      innerRadius: scope.INNER_RADIUS,
      markArm: scope.MARK_ARM,
    }
  }

  it('记号半臂落在「内径 50% 作对角线」上，且实现与注释同源（防 2 倍漂移）', () => {
    const { innerRadius, markArm } = geometry()
    // 内径 = 2 × 内半径；整条对角线取它的 50%，于是半臂 = 对角线 / 2 / √2。
    const innerDiameter = innerRadius * 2
    const armFromHalfDiagonal = (innerDiameter * 0.5) / 2 / Math.SQRT2
    expect(markArm, 'MARK_ARM 与「内径 50% 作对角线」的口径').toBeCloseTo(armFromHalfDiagonal, 10)
    // 钉住绝对值：这条就是当年漂掉的那个数（写成 4.2426 时它会红）。
    expect(markArm).toBeCloseTo(2.1213, 4)
    // 端点必须留在环内：叉的端点半径是 arm×√2，＋ 的是 arm，两者都小于内半径。
    expect(markArm * Math.SQRT2).toBeLessThan(innerRadius)
    expect(markArm).toBeLessThan(innerRadius)
    // 反向控制：当年那条错公式（内径 / 2 / √2）必须**不**等于现在这个值，
    // 否则这条断言在实现退回旧写法时仍会通过。
    const wrongFormula = innerDiameter / 2 / Math.SQRT2
    expect(markArm).not.toBeCloseTo(wrongFormula, 6)
  })

  it('叉与＋取自同一个常量、共用同一条 CSS 规则（两者同大）', () => {
    // 「两者同大」的唯一实现方式：只有一个半臂常量，两个记号都引它。
    const armDefinitions = [...ring.matchAll(/const MARK_ARM =/g)].length
    expect(armDefinitions, 'MARK_ARM 的定义处数（必须恰好一处）').toBe(1)
    // 两个取值各自的 <line> 都只能用 MARK_ARM，不许出现第二个硬编码半臂。
    for (const axis of ['CENTER - MARK_ARM', 'CENTER + MARK_ARM']) {
      expect(ring, `记号坐标必须由 MARK_ARM 派生：${axis}`).toContain(axis)
    }
    // 旧常量不该再被引用（改名之后留一处就是两条几何各走各的）。
    expect(ring, 'CROSS_ARM 已更名 MARK_ARM，不该再出现').not.toContain('CROSS_ARM')
    // 两个记号共用一条 CSS 规则：分叉成两个类就会各自漂各自的 stroke-width。
    expect(ringCss, '中心记号只该有一个类').not.toContain('.cross')
    expect((ringCss.match(/\.marker\s*\{/g) ?? []).length, '.marker 规则条数').toBe(1)
  })
})

/**
 * 注释里声称「照官方」的值，必须真的等于官方那个值。
 *
 * **这条守的是一类安静的错误**：注释说「取值照抄官方 LanguageRow」，实际值与官方不一致 ——
 * 代码能跑、界面也好看，只有「与官方一致」这个**承诺**是假的。它比不写注释更坏：
 * 后来的人会相信这句话，于是不再去核。
 *
 * **为什么这条一度误报过（先说清楚，免得再踩）**：一次核对里拿 `ui-primitives/Pill.module.css`
 * 去比 `fields.module.css` 的 `.selector` —— 而 `.selector` 注释里点名的是
 * `locale/LanguageRow.module.css`。**比错了文件**，于是得出「官方 12px、我们 18px」的假结论；
 * 真相是 LanguageRow 在 0.1.7-rc.1 及以前写的就是 `18px`。
 * 教训：**判据必须绑到注释点名的那份官方文件**，所以下面按「源文件 + 选择器」显式配对，
 * 不做「随便找个同名组件比一比」。
 *
 * **换承诺线之后（2026-10-01）判据简化了**：以前官方在两条宿主线上写法不同
 * （老线写字面量 `18px`、新线写 token），所以本仓得写「token + 老线回落」两个值并各自核对。
 * 现在声明的是 RC 线，官方在那条线上写的就是 token，于是判据只剩一条：
 * **我们引的 token 必须与官方在声明线上写的逐字相同，且同样不写回落值**。
 */
describe('注释声称「照官方」的值必须与官方一致', () => {
  /** 从 CSS 文本里读一个类规则体内某个属性的值（第一个匹配）。 */
  const propertyOf = (text: string, selector: string, property: string): string => {
    const rule = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(text)
    expect(rule, `官方 CSS 里找不到规则 ${selector}`).not.toBeNull()
    const declaration = new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`).exec(rule?.[1] ?? '')
    expect(declaration, `规则 ${selector} 里找不到属性 ${property}`).not.toBeNull()
    return (declaration?.[1] ?? '').trim()
  }

  /**
   * 官方圆角刻度（`packages/client/ui-theme/src/styles/base.css` 的 `:root`）。
   *
   * **为什么把这张表抄进测试**：`ui-theme` 不是本仓依赖（只用它的运行时输出），
   * 所以 node_modules 里没有那份 base.css 可读。表本身是官方常量，改它的概率极低。
   */
  const RADIUS_SCALE: Record<string, string> = {
    '--dsw-radius-xs': '4px',
    '--dsw-radius-sm': '8px',
    '--dsw-radius-md': '12px',
    '--dsw-radius-lg': '16px',
    '--dsw-radius-xl': '20px',
    '--dsw-radius-panel': '28px',
  }

  /** 把声明拆成「token 名 + 回落值」；没有 token 时 token 为 null。 */
  const parseRadius = (value: string): { token: string | null; fallback: string | null } => {
    const match = /var\(\s*(--dsw-radius-[a-z]+)\s*(?:,\s*([^)]+))?\)/.exec(value)
    if (match === null) return { token: null, fallback: value.trim() }
    return { token: match[1] ?? null, fallback: match[2]?.trim() ?? null }
  }

  const ourFields = readFileSync('src/client/settings/fields.module.css', 'utf8')

  it('选择器 pill：圆角必须与官方在声明线上写的逐字相同（同一个 token，同样不写回落）', () => {
    // 官方真源 = **注释里点名的那份文件的那个选择器**：locale/LanguageRow 的 .selector。
    // 装好的 dsh-client-locale 把原始 CSS 内联进了 lib/client.js，所以从那里读。
    const installed = readFileSync(
      'node_modules/@deepseek-ai/dsh-client-locale/lib/client.js',
      'utf8',
    )
    const officialRaw = /\.\w+_selector\{[^}]*?border-radius:([^;}]+)/.exec(installed)?.[1] ?? ''
    const official = parseRadius(officialRaw)
    // 声明线（RC）上官方写的就是 token，且**不带回落**。
    expect(official.token, '官方在声明线上该引语义 token').toBe('--dsw-radius-md')
    expect(official.fallback, '官方在声明线上不写回落值').toBeNull()
    expect(RADIUS_SCALE[official.token ?? ''], 'token 指向的官方值').toBe('12px')

    const ours = parseRadius(propertyOf(ourFields, '.selector', 'border-radius'))
    // 逐字相同：同一个 token，同样不写回落（下限那条线上该 token 一定存在 → 回落是死代码）。
    expect(ours.token, '本仓 .selector 该引与官方同一个 token').toBe(official.token)
    expect(ours.fallback, '本仓也不该写回落值').toBeNull()
  })

  it('引这几族 token 时必须**裸引**（不许写回落值 —— 回落是死代码）', () => {
    // 换线之前反过来：那时声明的是 alpha 线，这几族 token 在那一档不存在，
    // 裸引会让圆角退化成 0、`outline-width` 退化成 0（焦点环整条消失，不报错），所以必须带回落。
    // 现在声明的是 RC 线，token 在声明范围内一定存在 —— 带回落只是留一段永远取不到的代码，
    // 而且会让「声明什么就支持什么」这句话变含糊。判据随之反转。
    const tokens = [
      '--dsw-radius-xs',
      '--dsw-radius-sm',
      '--dsw-radius-md',
      '--dsw-radius-lg',
      '--dsw-radius-xl',
      '--dsw-radius-panel',
      '--dsw-focus-ring-width',
      '--dsw-focus-ring-color',
    ]
    const cssFiles = [
      'src/client/sidebar/BalancePopover.module.css',
      'src/client/sidebar/SidebarBalance.module.css',
      'src/client/settings/fields.module.css',
      'src/client/settings/BalanceSettingsCard.module.css',
    ]
    /** 命中即算「带了回落」：token 后面跟逗号。 */
    let checked = 0
    for (const file of cssFiles) {
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      for (const token of tokens) {
        const withFallback = text.match(new RegExp(`var\\(\\s*${token}\\s*,`, 'g')) ?? []
        expect(
          withFallback.length,
          `${file} 里 ${token} 带了回落值（声明线上取不到，是死代码）`,
        ).toBe(0)
        checked += (text.match(new RegExp(`var\\(\\s*${token}\\s*\\)`, 'g')) ?? []).length
      }
    }
    // 反向控制：这条断言必须真的看到了那些裸引的使用处，否则它是空转的假绿。
    expect(checked, '裸引了这些 token 的次数').toBeGreaterThan(0)
  })

  it('声明下限与安装面必须同类（否则上面两条是在错的版本上核的）', () => {
    // 这条不是形式主义：换线之前本仓 node_modules 装的还是 alpha 档，而**在跑的宿主**已经是 RC，
    // 两边的官方 CSS 写法不同（字面量 vs token）——「官方真源」这句话那时是错位的。
    // 版本对不上时判据本身就没了意义，所以先把它变成可查的信号。
    const declared = /"@deepseek-ai\/dsh-client-ui-primitives":\s*"([^"]+)"/.exec(
      readFileSync('package.json', 'utf8'),
    )?.[1]
    const installed = JSON.parse(
      readFileSync('node_modules/@deepseek-ai/dsh-client-ui-primitives/package.json', 'utf8'),
    ) as { version: string }
    expect(declared, 'package.json 里 ui-primitives 的声明区间').toBeDefined()
    const floor = /(\d+\.\d+\.\d+(?:-[a-z.\d]+)?)/.exec(declared ?? '')?.[1]
    expect(floor, '声明区间里读不出下限').toBeDefined()
    const cmp = (a: string, b: string): number => {
      const parse = (v: string): number[] =>
        v
          .split('-')[0]!
          .split('.')
          .map((n) => Number(n))
      const [av, bv] = [parse(a), parse(b)]
      for (let i = 0; i < 3; i += 1) if (av[i] !== bv[i]) return (av[i] ?? 0) - (bv[i] ?? 0)
      return 0
    }
    expect(
      cmp(installed.version, floor ?? '0.0.0'),
      `安装的 ui-primitives ${installed.version} 低于声明下限 ${floor}`,
    ).toBeGreaterThanOrEqual(0)
  })
})

/**
 * 插件图标（插件页卡片、详情页与行上那个环）。
 *
 * 宿主按**图片**渲染它（读过 `package.json` 的 `icon` 之后编成 base64 data URL），所以
 * `currentColor` 不起作用、颜色只能写死 —— 那正是它最容易悄悄漂开的地方：环改了半径或笔画、
 * 或者换了那一档的颜色，图标不会有任何编译期或运行期信号，只会在插件页上继续长着旧样子。
 */
describe('插件图标', () => {
  /** 说明文字里也写着几何，剥掉注释再解析，免得匹配到注释。 */
  const icon = readFileSync('icon.svg', 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const ring = readFileSync('src/client/sidebar/PercentRing.tsx', 'utf8')
  /** 读 `const <name> = <字面量>` 的数字值。 */
  const numberOf = (name: string): number => {
    const match = new RegExp(`const ${name} = ([0-9.]+)\\b`).exec(ring)
    expect(match, `PercentRing.tsx 里找不到 const ${name} = <数字>`).not.toBeNull()
    return Number(match?.[1])
  }
  /** 一个属性在整份文件里的全部数字值（图标有两个圆：轨道与弧，几何要逐值相同）。 */
  const attributes = (name: string): number[] =>
    [...icon.matchAll(new RegExp(`\\s${name}="([0-9.]+)"`, 'g'))].map((match) => Number(match[1]))

  /**
   * 极简 XML 良构检查 —— 够拦住「浏览器把 SVG 当图片解析时直接失败」那一类。
   * 真源是 XML 规范；这里只实现这种文件会踩到的三条：**注释里不许出现连续两个连字符**、
   * 标签必须成对、属性值必须带引号。
   */
  function xmlProblems(source: string): string[] {
    const problems: string[] = []
    const body = source.replace(/<!--([\s\S]*?)-->/g, (comment, inner: string) => {
      if (inner.includes('--') || inner.endsWith('-'))
        problems.push(`注释里有连续连字符：${comment.slice(0, 40)}…`)
      return ''
    })
    const stack: string[] = []
    let cursor = 0
    for (const match of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g)) {
      if (body.slice(cursor, match.index).includes('<')) problems.push('标签外还有裸的 <')
      cursor = (match.index ?? 0) + match[0].length
      const [, closing, name, attributes, selfClosing] = match
      if (/(?:^|\s)[A-Za-z][\w:.-]*=(?!")/.test(attributes))
        problems.push(`${name} 有没带引号的属性`)
      if (closing === '/') {
        if (stack.pop() !== name) problems.push(`</${name}> 与开标签不对应`)
      } else if (selfClosing !== '/') {
        stack.push(name)
      }
    }
    if (body.slice(cursor).includes('<')) problems.push('末尾还有裸的 <')
    if (stack.length > 0) problems.push(`没有闭合的标签：${stack.join(', ')}`)
    return problems
  }

  it('是良构 XML —— 解析失败等于浏览器直接不画，插件页静默回落成默认图', () => {
    // 这条是**踩出来的**：第一版把宿主那几条 token 的原名（以两个连字符开头）写进了 XML 注释，
    // 而规范不许注释里出现连续连字符 —— 浏览器当图片解析直接失败，界面上一声不响地用回默认图形。
    // 宿主不校验它（`iconOf()` 只把字节编成 data URL、按图片交给浏览器），所以只能我们自己守。
    const source = readFileSync('icon.svg', 'utf8')
    expect(xmlProblems(source)).toEqual([])
    // 反向控制：判据本身要有牙齿。
    expect(xmlProblems('<svg><!-- a -- b --></svg>')).not.toEqual([])
    expect(xmlProblems('<svg><circle r="1"></svg>')).not.toEqual([])
    expect(xmlProblems('<svg><circle r=1 /></svg>')).not.toEqual([])
  })

  it('就是那个环的等比放大：墨迹外径 18，四周各留 9', () => {
    // 官方配方的量：36 画布 + 四周留 8–9（agent-team-profile/icon.svg 的图形正好 18.0 见方）。
    const view = numberOf('VIEW')
    const stroke = numberOf('STROKE')
    const radius = view / 2 - numberOf('RING_INSET') - stroke / 2
    // 两个圆（轨道 + 弧）几何逐值相同：图标是那条环，不是另画的一圈。
    expect((icon.match(/<circle/g) ?? []).length, 'icon.svg 里的圆数（轨道 + 弧）').toBe(2)
    expect(attributes('r'), '两个圆的半径都必须等于环的半径').toEqual([radius, radius])
    expect(attributes('stroke-width'), '两个圆的笔画都必须等于环的笔画').toEqual([stroke, stroke])
    expect(icon, '接缝必须在 12 点（照环的 rotate(-90 <center> <center>)）').toContain(
      `rotate(-90 ${view / 2} ${view / 2})`,
    )
    const scale = Number(/scale\(([0-9.]+)\)/.exec(icon)?.[1])
    expect(Number.isFinite(scale), 'icon.svg 里找不到 scale(<数字>)').toBe(true)
    const ink = (radius + stroke / 2) * scale
    expect(ink, '放大后的墨迹外半径（36 画布上四周留的就是它）').toBeCloseTo(9, 6)
    expect(36 - 2 * ink, '图形本体').toBeCloseTo(18, 6)
  })

  it('弧长 70%，写的就是组件在 ratio=0.7 时算出来的那两个数', () => {
    const radius = numberOf('VIEW') / 2 - numberOf('RING_INSET') - numberOf('STROKE') / 2
    const circumference = 2 * Math.PI * radius
    const round3 = (value: number): number => Math.round(value * 1000) / 1000
    expect(icon).toContain(
      `stroke-dasharray="${round3(circumference * 0.7)} ${round3(circumference)}"`,
    )
    expect(icon, '线帽与环一致（圆头）').toContain('stroke-linecap="round"')
  })

  it('轨道圈在：底色是中性灰加四成半不透明度（跟随主题的那条 token 烘不进来）', () => {
    // 环的轨道用的是「跟随主题的半透明色」——亮 12% 黑、暗 16% 白；静态资源烘不了主题，
    // 所以这里取中性的 neutral-500（亮暗同值）加 45%：落在白底上 ≈ rgb(197,199,201)、
    // 落在深色底上 ≈ rgb(86,88,92)，与两种主题各自的轨道观感同一档，又明显比弧轻。
    expect(icon, '轨道那一圈没有 dasharray（整圈），弧才有').toMatch(
      /<circle[^>]*stroke="#7F8287"[^>]*\/>/,
    )
    expect(icon).toContain('stroke-opacity="0.45"')
    expect((icon.match(/stroke-dasharray/g) ?? []).length, '只有弧带 dasharray').toBe(1)
  })

  it('颜色写死的是环在 warning 档用的那个值', () => {
    // --dsw-alias-state-warn-primary = --dsw-static-amber-500 = rgb(245, 158, 11)，宿主
    // design-platform.css 的亮、暗两块表里逐字相同 —— 所以「亮暗都成立」是官方定的，不是我们挑的。
    expect(icon).toContain('stroke="#F59E0B"')
    expect(icon).not.toContain('currentColor')
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
    const missing = moduleStylesheets().flatMap((file) =>
      translucentMenusWithoutBackdrop(readFileSync(file, 'utf8')).map(
        (selectors) => `${file} ${selectors}`,
      ),
    )
    expect(missing, `这些规则画了菜单填充却没有 backdrop-filter：\n${missing.join('\n')}`).toEqual(
      [],
    )
  })

  it('扫描器真的看到了那个菜单表面（否则上一条是永不触发的假绿）', () => {
    // 与「活文档」那条同一个道理：walk 坏掉、或者唯一的消费者被改了命名，
    // 上一条会静默变成一条永远为真的守卫。这条钉住「扫到了什么」。
    const css = readFileSync('src/client/sidebar/BalancePopover.module.css', 'utf8')
    expect(translucentMenusWithoutBackdrop(css)).toEqual([])
    expect(parseCssRules(css).some((rule) => rule.selectors.includes('.panel::before'))).toBe(true)
    expect(
      parseCssRules(css)
        .find((rule) => rule.selectors.includes('.panel::before'))
        ?.declarations.find(([property]) => property === 'background')?.[1],
    ).toBe('var(--dsw-specific-menu)')
    // 反向控制：把滤镜删掉必须被抓出来（判据本身有牙齿）。
    expect(
      translucentMenusWithoutBackdrop('.a::before { background: var(--dsw-specific-menu); }'),
    ).toEqual(['.a::before'])
  })
})

/**
 * 文档内的相对链接必须指向真实存在的文件。
 *
 * 这条把 [docs/AGENTS.md](../docs/AGENTS.md) 那句「改完跑一次链接校验」变成**机器执行**的 ——
 * 从前它在根 AGENTS.md 的「常用命令」里找不到对应命令，是一句没有落点的要求，
 * 于是重命名文件、搬目录、删章节时链接会静默烂掉（本轮对账就修了几处）。
 *
 * **决策与依据记录（`.agents/notes/`）与复盘不查**：它们写死当时的事实、按规则不追改，
 * 里面的链接指向当年的路径是正常的 —— 让红线去逼改冻结记录，是拿规矩打规矩。
 */
describe('文档链接', () => {
  /** 仓库里会被当文档读的 markdown；跳过依赖与产物。 */
  function docs(dir = '.'): string[] {
    const found: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = dir === '.' ? entry.name : `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (['node_modules', 'lib', '.git', '.pre-commit'].includes(entry.name)) continue
        found.push(...docs(path))
        continue
      }
      if (!entry.name.endsWith('.md')) continue
      if (path.startsWith('.agents/') || path.startsWith('docs/postmortem/')) continue
      found.push(path)
    }
    return found
  }

  /**
   * 取一条相对链接的目标（相对本文件所在目录解析）。
   *
   * 跳过：外链（scheme）、纯锚点、以及 `<...>` 包起来的占位写法（那种本来就指不到文件）。
   */
  function offlineTargets(source: string): string[] {
    const targets: string[] = []
    for (const match of source.matchAll(/\]\(([^)\s]+)\)/g)) {
      const raw = match[1]
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue // http: / mailto: / …
      if (raw.startsWith('#')) continue
      if (raw.startsWith('<')) continue
      targets.push(raw.split('#')[0])
    }
    return targets.filter((target) => target !== '')
  }

  it('每一条相对链接都指得到文件', () => {
    const broken: string[] = []
    const files = docs()
    // 反向控制：这条守卫必须真的扫到了东西，否则「没坏链」是空转的假绿。
    expect(files.length, '被扫描的 markdown 数量').toBeGreaterThan(30)
    for (const file of files) {
      const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.'
      for (const target of offlineTargets(readFileSync(file, 'utf8'))) {
        const resolved = target.startsWith('/') ? `.${target}` : `${dir}/${target}`
        if (!existsSync(resolved)) broken.push(`${file} → ${target}`)
      }
    }
    expect(broken, `这些相对链接指不到文件：\n${broken.join('\n')}`).toEqual([])
  })

  it('判据本身有牙齿（假链接必须被抓出来）', () => {
    expect(offlineTargets('[x](./no-such-file-xyz.md)')).toEqual(['./no-such-file-xyz.md'])
    // 外链、纯锚点、中文全角括号里的锚点都不该被当成待解析路径。
    expect(offlineTargets('[a](https://example.com/x.md)')).toEqual([])
    expect(offlineTargets('[b](#某节)')).toEqual([])
    expect(offlineTargets('[c](docs/ARCHITECTURE.md#关键决策)')).toEqual(['docs/ARCHITECTURE.md'])
  })
})

/**
 * 核心活文档的**首行标题**必须还是它自己。
 *
 * **为什么需要这条**：上面两条文档红线只查「链接指不指得到」与「有没有抄实测值」，
 * 而**整份文件被别的文档覆盖**时两者都仍然成立 —— 文件还在、格式合法、链接可解析、
 * 没有会漂的值，于是 `npm test` 全绿，而那份文档的**职责内容已经消失**。
 * 本轮真发生过一次：`docs/UI-HANDOFF.md` 被整份换成了另一个文件的内容（193 行 → 734 行），
 * 三条红线一条都没响，靠人眼看行数才发现。标题是这类损坏最廉价、最稳定的指纹。
 *
 * 标题口径按命名策略：子目录文档用 `# <目录>/ — <职责>` 或主题名；
 * 根文档用裸项目名（门面允许 HTML 居中 h1，所以根 README 的标题在第 6 行）。
 */
describe('核心活文档的首行标题', () => {
  /** 首行即标题：`# <对象> — <一句话说明>`。 */
  const TITLED = [
    ['AGENTS.md', '# ds-balance — 维护索引'],
    ['docs/README.md', '# docs/ — 活文档'],
    ['docs/ARCHITECTURE.md', '# ds-balance 架构说明'],
    ['docs/UI-HANDOFF.md', '# UI 侧契约与移交'],
    ['docs/BACKEND-CONTRACTS.md', '# 后端契约'],
  ] as const

  for (const [file, title] of TITLED) {
    it(`${file} 的首行标题仍是它自己`, () => {
      const first = readFileSync(file, 'utf8').split('\n')[0]?.trim()
      expect(first, `${file} 的首行不再是它自己的标题 —— 整份文件可能被覆盖了`).toBe(title)
    })
  }

  it('根 README 的标题仍是裸项目名（门面用 HTML 居中 h1）', () => {
    // 门面首屏是展示层：`<p align="center">` + `<h1 align="center">项目名</h1>`。
    // 标题文字本身仍须符合「裸项目名」，不因居中而变形。
    const head = readFileSync('README.md', 'utf8').split('\n').slice(0, 8).join('\n')
    expect(head).toContain('<h1 align="center">dsh-ds-balance</h1>')
  })

  it('判据本身有牙齿（被覆盖的标题必须被抓出来）', () => {
    // 反向控制：拿一份真实文件的首行去比对**另一个**文件的标题，必须不相等。
    const handoff = readFileSync('docs/UI-HANDOFF.md', 'utf8').split('\n')[0]?.trim()
    const readme = readFileSync('docs/README.md', 'utf8').split('\n')[0]?.trim()
    expect(handoff).not.toBe(readme)
    // 而本轮那次事故的特征正是「ui-handoff 的首行变成了别的文档的 frontmatter」。
    expect(handoff?.startsWith('# '), '首行应当是一级标题').toBe(true)
  })
})

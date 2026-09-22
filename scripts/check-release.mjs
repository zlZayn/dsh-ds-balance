/**
 * 发布前检查。
 *
 * 本仓库现在是**发布态**：`dsh.bundle.patch` 已加回、`private` 已去掉。
 *
 * 为什么曾经没有它：宿主在跑 `dsh plugin` 时会把任何声明它的已装包回填进
 * `dsh.profile.bundles`，与 patch 层的 insert 行形成双挂载；开发期因此刻意去掉。
 * 发布态又必须声明它，否则装出来的包没有 bundle 层 —— 那条坑改由根 AGENTS.md 的
 * 「重启前必须再确认一次」把守。
 *
 * 本脚本把「发布态该有什么」变成可执行断言，避免靠人记得。
 *
 * 其中一组是**插件展示元数据**（插件页上的标题与描述）：宿主**直接读包内的**
 * `locale/*.json` 与 `package.json`，一行代码都不经过我们 —— 所以「文件在不在、
 * 有没有被 `exports` 与 `files` 覆盖」只能在这里守。覆盖不全时宿主**静默回落**
 * （标题退成包名、描述退成 `package.json.description`），界面上不报错；
 * 回落链与字段规则见 locale/AGENTS.md。
 *
 * 判据与宿主自己的校验器（`scripts/verify-package-meta.ts`）同形：它按同样的规则
 * 扫官方那些包，我们这里扫自己 —— 两边对「这个文件进不进包」必须给同一个答案。
 *
 * 退出码：0 = 全过 / 1 = 有未过 / 2 = 前置条件缺失（读不到 `package.json`）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'

const failures = []
let pkg
try {
  pkg = JSON.parse(readFileSync('package.json', 'utf8'))
} catch (error) {
  console.error('读不到 package.json —— 发布检查的前置条件不成立。')
  console.error(String(error))
  process.exit(2)
}

/** 断言一条发布态不变量。 */
function require_(label, ok, hint) {
  if (!ok) failures.push(`${label} —— ${hint}`)
}

require_(
  'dsh.bundle.patch',
  pkg.dsh?.bundle?.patch === './cordis.patch.yml',
  '开发期会去掉它以免被回填进 profile bundles；发布前必须加回。',
)
require_('private', pkg.private !== true, '发布前要移除 private: true。')
require_('engines.dsh', typeof pkg.engines?.dsh === 'string', '宿主兼容范围必须声明。')
require_('files 含 cordis.patch.yml', Array.isArray(pkg.files) && pkg.files.includes('cordis.patch.yml'), 'bundle 层依赖它。')
require_('LICENSE 存在', existsSync('LICENSE'), 'package.json 声明 MIT，仓库里必须有对应文件。')

/**
 * npm 的 `files` 语义：先看有没有正面模式覆盖，再看不被否定模式排除。
 * 判据与宿主校验器的 `published()` 同形 —— 目录模式要按「它下面的所有文件」解释。
 */
function published(file, files) {
  const covered = (pattern) => {
    const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
    return normalized === '.' || normalized === ''
      || matchesGlob(file, normalized) || matchesGlob(file, `${normalized}/**`)
  }
  return files.some((pattern) => !pattern.startsWith('!') && covered(pattern))
    && !files.some((pattern) => pattern.startsWith('!') && covered(pattern.slice(1)))
}

/** 只认 `*`（段内）与 `**`（跨段）两种通配 —— 够读 `files` 里的模式，不引依赖。 */
function matchesGlob(file, pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const body = escaped.replace(/\*\*\//g, '(?:.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')
  return new RegExp(`^${body}$`).test(file)
}

/** 非空字符串。 */
function isText(value) {
  return typeof value === 'string' && value.trim() !== ''
}

/** 读一个 JSON 文件；读不到或解析失败记账后返回 undefined。 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    failures.push(`${file} —— 读不到或不是合法 JSON：${String(error)}`)
    return undefined
  }
}

const LOCALE_DIR = 'locale'
const localeFiles = existsSync(LOCALE_DIR)
  ? readdirSync(LOCALE_DIR).filter((name) => name.endsWith('.json')).sort()
  : []

// 宿主先解析 locale/en.json，再枚举同目录下的每一个 *.json；两者都经 Node 子路径导出解析，
// 所以 exports 与 files 少覆盖一个，装出来的包就少一个能读到的语言文件。
require_('locale 目录存在', existsSync(LOCALE_DIR), '插件展示元数据的家。')
require_('locale/en.json 是发现入口', localeFiles.includes('en.json'), '宿主先解析它；缺它时其余语言文件根本不会被读。')
require_(
  'exports 暴露 ./locale/*.json',
  pkg.exports?.['./locale/*.json'] === './locale/*.json',
  '宿主经 Node 解析读语言文件；没有这条子路径导出，一个都读不到。',
)
require_(
  'exports 暴露 ./package.json',
  pkg.exports?.['./package.json'] === './package.json',
  '标题与描述的回落位、以及 icon 声明，都从导出的清单里读。',
)

for (const name of localeFiles) {
  const file = `${LOCALE_DIR}/${name}`
  const language = name.slice(0, -5)
  require_(
    `${file} 的文件名是语言 id`,
    /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language),
    '宿主拿文件名当语言 id，形状不合法会让整包元数据降级成一条诊断。',
  )
  require_(
    `files 收录 ${file}`,
    Array.isArray(pkg.files) && published(file, pkg.files),
    '装出来的包里没有它，只有本地开发时看得见 —— 插件页会静默回落成包名。',
  )
  const parsed = readJson(file)
  if (parsed === undefined) continue
  const meta = parsed.meta
  require_(`${file} 的 meta.title`, isText(meta?.title), '标题必须是非空字符串：字段名写错或写成空串都等于没写。')
  require_(`${file} 的 meta.description`, isText(meta?.description), '描述同上。')
}

if (pkg.icon !== undefined) {
  require_(
    'files 收录声明的图标',
    typeof pkg.icon === 'string' && Array.isArray(pkg.files) && published(pkg.icon.replace(/^\.\//, ''), pkg.files),
    '图标必须自包含并且进包，否则插件页只剩默认图。',
  )
}

if (failures.length > 0) {
  console.error('release check failed:')
  for (const line of failures) console.error(`  - ${line}`)
  process.exit(1)
}
console.log('release check passed')

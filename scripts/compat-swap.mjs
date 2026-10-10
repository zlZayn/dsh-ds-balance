#!/usr/bin/env node
/**
 * 宿主兼容性换版：把 `@deepseek-ai/dsh-*` 的声明区间换到指定的 dist-tag 线上。
 *
 * 用法：
 *   node scripts/compat-swap.mjs check                # 列出各包在 latest / next / alpha 上的版本
 *   node scripts/compat-swap.mjs swap --line next                       # 改写 package.json，再跑裸 npm install
 *   node scripts/compat-swap.mjs swap --line 0.1.7-rc --only 0.1.7-rc  # 按版本前缀换族并临时收窄（测低族）
 *   node scripts/compat-swap.mjs verify --line next                     # 断言 node_modules 里真的装在目标版本上
 *
 * 换版**保形**：只换版本号，运算符（`^` / `>=` / `~` …）原样保留 —— 见 swapRange。
 *
 * 为什么要有 `verify`：`npm install` 会**假绿** —— 它可能失败，而 node_modules 停在旧版本上，
 * 于是测试跑在旧依赖上、给出与事实相反的信号。换版后必须回头看实际装到了什么。
 *
 * 包在某条线上没有版本时，按它**声明在哪**分档（与 dsh-zhihu-search 同一条规则）：
 *   出现在 `peerDependencies` → **失败**：声明面点名了线上不存在的版本，使用者按这个区间装不出来。
 *   只在 `devDependencies`     → **告警并跳过**：那只影响本地类型检查与构建，不影响使用者装本插件。
 *
 * 退出码：0 = 通过 / 1 = 有未过 / 2 = 用法错误
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 只换这一撮。
 * `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery` 不带 `dsh-` 前缀，
 * 天然落在替换面之外 —— 它们的 next 线比 latest 还旧，换过去等于降级。
 */
const PREFIX = '@deepseek-ai/dsh-'

/**
 * 宿主本体：它在 `engines.dsh` 里，不在任何依赖段。
 *
 * **`engines.dsh` 必须与受管包一起换** —— 红线（test/redlines.test.ts 的「每个
 * `@deepseek-ai/dsh-*` 区间与 `engines.dsh` 逐字相同」）要求两者逐字相同。
 * 换版只动依赖段时，swap 之后 23 处全变成新线版本而 `engines.dsh` 留在旧线，
 * 那条红线**必然红**，与宿主兼不兼容无关 —— 每周 next 线往前推一个补丁位就触发一次，
 * 且红的恰好是会掩盖真正不兼容点的那一条（2026-10-05 那轮实测，见 .agents/notes/）。
 *
 * 它不带 `PREFIX`（`dsh-` 带尾横线，宿主本体没有），所以天然落在 `managedNames` 之外，
 * 必须由本函数单独处理。
 */
const HOST_PACKAGE = '@deepseek-ai/dsh'

/** 声明区间可能出现的位置。`engines.dsh` 单独处理 —— 它不在任何一个依赖段里。 */
const MANIFEST_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies']

/**
 * 认识的区间形状：**单个可选运算符 + 一个版本号**，后面可跟一个 `<上界`。
 *
 * 上界是本仓声明面的固定形态（`>=下限 <下一族`），所以它是形状的一部分而不是随便的尾巴。
 * 运算符与上界原样保留（见 {@link swapRange}）：形状由维护者定，脚本只换版本号。
 * 认不出来的形状宁可报错停下 —— 空格分隔的多段、`*`、`1.x`、`workspace:^`
 * 换成「一个版本号」都会丢信息，而「每周巡检悄悄改坏声明面」比「巡检红一次」贵得多。
 */
const RANGE_SHAPE =
  /^(>=|<=|>|<|=|\^|~)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:\s+(<)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?))?$/

/** 族之间用 `||` 分隔（并集）。 */
const FAMILY_SEPARATOR = '||'

/** 一个族：`{ op, version, upperOp, upper }`。 */
function parseFamily(branch) {
  const shape = RANGE_SHAPE.exec(branch.trim())
  if (shape === null) {
    throw new Error(
      `不认识的区间形状：${branch.trim()}（换版只支持「可选运算符 + 版本号」外加一个 <上界，请手工改这一条）`,
    )
  }
  return { op: shape[1] ?? '', version: shape[2], upperOp: shape[3] ?? '', upper: shape[4] ?? '' }
}

/** 族写回字符串（运算符与上界原样保留）。 */
function formatFamily(family) {
  const upper = family.upperOp === '' ? '' : ' ' + family.upperOp + family.upper
  return family.op + family.version + upper
}

/** 把声明区间拆成若干个族（`||` 分隔的并集）。 */
function parseFamilies(declared) {
  return declared.split(FAMILY_SEPARATOR).map((part) => parseFamily(part))
}

/** 把族列表写回完整声明区间（`||` 连接）。 */
function formatFamilies(families) {
  return families.map(formatFamily).join(' ' + FAMILY_SEPARATOR + ' ')
}

/** 版本的 `major.minor.patch` 元组（族的身份）。 */
function tupleOf(version) {
  const match = /^(\d+\.\d+\.\d+)/.exec(version)
  if (match === null) throw new Error(`版本号读不出元组：${version}`)
  return match[1]
}

/**
 * 把族列表里**元组与 target 相同**的那一族换到 `version`，其余族原样保留。
 *
 * 两种情形（这是「保留旧族、只替换目标族」的全部含义）：
 *   - **多族**：必须命中同元组的那一族；找不到抛错（换上去等于新增一条承诺，不该静默做）。
 *   - **单族**：把那一族本身换到 target（允许跨元组）—— 单族表达「就承诺这一条线」。
 */
function swapTargetFamily(families, version) {
  const tuple = tupleOf(version)
  const index = families.findIndex((family) => tupleOf(family.version) === tuple)
  const at = index === -1 && families.length === 1 ? 0 : index
  if (at === -1) {
    throw new Error(
      `声明面里没有 ${tuple} 这一族（现有：${families.map((f) => f.version).join(' / ')}）` +
        ' —— 换上去等于新增一条承诺，请手工加族后再换。',
    )
  }
  const next = families.slice()
  const after = { ...next[at], version }
  if (formatFamily(next[at]) === formatFamily(after)) return { families: next, changed: false }
  next[at] = after
  return { families: next, changed: true }
}

/** 从族列表里删掉下限版本以 `prefix` 开头的那一族（`--drop`）。找不到不报错（幂等）。 */
function dropFamily(families, prefix) {
  const kept = families.filter((family) => !family.version.startsWith(prefix))
  return { families: kept, dropped: families.length - kept.length }
}

/**
 * 从族列表里**只保留**下限版本以 `prefix` 开头的那一族（`--only`）。
 *
 * 为什么需要它：声明面是并集，而 npm 解析并集区间时给每个包选的是**匹配集里最高的**那个版本。
 * 所以「测承诺里的某一族」（尤其低族）不能靠保留全部族 —— 那样装出来的永远是最高族。
 * 2026-10-10 实测（姊妹仓 dsh-zhihu-search 同一改动）：保留两族换到低族时，`npm install`
 * 装到最高族，`verify` 全红。`--only` 把声明面**临时收窄成只有目标族**；收窄后的清单是
 * 一次性测量、**不提交**（提交的那份始终是并集声明面）。
 */
function keepOnlyFamily(families, prefix) {
  const kept = families.filter((family) => family.version.startsWith(prefix))
  return { families: kept, kept: kept.length }
}

/** 关心的 dist-tag。 */
const LINES = ['latest', 'next', 'alpha']

const USAGE = `用法：
  node scripts/compat-swap.mjs check
  node scripts/compat-swap.mjs swap --line <${LINES.join('|')}|版本前缀如 0.1.7-rc> [--drop <前缀> | --only <前缀>]
  node scripts/compat-swap.mjs verify --line <${LINES.join('|')}|版本前缀>
  node scripts/compat-swap.mjs selftest

--drop <前缀>：换线时显式删掉一族（放弃那条线的承诺）。
--only <前缀>：测某一族时把声明面**临时收窄成只有那一族** —— 并集区间会被 npm 解析成
               「装匹配集里最高的族」，不收窄就测不到低族。收窄后的清单是一次性的，不提交。

退出码：0 = 通过 / 1 = 有未过 / 2 = 用法错误`

const tagsCache = new Map()
const versionsCache = new Map()

/** 从 npm registry 读一个包的 dist-tags。用 HTTP 而不是 `npm view`：不依赖 shell，也更快。 */
async function distTags(name) {
  if (tagsCache.has(name)) return tagsCache.get(name)
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  if (!response.ok) throw new Error(`registry 查 ${name} 回了 ${response.status}`)
  const body = await response.json()
  const tags = body['dist-tags'] ?? {}
  tagsCache.set(name, tags)
  return tags
}

/** 读一个包的全部已发布版本号。 */
async function publishedVersions(name) {
  if (versionsCache.has(name)) return versionsCache.get(name)
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  if (!response.ok) throw new Error(`registry 查 ${name} 回了 ${response.status}`)
  const body = await response.json()
  const versions = Object.keys(body.versions ?? {})
  versionsCache.set(name, versions)
  return versions
}

/**
 * 把一条「线」解析成版本。两种线：
 *   - dist-tag（`latest`/`next`/`alpha`）→ 读该 tag 指向的版本；
 *   - **版本前缀**（其余一切，如 `0.1.7-rc`）→ 取该前缀下**最高的**已发布版本。
 *
 * 版本前缀这条给「没有 dist-tag 指向那一族」的场景用（实测：没有任何 tag 指向 0.1.7 族）。
 */
async function resolveLine(name, line) {
  if (LINES.includes(line)) return (await distTags(name))[line]
  const versions = await publishedVersions(name).catch(() => [])
  const matching = versions.filter((version) => version.startsWith(line)).sort()
  return matching.length === 0 ? undefined : matching[matching.length - 1]
}

function readManifest() {
  return JSON.parse(readFileSync('package.json', 'utf8'))
}

/** 清单里所有受管的包名。 */
function managedNames(manifest) {
  const names = new Set()
  for (const field of MANIFEST_FIELDS) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name.startsWith(PREFIX)) names.add(name)
    }
  }
  return [...names].sort()
}

function usageError(message) {
  console.error(message)
  console.error(USAGE)
  process.exit(2)
}

function parseLine(argv) {
  const lineIndex = argv.indexOf('--line')
  if (lineIndex === -1) usageError('缺少 --line')
  const line = argv[lineIndex + 1]
  if (!line || line.startsWith('--')) usageError('--line 后面要跟一条线（dist-tag 或版本前缀）')
  return line
}

/**
 * 解析子命令参数：`--line <线> [--drop <前缀> | --only <前缀>]`。
 * @param argv - 位置参数。
 * @returns `{ line, dropPrefix, onlyPrefix }`。
 */
function parseArgs(argv) {
  const line = parseLine(argv)
  /** 取某个开关后面的值，缺值即用法错误。 */
  const valueOf = (flag) => {
    const index = argv.indexOf(flag)
    if (index === -1) return undefined
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) usageError(`${flag} 后面要跟一个版本前缀`)
    return value
  }
  const dropPrefix = valueOf('--drop')
  const onlyPrefix = valueOf('--only')
  if (dropPrefix !== undefined && onlyPrefix !== undefined) {
    usageError('--drop 与 --only 只能给一个（都是「改声明面的族集合」）')
  }
  return { line, dropPrefix, onlyPrefix }
}

async function check() {
  const manifest = readManifest()
  const names = managedNames(manifest)
  const rows = []
  for (const name of names) {
    const tags = await distTags(name)
    const declared = MANIFEST_FIELDS.map((field) => manifest[field]?.[name]).filter(Boolean)
    rows.push({ name, declared: declared.join(' / '), ...tags })
  }

  const width = Math.max(...rows.map((row) => row.name.length), 4)
  console.log(
    `${'包'.padEnd(width)}  ${'声明'.padEnd(18)} ${LINES.map((l) => l.padEnd(18)).join('')}`,
  )
  for (const row of rows) {
    const cells = LINES.map((line) => String(row[line] ?? '-').padEnd(18)).join('')
    console.log(`${row.name.padEnd(width)}  ${row.declared.padEnd(18)} ${cells}`)
  }
  console.log(`\n共 ${rows.length} 个受管包（前缀 ${PREFIX}）。`)
  return 0
}

/**
 * 把 plan 应用到 manifest 上，就地改写，返回改了几处。
 *
 * 抽成纯函数是为了让 {@link selftest} 能**执行**它（不联网、不装依赖）：这条路径上曾经漏掉
 * `engines.dsh`，而漏掉的症状要等每周巡检 + 那条红线一起发作才看得见。
 *
 * 声明面是若干个族（`||`）的并集：换版语义是「保留旧族、只替换目标族」；`--drop` 删一族、
 * `--only` 临时收窄成只有目标族。
 * @param manifest - 待改写的 package.json（就地修改）。
 * @param plan - `[{ name, version }]`，来自 swap() 的线上版本查询。
 * @param hostVersion - 宿主本体在目标线上的版本；用于换 `engines.dsh`。
 * @param dropPrefix - 要显式删掉的族前缀（`--drop`），无则undefined。
 * @param onlyPrefix - 要**只保留**的族前缀（`--only`，测低族时临时收窄），无则 undefined。
 * @returns 实际改写的处数（0 = 已经是目标线）。
 */
function applyPlan(manifest, plan, hostVersion, dropPrefix, onlyPrefix) {
  let touched = 0

  /**
   * 把一条声明换到目标版本：先按 `--drop`/`--only` 改族集合，再把目标族换到 version。
   * @param declared - 当前声明。
   * @param version - 目标版本。
   * @returns `{ next, changed }` 新声明与是否改动。
   */
  const swapOne = (declared, version) => {
    let families = parseFamilies(declared)
    let reshaped = false
    if (dropPrefix !== undefined) {
      const dropped = dropFamily(families, dropPrefix)
      families = dropped.families
      reshaped = dropped.dropped > 0
    } else if (onlyPrefix !== undefined) {
      const kept = keepOnlyFamily(families, onlyPrefix)
      if (kept.kept === 0) {
        throw new Error(
          `--only ${onlyPrefix} 在声明面里没有匹配族（现有：${parseFamilies(declared)
            .map((f) => f.version)
            .join(' / ')}）`,
        )
      }
      reshaped = kept.kept !== parseFamilies(declared).length
      families = kept.families
    }
    if (families.length === 0) {
      throw new Error('改族之后声明面空了 —— 至少要留一族，请检查前缀')
    }
    const swapped = swapTargetFamily(families, version)
    const next = formatFamilies(swapped.families)
    return { next, changed: reshaped || swapped.changed || next !== declared }
  }

  for (const field of MANIFEST_FIELDS) {
    const block = manifest[field]
    if (!block) continue
    for (const { name, version } of plan) {
      if (!(name in block)) continue
      const { next, changed } = swapOne(block[name], version)
      if (changed) {
        console.log(`${field}: ${name} ${block[name]} -> ${next}`)
        block[name] = next
        touched += 1
      }
    }
  }

  // `engines.dsh` 与上面那一撮**必须同进同退**（HOST_PACKAGE 的注释说明理由）。
  // 宿主本体是声明面的一半：使用者按它选宿主，按 peer 装插件，两者不一致时装不出可用的宿主。
  const declaredHost = manifest.engines?.dsh
  if (typeof declaredHost !== 'string') {
    throw new Error('package.json 没有声明 engines.dsh —— 换版会把它落在半路，请先补上')
  }
  const host = swapOne(declaredHost, hostVersion)
  if (host.changed) {
    console.log(`engines.dsh: ${HOST_PACKAGE} ${declaredHost} -> ${host.next}`)
    manifest.engines.dsh = host.next
    touched += 1
  }
  return touched
}

async function swap(line, dropPrefix, onlyPrefix) {
  const manifest = readManifest()
  const names = managedNames(manifest)
  const plan = []
  const skipped = []
  for (const name of names) {
    const version = await resolveLine(name, line)
    if (!version) {
      // 判定分档见文件头：只有 peer 缺失才红。
      if (name in (manifest.peerDependencies ?? {})) {
        throw new Error(`${name} 在 ${line} 线上没有版本（它声明在 peerDependencies 里）`)
      }
      skipped.push(name)
      continue
    }
    plan.push({ name, version })
  }
  if (skipped.length > 0) {
    console.log(
      `跳过 ${skipped.length} 个仅 dev 声明的包（${line} 线上没有版本）：${skipped.join(', ')}`,
    )
  }

  const hostVersion = await resolveLine(HOST_PACKAGE, line)
  if (!hostVersion) {
    throw new Error(`宿主本体 ${HOST_PACKAGE} 在 ${line} 线上没有版本（engines.dsh 无从换起）`)
  }

  const touched = applyPlan(manifest, plan, hostVersion, dropPrefix, onlyPrefix)

  if (touched === 0) {
    console.log(`已经是 ${line} 线的版本，package.json 未改动。`)
  } else {
    writeFileSync('package.json', JSON.stringify(manifest, null, 2) + '\n')
    console.log(
      `\npackage.json 改了 ${touched} 处。回滚：git checkout package.json package-lock.json`,
    )
  }

  console.log(
    `\n跑裸 npm install（shell: true 只是为了在 Windows 上找到 npm.cmd，没有用 shell 特性）……`,
  )
  // 换线 = **从零装**。实测两道障碍，全是"旧线残留"：
  //   1. 锁文件记着换线前的解析 —— alpha 锁 + rc.2 manifest 直接 ERESOLVE。
  //   2. 已装的 node_modules 也是旧线的树 —— npm 拿已装的 dsh-brand@alpha 对抗要装的
  //      peer dsh-brand@^0.1.5-rc.2，同样 ERESOLVE。只有"无锁 + 空树"装得出来
  //      （探针 3 实测通过：verify 11/11 全落在目标线）。
  // 删掉两者，让 npm 只按新 manifest 解。回滚不变：git checkout 取回两个文件，
  // node_modules 由 install 重建。
  if (existsSync('package-lock.json')) {
    rmSync('package-lock.json')
    console.log('已删 package-lock.json（它记着换线前的解析）。')
  }
  if (existsSync('node_modules')) {
    rmSync('node_modules', { recursive: true, force: true })
    console.log('已删 node_modules（它装的是换线前那条线的树）。')
  }
  const result = spawnSync('npm', ['install'], { stdio: 'inherit', shell: true })
  if (result.status !== 0) {
    console.error(`npm install 退出码 ${result.status}`)
    return 1
  }
  console.log('\nnpm install 成功 —— 但这不代表装到了目标版本，接着跑 verify。')
  return verify(line)
}

async function verify(line) {
  const manifest = readManifest()
  const names = managedNames(manifest)
  let failed = 0
  let skipped = 0

  // `engines.dsh` 先验：它是声明面的一半，verify 漏掉它的话，半换过的 manifest
  // 会在依赖段全绿的情况下被读成「这次换版是干净的」。
  const expectedHost = await resolveLine(HOST_PACKAGE, line)
  const declaredHost = manifest.engines?.dsh
  if (expectedHost && typeof declaredHost === 'string') {
    try {
      const expectedRange = formatFamilies(
        swapTargetFamily(parseFamilies(declaredHost), expectedHost).families,
      )
      if (declaredHost === expectedRange) {
        console.log(
          `PASS  engines.dsh —— ${declaredHost}（${HOST_PACKAGE} 在 ${line} 线上是 ${expectedHost}）`,
        )
      } else {
        console.log(
          `FAIL  engines.dsh —— 声明 ${declaredHost}，${line} 线上的宿主本体是 ${expectedHost}，两者对不上`,
        )
        failed += 1
      }
    } catch (error) {
      console.log(`FAIL  engines.dsh —— ${error.message}`)
      failed += 1
    }
  }

  for (const name of names) {
    const expected = await resolveLine(name, line)
    if (!expected) {
      // 判定分档同 swap()：peer 缺失算失败，仅 dev 缺失告警跳过。
      if (name in (manifest.peerDependencies ?? {})) {
        console.log(`FAIL  ${name} —— 在 peerDependencies 里，但 ${line} 线上没有版本`)
        failed += 1
        continue
      }
      console.log(`WARN  ${name} —— 仅 devDependency，${line} 线上没有版本，本仓不受影响`)
      skipped += 1
      continue
    }
    const installedPath = join('node_modules', name, 'package.json')
    if (!existsSync(installedPath)) {
      console.log(`MISS  ${name} —— node_modules 里没有它`)
      failed += 1
      continue
    }
    const installed = JSON.parse(readFileSync(installedPath, 'utf8')).version
    const suffix = manifest.peerDependencies?.[name] ?? manifest.devDependencies?.[name] ?? ''
    if (installed !== expected) {
      console.log(
        `FAIL  ${name} —— 声明 ${suffix}，实际装到 ${installed}，${line} 线上是 ${expected}`,
      )
      failed += 1
      continue
    }
    console.log(`PASS  ${name} —— ${installed}`)
  }

  console.log('')
  if (failed > 0) {
    console.error(`${failed} 个包没有落在 ${line} 线上 —— 这次换版是假绿，别信它跑出来的绿。`)
    return 1
  }
  console.log(
    `${names.length - skipped} 个包全部落在 ${line} 线上${skipped > 0 ? `（另 ${skipped} 个仅 dev 声明，已跳过）` : ''}。`,
  )
  return 0
}

/**
 * 换版保形的自检表。
 *
 * 它是可执行的断言，不是散文：`test/compat-swap.test.ts` 跑这个子命令并要求退出码 0。
 * 为什么值得单独有：`swap` 会改 package.json，而它曾经无条件写回 `^` ——
 * 那样的错在**每周巡检**里才发作一次，等看见 diff 时形状早就漂了。
 * @returns 0 = 全部符合预期；1 = 有不符合的。
 */
function selftest() {
  const cases = [
    // 本仓声明面的实际形状（多族并集）：换目标族，保留旧族。
    [
      '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0',
      '0.2.0-rc.2',
      '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.2 <0.2.1-0',
    ],
    [
      '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0',
      '0.1.7-rc.2',
      '>=0.1.7-rc.2 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0',
    ],
    // 已经是目标版本时是空操作，但形状与其他族原样留下。
    [
      '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.2 <0.2.1-0',
      '0.2.0-rc.2',
      '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.2 <0.2.1-0',
    ],
    ['>=0.1.7-alpha.1', '0.1.8-alpha.1', '>=0.1.8-alpha.1'],
    ['^0.1.6-alpha.2', '0.1.7-alpha.1', '^0.1.7-alpha.1'],
    ['~1.2.3', '1.2.4', '~1.2.4'],
    ['1.2.3', '2.0.0', '2.0.0'],
    ['=1.2.3', '1.2.4', '=1.2.4'],
    ['<2.0.0', '1.9.9', '<1.9.9'],
    ['>= 0.1.7-alpha.1', '0.1.8-alpha.1', '>=0.1.8-alpha.1'],
  ]
  const rejects = [
    '1.x',
    '*',
    'workspace:^',
    'latest',
    '1.2',
    '>=1.0.0-alpha <2.0.0 || >=3.0.0',
    '',
  ]
  let failed = 0
  let passes = 0
  for (const [declared, version, expected] of cases) {
    let actual
    try {
      actual = formatFamilies(swapTargetFamily(parseFamilies(declared), version).families)
    } catch (error) {
      console.log(`FAIL  ${declared} → 抛错：${error.message}`)
      failed += 1
      continue
    }
    if (actual !== expected) {
      console.log(`FAIL  ${declared} → ${actual}（期望 ${expected}）`)
      failed += 1
      continue
    }
    console.log(`PASS  ${declared} → ${actual}`)
    passes += 1
  }
  for (const declared of rejects) {
    try {
      const actual = formatFamilies(swapTargetFamily(parseFamilies(declared), '9.9.9').families)
      console.log(`FAIL  ${JSON.stringify(declared)} 应当被拒，却给出了 ${actual}`)
      failed += 1
    } catch {
      console.log(`PASS  ${JSON.stringify(declared)} 被拒`)
      passes += 1
    }
  }

  // 声明面整份换过去，`engines.dsh` 必须**跟着走**。
  // 这是那条红线的对侧：它要求依赖段与 `engines.dsh` 逐字相同，而换版曾经只动依赖段 ——
  // swap 成功后两者必然不一致，那条红线每周必红，且红的地方恰好会盖住真正的不兼容点。
  const sample = {
    engines: { dsh: '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0', node: '>=20' },
    peerDependencies: {
      '@deepseek-ai/dsh-credentials': '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0',
    },
    devDependencies: {
      '@deepseek-ai/dsh-client-locale': '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0',
    },
  }
  const touched = applyPlan(
    sample,
    [
      { name: '@deepseek-ai/dsh-credentials', version: '0.2.0-rc.2' },
      { name: '@deepseek-ai/dsh-client-locale', version: '0.2.0-rc.2' },
    ],
    '0.2.0-rc.2',
    undefined,
    undefined,
  )
  const expectedUnion = '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.2 <0.2.1-0'
  const actualRanges = [
    ...new Set([
      sample.engines.dsh,
      ...Object.values(sample.peerDependencies),
      ...Object.values(sample.devDependencies),
    ]),
  ]
  if (actualRanges.length !== 1 || actualRanges[0] !== expectedUnion) {
    console.log(
      `FAIL  换版后 engines.dsh 与依赖段没有落到同一条并集上（应保留旧族）：${JSON.stringify(sample)}`,
    )
    failed += 1
  } else if (touched !== 3) {
    console.log(`FAIL  应当改写 3 处（两条依赖 + engines.dsh），实际 ${touched} 处`)
    failed += 1
  } else {
    console.log(
      `PASS  engines.dsh 与依赖段同进同退（旧族保留：${expectedUnion}，改写 ${touched} 处）`,
    )
    passes += 1
  }

  // `--only`：测某一族时把声明面**临时收窄成只有目标族**（并集区间会被 npm 解析成「装最高族」）。
  const onlyTarget = {
    engines: { dsh: '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0', node: '>=20' },
    peerDependencies: {
      '@deepseek-ai/dsh-credentials': '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0',
    },
  }
  const onlyTouched = applyPlan(
    onlyTarget,
    [{ name: '@deepseek-ai/dsh-credentials', version: '0.1.7-rc.2' }],
    '0.1.7-rc.2',
    undefined,
    '0.1.7',
  )
  const onlyRanges = [onlyTarget.engines.dsh, ...Object.values(onlyTarget.peerDependencies)]
  if (onlyRanges.length !== 2 || onlyRanges.some((r) => r !== '>=0.1.7-rc.2 <0.1.8-0')) {
    console.log(`FAIL  --only 0.1.7 没有把声明面收窄成只有目标族：${onlyRanges.join(' / ')}`)
    failed += 1
  } else if (onlyTouched !== 2) {
    console.log(`FAIL  --only 应当改写 2 处（一条依赖 + engines.dsh），实际 ${onlyTouched} 处`)
    failed += 1
  } else {
    console.log('PASS  --only 0.1.7 收窄成单族（>=0.1.7-rc.2 <0.1.8-0，两边同改）')
    passes += 1
  }

  // `--drop`：显式删掉一族，其余族保留。
  const dropped = dropFamily(
    parseFamilies('>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0'),
    '0.1.7',
  )
  const droppedText = formatFamilies(dropped.families)
  if (dropped.dropped === 1 && droppedText === '>=0.2.0-rc.1 <0.2.1-0') {
    console.log(`PASS  --drop 0.1.7 → ${droppedText}（删 1 族，保留另一族）`)
    passes += 1
  } else {
    console.log(`FAIL  --drop 结果不对：${droppedText}（删了 ${dropped.dropped} 族）`)
    failed += 1
  }

  // 反向控制：**多族**声明面缺目标族时必须抛错（换上去等于新增承诺，不静默加族）。
  let familyGuardFired = false
  try {
    swapTargetFamily(parseFamilies('>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0'), '0.2.1-rc.1')
  } catch {
    familyGuardFired = true
  }
  if (familyGuardFired) {
    console.log('PASS  声明面缺目标族时抛错（不会静默新增一条承诺）')
    passes += 1
  } else {
    console.log('FAIL  声明面缺目标族时没有抛错 —— 守卫没响')
    failed += 1
  }

  // 反向控制：`--only` 前缀无匹配族时必须抛错（不能把声明面清空）。
  let onlyGuardFired = false
  try {
    applyPlan(
      {
        engines: { dsh: '>=0.1.7-rc.1 <0.1.8-0' },
        peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.1.7-rc.1 <0.1.8-0' },
      },
      [{ name: '@deepseek-ai/dsh-tools', version: '0.3.0-rc.1' }],
      '0.3.0-rc.1',
      undefined,
      '0.3.0',
    )
  } catch {
    onlyGuardFired = true
  }
  if (onlyGuardFired) {
    console.log('PASS  --only 前缀无匹配族时抛错')
    passes += 1
  } else {
    console.log('FAIL  --only 前缀无匹配族时没有抛错 —— 守卫没响')
    failed += 1
  }

  console.log('')
  if (failed > 0) {
    console.error(`${failed} 条不符合预期 —— 换版会改坏声明面的形状，别信这次换版。`)
    return 1
  }
  console.log(`${passes} 条全部符合预期（共 ${passes + failed} 条）。`)
  return 0
}

const [command, ...rest] = process.argv.slice(2)
if (!command || command === '--help' || command === '-h') usageError(command ? '' : '缺少子命令')

let code
try {
  if (command === 'check') code = await check()
  else if (command === 'swap') {
    const { line, dropPrefix, onlyPrefix } = parseArgs(rest)
    code = await swap(line, dropPrefix, onlyPrefix)
  } else if (command === 'verify') code = await verify(parseLine(rest))
  else if (command === 'selftest') code = selftest()
  else usageError(`不认识的子命令：${command}`)
} catch (error) {
  console.error(error.message)
  code = 1
}
process.exit(code)

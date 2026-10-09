#!/usr/bin/env node
/**
 * 宿主兼容性换版：把 `@deepseek-ai/dsh-*` 的声明区间换到指定的 dist-tag 线上。
 *
 * 用法：
 *   node scripts/compat-swap.mjs check                # 列出各包在 latest / next / alpha 上的版本
 *   node scripts/compat-swap.mjs swap --line next     # 改写 package.json，再跑裸 npm install
 *   node scripts/compat-swap.mjs verify --line next   # 断言 node_modules 里真的装在目标版本上
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
 * 认识的区间形状：**单个可选运算符 + 一个版本号**。
 *
 * 运算符原样保留（见 {@link swapRange}）：形状由维护者定，脚本只换版本号。
 * 认不出来的形状宁可报错停下 —— `||`、空格分隔的多段、`*`、`1.x`、`workspace:^`
 * 换成「一个版本号」都会丢信息，而「每周巡检悄悄改坏声明面」比「巡检红一次」贵得多。
 * 所以要求版本号是**完整的** `x.y.z`（可带预发布段）。
 */
const RANGE_SHAPE =
  /^(>=|<=|>|<|=|\^|~)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/

/**
 * 保形换版：保留原有运算符，只替换版本号。
 *
 * 为什么不能硬编码 `'^' + version`：本仓的声明面统一写成 `>=0.1.7-alpha.1`，
 * 而换版曾经无条件写回 `^` —— 那样每周的 compat 巡检会把 `>=` 静默改回 `^`，
 * 形状与 `engines.dsh` 漂开，还产生一条没人看懂来源的 diff。
 * @param declared - 现有声明区间。
 * @param version - 目标线上该包的版本。
 * @returns 换版后的区间，运算符与原来一致。
 * @throws 区间不是「可选运算符 + 版本号」时抛出。
 */
function swapRange(declared, version) {
  const shape = RANGE_SHAPE.exec(declared.trim())
  if (shape === null) {
    throw new Error(
      `不认识的区间形状：${declared}（换版只支持「可选运算符 + 版本号」，请手工改这一条）`,
    )
  }
  return `${shape[1] ?? ''}${version}`
}

/** 关心的 dist-tag。 */
const LINES = ['latest', 'next', 'alpha']

const USAGE = `用法：
  node scripts/compat-swap.mjs check
  node scripts/compat-swap.mjs swap --line <${LINES.join('|')}>
  node scripts/compat-swap.mjs verify --line <${LINES.join('|')}>
  node scripts/compat-swap.mjs selftest

退出码：0 = 通过 / 1 = 有未过 / 2 = 用法错误`

const tagsCache = new Map()

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
  const index = argv.indexOf('--line')
  if (index === -1) usageError('缺少 --line')
  const line = argv[index + 1]
  if (!line) usageError('--line 后面要跟一个 dist-tag')
  if (!LINES.includes(line)) usageError(`不认识的 dist-tag：${line}`)
  return line
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
 * @param manifest - 待改写的 package.json（就地修改）。
 * @param plan - `[{ name, version }]`，来自 swap() 的线上版本查询。
 * @param hostVersion - 宿主本体在目标线上的版本；用于换 `engines.dsh`。
 * @returns 实际改写的处数（0 = 已经是目标线）。
 */
function applyPlan(manifest, plan, hostVersion) {
  let touched = 0
  for (const field of MANIFEST_FIELDS) {
    const block = manifest[field]
    if (!block) continue
    for (const { name, version } of plan) {
      if (!(name in block)) continue
      const next = swapRange(block[name], version)
      if (block[name] !== next) {
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
  const nextHost = swapRange(declaredHost, hostVersion)
  if (declaredHost !== nextHost) {
    console.log(`engines.dsh: ${HOST_PACKAGE} ${declaredHost} -> ${nextHost}`)
    manifest.engines.dsh = nextHost
    touched += 1
  }
  return touched
}

async function swap(line) {
  const manifest = readManifest()
  const names = managedNames(manifest)
  const plan = []
  const skipped = []
  for (const name of names) {
    const tags = await distTags(name)
    const version = tags[line]
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

  const hostTags = await distTags(HOST_PACKAGE)
  const hostVersion = hostTags[line]
  if (!hostVersion) {
    throw new Error(`宿主本体 ${HOST_PACKAGE} 在 ${line} 线上没有版本（engines.dsh 无从换起）`)
  }

  const touched = applyPlan(manifest, plan, hostVersion)

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
  const hostTags = await distTags(HOST_PACKAGE)
  const expectedHost = hostTags[line]
  const declaredHost = manifest.engines?.dsh
  if (expectedHost && typeof declaredHost === 'string') {
    try {
      const expectedRange = swapRange(declaredHost, expectedHost)
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
    const tags = await distTags(name)
    const expected = tags[line]
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
    ['>=0.1.7-alpha.1', '0.1.8-alpha.1', '>=0.1.8-alpha.1'],
    ['^0.1.6-alpha.2', '0.1.7-alpha.1', '^0.1.7-alpha.1'],
    ['~1.2.3', '1.2.4', '~1.2.4'],
    ['1.2.3', '2.0.0', '2.0.0'],
    ['=1.2.3', '1.2.4', '=1.2.4'],
    ['<2.0.0', '1.9.9', '<1.9.9'],
    ['>= 0.1.7-alpha.1', '0.1.8-alpha.1', '>=0.1.8-alpha.1'],
  ]
  const rejects = ['>=1.0.0 <2.0.0', '1.x || 2.x', '*', 'workspace:^', 'latest', '1.2', '']
  let failed = 0
  let passes = 0
  for (const [declared, version, expected] of cases) {
    let actual
    try {
      actual = swapRange(declared, version)
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
      const actual = swapRange(declared, '9.9.9')
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
    engines: { dsh: '>=0.2.0-rc.1', node: '>=20' },
    peerDependencies: { '@deepseek-ai/dsh-credentials': '>=0.2.0-rc.1' },
    devDependencies: { '@deepseek-ai/dsh-client-locale': '>=0.2.0-rc.1' },
  }
  const touched = applyPlan(
    sample,
    [
      { name: '@deepseek-ai/dsh-credentials', version: '0.2.0-rc.2' },
      { name: '@deepseek-ai/dsh-client-locale', version: '0.2.0-rc.2' },
    ],
    '0.2.0-rc.2',
  )
  const expectedSample = {
    engines: { dsh: '>=0.2.0-rc.2', node: '>=20' },
    peerDependencies: { '@deepseek-ai/dsh-credentials': '>=0.2.0-rc.2' },
    devDependencies: { '@deepseek-ai/dsh-client-locale': '>=0.2.0-rc.2' },
  }
  const actualRanges = [
    ...new Set([
      sample.engines.dsh,
      ...Object.values(sample.peerDependencies),
      ...Object.values(sample.devDependencies),
    ]),
  ]
  if (JSON.stringify(sample) !== JSON.stringify(expectedSample)) {
    console.log(`FAIL  换版后 engines.dsh 与依赖段没有落到同一条线上：${JSON.stringify(sample)}`)
    failed += 1
  } else if (touched !== 3) {
    console.log(`FAIL  应当改写 3 处（两条依赖 + engines.dsh），实际 ${touched} 处`)
    failed += 1
  } else if (actualRanges.length !== 1) {
    console.log(`FAIL  换版后声明面出现 ${actualRanges.length} 种区间：${actualRanges.join(' / ')}`)
    failed += 1
  } else {
    console.log(`PASS  engines.dsh 与依赖段同进同退（${actualRanges[0]}，改写 ${touched} 处）`)
    passes += 1
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
  else if (command === 'swap') code = await swap(parseLine(rest))
  else if (command === 'verify') code = await verify(parseLine(rest))
  else if (command === 'selftest') code = selftest()
  else usageError(`不认识的子命令：${command}`)
} catch (error) {
  console.error(error.message)
  code = 1
}
process.exit(code)

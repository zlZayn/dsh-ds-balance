#!/usr/bin/env node
/**
 * 宿主兼容性换版：把 `@deepseek-ai/dsh-*` 的声明区间换到指定的 dist-tag 线上。
 *
 * 用法：
 *   node scripts/compat-swap.mjs check                # 列出各包在 latest / next / alpha 上的版本
 *   node scripts/compat-swap.mjs swap --line next     # 改写 package.json，再跑裸 npm install
 *   node scripts/compat-swap.mjs verify --line next   # 断言 node_modules 里真的装在目标版本上
 *
 * 为什么要有 `verify`：`npm install` 会**假绿** —— 它可能失败，而 node_modules 停在旧版本上，
 * 于是测试跑在旧依赖上、给出与事实相反的信号。换版后必须回头看实际装到了什么。
 *
 * 退出码：0 = 通过 / 1 = 有未过 / 2 = 用法错误
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 只换这一撮。
 * `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery` 不带 `dsh-` 前缀，
 * 天然落在替换面之外 —— 它们的 next 线比 latest 还旧，换过去等于降级。
 */
const PREFIX = '@deepseek-ai/dsh-'

/** 声明区间可能出现的位置。 */
const MANIFEST_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies']

/** 关心的 dist-tag。 */
const LINES = ['latest', 'next', 'alpha']

const USAGE = `用法：
  node scripts/compat-swap.mjs check
  node scripts/compat-swap.mjs swap --line <${LINES.join('|')}>
  node scripts/compat-swap.mjs verify --line <${LINES.join('|')}>

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
  console.log(`${'包'.padEnd(width)}  ${'声明'.padEnd(18)} ${LINES.map((l) => l.padEnd(18)).join('')}`)
  for (const row of rows) {
    const cells = LINES.map((line) => String(row[line] ?? '-').padEnd(18)).join('')
    console.log(`${row.name.padEnd(width)}  ${row.declared.padEnd(18)} ${cells}`)
  }
  console.log(`\n共 ${rows.length} 个受管包（前缀 ${PREFIX}）。`)
  return 0
}

async function swap(line) {
  const manifest = readManifest()
  const names = managedNames(manifest)
  const plan = []
  for (const name of names) {
    const tags = await distTags(name)
    const version = tags[line]
    if (!version) throw new Error(`${name} 在 ${line} 线上没有版本`)
    plan.push({ name, version })
  }

  let touched = 0
  for (const field of MANIFEST_FIELDS) {
    const block = manifest[field]
    if (!block) continue
    for (const { name, version } of plan) {
      if (!(name in block)) continue
      const next = `^${version}`
      if (block[name] !== next) {
        console.log(`${field}: ${name} ${block[name]} -> ${next}`)
        block[name] = next
        touched += 1
      }
    }
  }

  if (touched === 0) {
    console.log(`已经是 ${line} 线的版本，package.json 未改动。`)
  } else {
    writeFileSync('package.json', JSON.stringify(manifest, null, 2) + '\n')
    console.log(`\npackage.json 改了 ${touched} 处。回滚：git checkout package.json package-lock.json`)
  }

  console.log(`\n跑裸 npm install（shell: true 只是为了在 Windows 上找到 npm.cmd，没有用 shell 特性）……`)
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
  for (const name of names) {
    const tags = await distTags(name)
    const expected = tags[line]
    const installedPath = join('node_modules', name, 'package.json')
    if (!existsSync(installedPath)) {
      console.log(`MISS  ${name} —— node_modules 里没有它`)
      failed += 1
      continue
    }
    const installed = JSON.parse(readFileSync(installedPath, 'utf8')).version
    const suffix = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name] ?? ''
    if (installed !== expected) {
      console.log(`FAIL  ${name} —— 声明 ${suffix}，实际装到 ${installed}，${line} 线上是 ${expected}`)
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
  console.log(`${names.length} 个包全部落在 ${line} 线上。`)
  return 0
}

const [command, ...rest] = process.argv.slice(2)
if (!command || command === '--help' || command === '-h') usageError(command ? '' : '缺少子命令')

let code
try {
  if (command === 'check') code = await check()
  else if (command === 'swap') code = await swap(parseLine(rest))
  else if (command === 'verify') code = await verify(parseLine(rest))
  else usageError(`不认识的子命令：${command}`)
} catch (error) {
  console.error(error.message)
  code = 1
}
process.exit(code)

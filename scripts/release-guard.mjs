#!/usr/bin/env node
/**
 * 发版守卫：判断「上个 tag..HEAD」的改动有没有触及已发布产物。
 *
 * 用法 —— stdin 收 `git diff --name-only` 的输出：
 *
 *   git diff --name-only "$(git describe --tags --abbrev=0)"..HEAD | node scripts/release-guard.mjs
 *
 * 退出码：
 *   0 = 有产物改动，允许发版
 *   1 = 只有非产物改动，不该发版（发了等于发一个内容不变的新版本）
 *   2 = 用法错误
 *
 * 判据是**路径**，不是语义：改注释、抽常量这类行为等价的改动也会被判成「有产物改动」。
 * 那部分交给人回答；脚本只负责把「纯文档 / 纯测试 / 纯 CI」这一档干净地挡掉。
 */

import { readFileSync } from 'node:fs'

const USAGE = `用法：
  git diff --name-only <上个 tag>..HEAD | node scripts/release-guard.mjs

退出码：0 = 有产物改动 / 1 = 只有非产物改动 / 2 = 用法错误`

/**
 * 这些前缀下的改动一律不进 npm 包。
 * 用「逐个排除」而不是「逐个收录」：未识别的路径算改变产物 —— 宁可漏判，不误拦。
 */
const NON_ARTIFACT_PREFIXES = ['.agents/', '.github/', 'assets/', 'docs/', 'scripts/', 'test/']

/**
 * 上面那些前缀里确实会改变产物的例外。
 * `scripts/` 整体不进包，但 build-client.mjs 决定 lib/client.js 的内容。
 */
const ARTIFACT_EXCEPTIONS = new Set(['scripts/build-client.mjs'])

/** 根级不进包的文件。 */
const NON_ARTIFACT_FILES = new Set([
  '.gitattributes',
  '.gitignore',
  '.node-version',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'CONTRIBUTING_en.md',
  'package-lock.json',
  'vitest.config.ts',
  'vitest.contract.config.ts',
])

/** 这条路径的改动会不会改变已发布产物。 */
function changesArtifacts(file) {
  if (ARTIFACT_EXCEPTIONS.has(file)) return true
  if (NON_ARTIFACT_FILES.has(file)) return false
  return !NON_ARTIFACT_PREFIXES.some((prefix) => file.startsWith(prefix))
}

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE)
  process.exit(2)
}
if (args.length > 0) {
  console.error(`无法识别的参数：${args.join(' ')}`)
  console.error(USAGE)
  process.exit(2)
}
if (process.stdin.isTTY) {
  console.error('没有从 stdin 收到改动清单。')
  console.error(USAGE)
  process.exit(2)
}

const changed = readFileSync(0, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0)

if (changed.length === 0) {
  console.log('上个 tag 到现在没有任何改动，没有什么可发的。')
  process.exit(1)
}

const artifacts = changed.filter(changesArtifacts)
const others = changed.filter((file) => !changesArtifacts(file))

if (artifacts.length > 0) console.log(`改变产物的改动 ${artifacts.length} 条：`)
for (const file of artifacts) console.log(`  - ${file}`)
if (others.length > 0) console.log(`不影响产物的改动 ${others.length} 条：`)
for (const file of others) console.log(`  - ${file}`)

if (artifacts.length === 0) {
  console.log('\n全是非产物改动，不该发版。')
  process.exit(1)
}
console.log(`\n有产物改动，允许发版。`)
process.exit(0)

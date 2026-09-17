#!/usr/bin/env node
/**
 * 端到端验收：对一个**已构建的安装目录**跑真实链路。
 *
 * 用法：
 *   node scripts/acceptance.mjs [--target <dir>]
 *
 * `--target` 默认是当前目录 —— 本仓库自己就是那个安装目录（符号链接形态）。
 * 想验 profile 里装的那一份，就把它的路径传进来。
 *
 * 退出码：0 = 全过 / 1 = 有未过 / 2 = 缺凭据（上游那一段没跑）
 *
 * 它打真实上游（`GET /user/balance`），所以不进 CI：要真实凭据，也占真实配额。
 * 凭据只从环境变量 `DEEPSEEK_API_KEY` 读，只出现在请求头里，不打印、不落盘。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'

function parseTarget(argv) {
  const index = argv.indexOf('--target')
  if (index === -1) return { target: resolve('.') }
  const value = argv[index + 1]
  if (!value) return { error: '--target 后面要跟一个目录' }
  return { target: resolve(value) }
}

const parsed = parseTarget(process.argv.slice(2))
if (parsed.error) {
  console.error(parsed.error)
  process.exit(2)
}
const target = parsed.target

/** 每个 check 抛错即失败；返回的字符串作为补充说明打印。 */
const checks = []
const check = (name, fn) => checks.push({ name, fn })

check('目标目录里有一份构建好的包', () => {
  if (!existsSync(join(target, 'package.json'))) throw new Error('没有 package.json')
  if (!existsSync(join(target, 'lib', 'index.js'))) {
    throw new Error('没有 lib/index.js —— 先在该目录跑 npm run build')
  }
  return target
})

check('宿主入口可求值，并导出契约面', async () => {
  const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  const host = await import(pathToFileURL(join(target, 'lib', 'index.js')).href)
  if (typeof host.apply !== 'function') throw new Error('apply 不是函数')
  if (typeof host.name !== 'string') throw new Error('name 不是字符串')
  if (!Array.isArray(host.inject)) throw new Error('inject 不是数组')
  return `name=${host.name} inject=[${host.inject.join(', ')}]`
})

check('可选服务没有进顶层 inject', async () => {
  const host = await import(pathToFileURL(join(target, 'lib', 'index.js')).href)
  for (const optional of ['connection', 'storageDomain']) {
    if (host.inject.includes(optional)) {
      throw new Error(`${optional} 在顶层 inject 里：缺这个服务会让整个插件不装载`)
    }
  }
  return 'connection / storageDomain 都由 apply 内的 ctx.inject 把门'
})

check('浏览器信封的形状正确', () => {
  const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  const bundle = readFileSync(join(target, 'lib', 'client.js'), 'utf8')
  if (!bundle.startsWith('window.__ModuleLoader__.load(')) throw new Error('不是 lazy-CJS 信封')
  if (!bundle.includes('id: ' + JSON.stringify(pkg.name))) throw new Error('信封 id 不等于包名')
  if (!bundle.includes('data-plugin-css')) throw new Error('样式没有内联回 factory')
  if (existsSync(join(target, 'lib', 'client.css'))) throw new Error('lib/client.css 不该存在')
  return `id=${pkg.name}，样式已内联`
})

check('真实上游可达，且响应形状未变', async () => {
  const apiKey = process.env.DEEPSEEK_API_KEY
  const response = await fetch(new URL('/user/balance', BASE_URL), {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  })
  if (response.status !== 200) throw new Error(`上游回了 ${response.status}`)
  const body = await response.json()
  if (typeof body.is_available !== 'boolean') throw new Error('is_available 不是布尔')
  if (!Array.isArray(body.balance_infos) || body.balance_infos.length === 0) {
    throw new Error('balance_infos 不是非空数组')
  }
  for (const info of body.balance_infos) {
    for (const field of ['currency', 'total_balance', 'granted_balance', 'topped_up_balance']) {
      if (typeof info[field] !== 'string') throw new Error(`${field} 不是字符串`)
    }
  }
  return `${body.balance_infos.length} 个币种：${body.balance_infos.map((i) => i.currency).join(', ')}`
})

const hasCredentials = Boolean(process.env.DEEPSEEK_API_KEY)

let failed = 0
console.log(`验收目标：${target}\n`)

for (const { name, fn } of checks) {
  if (name.startsWith('真实上游') && !hasCredentials) {
    console.log(`SKIP  ${name} —— 环境里没有 DEEPSEEK_API_KEY`)
    continue
  }
  try {
    const note = await fn()
    console.log(`PASS  ${name}${note ? ` —— ${note}` : ''}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name} —— ${error.message}`)
  }
}

console.log('')
if (failed > 0) {
  console.error(`${failed} 项未通过。`)
  process.exit(1)
}
if (!hasCredentials) {
  console.error('离线部分全过；上游那一段因为缺 DEEPSEEK_API_KEY 没跑。')
  process.exit(2)
}
console.log('全部通过。')
process.exit(0)

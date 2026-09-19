#!/usr/bin/env node
/**
 * 失败可见：把 compat 巡检的红变成**一条固定标题的跟踪 issue**。
 *
 * 为什么要它：两条线是刻意的「只记录不阻断」（决策记录见
 * .agents/notes/2026-09-17-compat-lines-advisory.md），于是「不阻断」必须由
 * 「失败可见」来配平 —— 否则红就是丢进日志里没人看。定时任务的失败邮件只发给
 * 最后改过 cron 的人，不能当主通知。
 *
 * 为什么不重复开：按固定标题找现存 issue，有就追加一条评论（已在别处说明过的不再重复），
 * 关闭状态的先重开。**正文里不放时间戳**：同一处失败每周都长一样，正文一致才能判重，
 * 也才不会每周刷一条。
 *
 * 用法：
 *   node scripts/report-compat-failure.mjs --check swap --line alpha --step Test
 *   node scripts/report-compat-failure.mjs --check declaration --step "Check the declaration covers the tracked line" --dry-run
 *
 * 退出码：0 = 已记录 / 1 = 记录失败（gh 报错）/ 2 = 用法或前置条件缺失
 *
 * 输出全英文、前缀 [INFO] / [WARN] / [NOTE]（见 SPEC 的硬约束）。
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TRACKED_LINE } from './check-declaration.mjs'

/** 跟踪 issue 的固定标题：判重就靠它逐字相等。 */
const ISSUE_TITLE = '[compat] the weekly compatibility patrol is red'

/** 固定标签。仓库里没有就现建（--force 是幂等的）。 */
const ISSUE_LABEL = 'compat-patrol'

const LABEL_COLOR = 'B60205'
const LABEL_DESCRIPTION = 'compat.yml patrol is red; closed automatically is not supported, close by hand when green'

/** 每个检查的判据。 */
const CRITERION = {
  declaration:
    'The ranges declared in `package.json` — `engines.dsh` and every `@deepseek-ai/dsh-*` edge — must '
    + 'cover the version the tracked dist-tag line points at. A range that cannot install the version on the '
    + 'line is red even when the installed code happens to work: the manifest is what an installer obeys.',
  swap:
    'Swapping the `@deepseek-ai/dsh-*` ranges onto the line must still typecheck and pass the full test '
    + 'suite, and `compat-swap.mjs verify` must confirm the install actually landed on the line. '
    + '`npm install` can fail while `node_modules` stays on the old versions, and the tests then report '
    + 'the opposite of the truth.',
}

/** 每个检查的恢复条件。 */
const RECOVERY = {
  declaration:
    'Update the declared ranges in `package.json` to a version you actually tested, or move the tracked '
    + 'line. The tracked line is the one the README version-compatibility section names.',
  swap:
    'Read the failing line in the run log. Which line is mandatory is still undecided on purpose: a red line '
    + 'is recorded, never blocking. The decision and its recovery conditions live in '
    + '`.agents/notes/2026-09-17-compat-lines-advisory.md`.',
}

const LINES = ['alpha', 'next', 'latest']
const CHECKS = Object.keys(CRITERION)
const USAGE = `usage:
  node scripts/report-compat-failure.mjs --check <${CHECKS.join('|')}> --step <step name> [--line <${LINES.join('|')}>] [--detail <text>] [--dry-run]

exit codes: 0 = recorded / 1 = could not record / 2 = usage or precondition error`

/**
 * 组装 issue 正文。**确定性的**：同一处失败必然得到同一份正文，判重才成立。
 * @param input - 检查名、线、红的步骤与补充说明。
 * @returns markdown 正文。
 */
export function issueBody(input) {
  const criterion = CRITERION[input.check]
  const recovery = RECOVERY[input.check]
  if (criterion === undefined || recovery === undefined) throw new Error(`unknown check: ${input.check}`)
  return [
    'The weekly compatibility patrol (`.github/workflows/compat.yml`) is red.',
    '',
    '| field | value |',
    '|---|---|',
    `| check | \`${input.check}\` |`,
    `| line | \`${input.line}\` |`,
    `| step | ${input.step} |`,
    `| detail | ${input.detail ?? '-'} |`,
    '',
    '### Criterion',
    '',
    criterion,
    '',
    '### Recovery',
    '',
    recovery,
    '',
    `Dispatch after pushing: \`gh workflow run compat.yml\`. See docs/PUBLISHING.md (compatibility) for where these `
      + 'criterion texts are documented.',
    '',
    'This issue is updated in place: a repeat of the same failure adds no comment.',
  ].join('\n')
}

/**
 * 跑一条 gh 命令。
 * @param args - 参数列表（不经 shell）。
 * @returns 退出码与输出。
 */
function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' })
  if (result.error) {
    throw new Error(`cannot run gh: ${result.error.message}`)
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/**
 * 追一条记录。
 * @param options - 参数解析结果。
 * @returns 进程退出码。
 */
function report(options) {
  const body = issueBody(options)
  if (options.dryRun) {
    console.log('[INFO] dry run: no gh call, no issue touched')
    console.log(`[INFO] title: ${ISSUE_TITLE}`)
    console.log(`[INFO] label: ${ISSUE_LABEL}`)
    console.log(body)
    return 0
  }

  const listed = gh(['issue', 'list', '--state', 'all', '--limit', '200', '--json', 'number,state,title,url'])
  if (listed.status !== 0) throw new Error(`gh issue list failed: ${listed.stderr.trim().split('\n')[0]}`)
  const existing = JSON.parse(listed.stdout).find((issue) => issue.title === ISSUE_TITLE)

  if (!existing) {
    // 标签不存在时 gh issue create --label 会直接失败，所以先幂等地建/更新它。
    const labeled = gh(['label', 'create', ISSUE_LABEL, '--force', '--color', LABEL_COLOR, '--description', LABEL_DESCRIPTION])
    if (labeled.status !== 0) console.log(`[NOTE] could not ensure label ${ISSUE_LABEL}: ${labeled.stderr.trim().split('\n')[0]}`)
    const created = gh(['issue', 'create', '--title', ISSUE_TITLE, '--label', ISSUE_LABEL, '--body', body])
    if (created.status !== 0) throw new Error(`gh issue create failed: ${created.stderr.trim().split('\n')[0]}`)
    console.log(`[NOTE] opened the tracking issue: ${created.stdout.trim()}`)
    return 0
  }

  const viewed = gh(['issue', 'view', String(existing.number), '--json', 'state,comments'])
  if (viewed.status !== 0) throw new Error(`gh issue view failed: ${viewed.stderr.trim().split('\n')[0]}`)
  const detail = JSON.parse(viewed.stdout)
  const last = detail.comments?.at(-1)?.body
  if (last === body) {
    console.log(`[NOTE] already recorded as issue #${existing.number}; nothing added`)
    return 0
  }

  if (detail.state === 'CLOSED') {
    const reopened = gh(['issue', 'reopen', String(existing.number)])
    if (reopened.status !== 0) throw new Error(`gh issue reopen failed: ${reopened.stderr.trim().split('\n')[0]}`)
    console.log(`[NOTE] reopened issue #${existing.number}`)
  }
  const commented = gh(['issue', 'comment', String(existing.number), '--body', body])
  if (commented.status !== 0) throw new Error(`gh issue comment failed: ${commented.stderr.trim().split('\n')[0]}`)
  console.log(`[NOTE] added this failure to issue #${existing.number}`)
  return 0
}

function usageError(message) {
  if (message) console.error(`[WARN] ${message}`)
  console.error(USAGE)
  process.exit(2)
}

/**
 * 解析参数。
 * @param argv - 进程参数。
 * @returns 规范化后的选项。
 */
function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag)
    if (index === -1) return undefined
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) usageError(`${flag} needs a value`)
    return next
  }
  const check = value('--check')
  if (check === undefined) usageError('--check is required')
  if (!CHECKS.includes(check)) usageError(`unknown check: ${check}`)
  const step = value('--step')
  if (step === undefined) usageError('--step is required')
  const line = value('--line') ?? TRACKED_LINE
  if (!LINES.includes(line)) usageError(`unknown dist-tag: ${line}`)
  return { check, line, step, detail: value('--detail'), dryRun: argv.includes('--dry-run') }
}

/** 只有被当命令跑时才执行；被 import 时只暴露正文组装与参数解析。 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) usageError('')
  let code
  try {
    code = report(parseArgs(argv))
  } catch (error) {
    console.error(`[WARN] ${error.message}`)
    code = 1
  }
  process.exit(code)
}

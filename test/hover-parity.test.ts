import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ReactNode } from 'react'

/**
 * 悬停：**收起态与展开态必须显示同样的东西**。
 *
 * 这条测试渲**真组件**（`SidebarBalance`），两态各渲一遍，再从 DOM 里各自读出
 * 「用户实际会看到什么」，逐条比对。它不是读某个函数的返回值 ——
 * 上一轮的缺陷恰恰在于**两态各算各的**：收起态用 `ringTitle`（只在有状态文案时才设），
 * 展开态用 `hoverLabel`（有数字就给数字）。后果有两个：
 * - `ok` / `low` / `critical` 收起态**什么都不显示**（连 `<title>` 都没有）；
 * - `stale` 上两态**各说各的**（收起态说「数据已过期」、展开态报旧金额）。
 *
 * 现在两态都取 `hoverTextOf(shown, stateText)` 那一个返回值，这条测试钉住它。
 *
 * **为什么要 mock `ui-primitives`**：那包的 `lib` 里带 `.module.css`，而 node_modules
 * 默认被外部化交给 Node 直接 import，Node 不认 `.css`（`ERR_UNKNOWN_FILE_EXTENSION`），
 * 于是任何 import 到它的组件都渲不出来。这里把它换成同形状的替身：
 * `Tooltip` 把 label 写进 `data-tooltip` 并带上 `side`，测试据此读出「展开态会说什么」。
 */
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconWarningOutlineRegular: (): null => null,
  Tooltip: ({ label, side, children }: { label?: string; side?: string; children: ReactNode }) =>
    createElement('span', { 'data-tooltip': label ?? '', 'data-side': side ?? '' }, children),
  useAnchoredPosition: (): null => null,
  useDismissOnOutsidePointer: (): void => {},
}))

const { SidebarBalance } = await import('../src/client/sidebar/SidebarBalance.tsx')
const { zh } = await import('../src/client/locales.ts')
const { scenarios } = await import('../src/client/mock/scenarios.ts')
const { formatMoney } = await import('../src/client/model.ts')
const { SITUATIONS } = await import('../src/client/situation.ts')

/** 一处 props：两态只有 `wide` 不同。 */
function props(wide: boolean) {
  return {
    wide,
    t: (key: keyof typeof zh) => zh[key],
    configSlotProbe: {
      getSnapshot: () => 'missing' as const,
      subscribe: () => () => {},
      markDeclared: () => {},
      dispose: () => {},
    },
    onSelectCurrency: async (): Promise<boolean> => true,
    config: {
      displayCurrency: 'auto',
      manualCooldownSeconds: 30,
      manualRefreshCooldownSeconds: 30,
      clientPollSeconds: 30,
      configSignature: 'sig',
      warnThresholdOf: () => undefined,
      writable: true,
    },
  }
}

/** 用 mock 场景驱动真组件渲一遍，再把 `?dsb=` 清掉（免得上一个场景黏住）。 */
function render(scenarioKey: string, wide: boolean): string {
  ;(globalThis as { location?: unknown }).location = { search: `?dsb=${scenarioKey}` }
  const html = renderToStaticMarkup(createElement(SidebarBalance, props(wide)))
  ;(globalThis as { location?: unknown }).location = { search: '' }
  return html
}

/** 收起态的悬停面：SVG 里那个原生 `<title>`。 */
function railHover(scenarioKey: string): string | null {
  const match = /<title>([^<]*)<\/title>/.exec(render(scenarioKey, false))
  return match === null ? null : match[1]
}

/** 展开态的悬停面：外层 Tooltip（`side="right"`）的 label；标记那层是 `bottom`，别拿错。 */
function wideHover(scenarioKey: string): string | null {
  const outer = /<span data-tooltip="([^"]*)" data-side="right"/.exec(render(scenarioKey, true))
  return outer === null ? null : outer[1]
}

/**
 * 处境 → 驱动它的 mock 场景键 → **期望的悬停文案**。
 *
 * 文案规则：**数字可信才显数字**（只有 `ok` / `low` / `critical`），其余处境显它自己那句话。
 * `stale` 与 `account-unavailable` **都带着数字**却**不显数字** ——
 * 旧数字与停用账户上的数字都不可信/不可用，环已经把问题画出来了（旧色 / 红叉），
 * 悬停该解释问题。这一列就是钉住它的地方。
 */
const CASES: ReadonlyArray<readonly [string, string, string]> = [
  // 数字可信 → 显金额（金额在测试里由 mock 场景现算）
  ['ok', 'ok', '¥110'],
  ['low', 'warn', '¥8'],
  ['critical', 'critical', '¥3'],
  // 有数字但不可信 / 不可用 → 显文案
  ['stale', 'stale', zh['situation.stale']],
  ['account-unavailable', 'unavailable', zh['situation.accountUnavailable']],
  // 本来就没有数字 → 显文案
  ['checking', 'checking', zh['situation.checking']],
  ['offline', 'offline', zh['situation.unavailable']],
  ['fetch-failed', 'error', zh['situation.unavailable']],
  ['internal-error', 'internalError', zh['situation.internalError']],
  ['no-credential', 'noKey', zh['situation.noCredential']],
  ['empty-wallet', 'empty', zh['situation.emptyWallet']],
]

describe('悬停：收起态与展开态一致', () => {
  it('**覆盖全部 11 个处境**（新增处境时必须来补一行）', () => {
    expect(CASES.map(([situation]) => situation).sort()).toEqual([...SITUATIONS].sort())
  })

  it('**两态逐条相同**，且都非空（收起态不再「什么都不显示」）', () => {
    const rows: string[] = []
    for (const [situation, key] of CASES) {
      const rail = railHover(key)
      const wide = wideHover(key)
      rows.push(`${situation.padEnd(20)} 收起=${String(rail).padEnd(10)} 展开=${String(wide)}`)
      expect(rail, `${situation}：收起态与展开态不一样`).toBe(wide)
      // 关键回归：收起态**必须**有东西可显（从前 ok/low/critical 是 null）。
      expect(rail, `${situation}：收起态悬停是空的`).not.toBeNull()
      expect(rail, `${situation}：收起态悬停是空串`).not.toBe('')
    }
    console.log('\n' + rows.join('\n'))
  })

  it('**文案与规则表逐条一致**（两态都查）', () => {
    for (const [situation, key, expected] of CASES) {
      expect(railHover(key), `${situation}（收起态）`).toBe(expected)
      expect(wideHover(key), `${situation}（展开态）`).toBe(expected)
    }
  })

  it('**`stale` 与 `account-unavailable` 明明有数字，也**不**显数字**', () => {
    // 这两条是本轮改动的核心：它们有 `shown`，但数字不可信 / 不可用。
    // 若哪天有人把规则退回「有数字就显金额」，这条会红。
    for (const [situation, key] of CASES) {
      if (situation !== 'stale' && situation !== 'account-unavailable') continue
      const balance = scenarios[key as keyof typeof scenarios].selected
      expect(balance, `${situation} 的 mock 场景应当带着数字，否则测不到这条`).not.toBeNull()
      const money = formatMoney(balance!.total, balance!.currency)
      expect(railHover(key), situation).not.toBe(money)
      expect(wideHover(key), situation).not.toBe(money)
    }
  })

  it('**收起态不再带「DeepSeek 余额状态 」前缀**（前缀会让两态文字不同）', () => {
    for (const [, key] of CASES) {
      expect(railHover(key) ?? '', key).not.toContain(zh['sidebar.aria.ring'])
    }
  })
})

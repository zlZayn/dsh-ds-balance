import { describe, expect, it } from 'vitest'
import {
  CLIENT_SITUATIONS,
  HOST_SITUATIONS,
  SITUATIONS,
  SITUATIONS_FROM_FACTS,
  situationOf,
  type SituationFacts,
} from '../src/domain/situation.ts'

/** 一份「什么毛病都没有」的事实，逐条覆盖时只改关心的那一项。 */
const healthy: SituationFacts = {
  hasSnapshot: true,
  stale: false,
  isAvailable: true,
  hasSelected: true,
  severity: 'ok',
  errorCode: null,
}

/** 改几项事实。 */
const facts = (patch: Partial<SituationFacts>): SituationFacts => ({ ...healthy, ...patch })

describe('situationOf', () => {
  it('正常与两档告警：有数字就按 severity 分档', () => {
    expect(situationOf(facts({ severity: 'ok' }))).toBe('ok')
    expect(situationOf(facts({ severity: 'warn' }))).toBe('low')
    expect(situationOf(facts({ severity: 'critical' }))).toBe('critical')
  })

  it('**没接入 ≠ 接入了但读不到**：没有快照时看错误码', () => {
    // 一条凭据都没有 → 需要用户去配置。
    expect(
      situationOf(facts({ hasSnapshot: false, hasSelected: false, errorCode: 'NO_KEY' })),
    ).toBe('no-credential')
    // 有凭据但这次没抓到 → 等。
    for (const code of ['NO_NETWORK', 'UPSTREAM_TIMEOUT', 'UPSTREAM_5XX', 'PARSE_ERROR'] as const) {
      expect(
        situationOf(facts({ hasSnapshot: false, hasSelected: false, errorCode: code })),
        code,
      ).toBe('fetch-failed')
    }
    // 没有快照也没有错误码（构造不出来，但要有确定行为）→ 当作读不到，不假装正常。
    expect(situationOf(facts({ hasSnapshot: false, hasSelected: false, errorCode: null }))).toBe(
      'fetch-failed',
    )
  })

  it('**账户停用压过「数据过期」**：isAvailable 是更强的信号', () => {
    // 这正是旧写法里环与文案打架的那一格：环画叉、文案却说「数据已过期」。
    expect(situationOf(facts({ isAvailable: false, stale: true, severity: 'unavailable' }))).toBe(
      'account-unavailable',
    )
    // 有快照、账户可用、只是这轮没读到 —— 这才是真正的 stale。
    expect(situationOf(facts({ stale: true, severity: 'ok' }))).toBe('stale')
  })

  it('没有可展示币种是独立处境，不跟「没接入」混', () => {
    // 连上了、账户可用、就是没有币种：这是 empty-wallet，不是 no-credential
    // （后者要求 NO_KEY）。旧写法两者都是空环，用户看不出差别。
    expect(situationOf(facts({ hasSelected: false, severity: 'unknown' }))).toBe('empty-wallet')
    // 有快照且 NO_KEY 时**不是** no-credential —— 曾经读到过，这轮读不到而已。
    expect(situationOf(facts({ stale: true, errorCode: 'NO_KEY', severity: 'ok' }))).toBe('stale')
  })

  it('覆盖度：每个处境都有生产方（没有到不了的值）', () => {
    // `situationOf` 自己判得出的那些 —— 逐组事实跑真函数，不是照抄常量。
    const fromFacts = new Set<string>([
      situationOf(facts({ severity: 'ok' })),
      situationOf(facts({ severity: 'warn' })),
      situationOf(facts({ severity: 'critical' })),
      situationOf(facts({ stale: true, severity: 'ok' })),
      situationOf(facts({ isAvailable: false, severity: 'unavailable' })),
      situationOf(facts({ hasSelected: false, severity: 'unknown' })),
      situationOf(facts({ hasSnapshot: false, hasSelected: false, errorCode: 'NO_KEY' })),
      situationOf(facts({ hasSnapshot: false, hasSelected: false, errorCode: 'NO_NETWORK' })),
    ])
    // 声明的「事实判得出」那张表必须与真跑出来的一致 —— 多一个少一个都说明有漂。
    expect([...fromFacts].sort()).toEqual([...SITUATIONS_FROM_FACTS].sort())
    // 全部处境都必须有生产方：事实判的 + 兜底视图的 internal-error + 客户端那两个。
    const produced = new Set<string>([...fromFacts, 'internal-error', ...CLIENT_SITUATIONS])
    for (const situation of SITUATIONS) {
      expect(produced, `处境 ${situation} 没有任何生产方`).toContain(situation)
    }
    // 反向：生产方也不许多出闭集之外的处境。
    expect([...produced].sort()).toEqual([...SITUATIONS].sort())
  })

  it('宿主能判的处境 = 闭集减去客户端那两个', () => {
    expect([...HOST_SITUATIONS].sort()).toEqual(
      SITUATIONS.filter((s) => !(CLIENT_SITUATIONS as readonly string[]).includes(s)).sort(),
    )
    // internal-error 由 HTTP 兜底视图给，不经 situationOf。
    expect(SITUATIONS_FROM_FACTS).not.toContain('internal-error')
  })

  it('severity 只剩 unavailable / unknown 这两种漏网值时归「读不到」，不假装正常', () => {
    // 上面几条已经把这两种情形接走了；真漏到这里说明判定链有洞，
    // 宁可报「读不到」也不要显示一个可能骗人的绿环。
    for (const severity of ['unavailable', 'unknown'] as const) {
      expect(situationOf(facts({ severity })), severity).toBe('fetch-failed')
    }
  })
})

/**
 * 勘察与开发用的 mock 场景。覆盖后端契约里所有状态组合。
 * @module dsh-ds-balance/client/mock/scenarios
 */

import type { BalanceResponse } from '../api-types.ts'

const T0 = 1760000000000

const cny = (total: string, granted: string, toppedUp: string) => ({
  currency: 'CNY', total, granted, toppedUp,
})

/** 造一个完整的响应，未指定的字段走正常值。 */
function make(patch: Partial<BalanceResponse>): BalanceResponse {
  return {
    requestId: 'req_mock',
    schemaVersion: 1,
    state: 'ok',
    stale: false,
    fetchedAt: T0,
    ageMs: 12000,
    isAvailable: true,
    accountTag8: 'a1b2c3d4',
    balances: [cny('110.00000000', '10.00000000', '100.00000000')],
    selected: { currency: 'CNY', total: '110.00000000' },
    severity: 'ok',
    thresholds: { CNY: { warn: '10.00000000', critical: '5.00000000' } },
    todayUsage: null,
    error: null,
    ...patch,
  }
}

/** 全部场景。键即 URL 参数 `?dsb=<key>` 的取值。 */
export const scenarios = {
  /** 正常。 */
  ok: make({}),

  /** 余额偏低但可用。 */
  warn: make({ severity: 'warn', balances: [cny('8.00000000', '0.00000000', '8.00000000')], selected: { currency: 'CNY', total: '8.00000000' } }),

  /** 余额告急。 */
  critical: make({ severity: 'critical', balances: [cny('3.00000000', '0.00000000', '3.00000000')], selected: { currency: 'CNY', total: '3.00000000' } }),

  /** 账户不可用（余额耗尽 / 欠费）。 */
  unavailable: make({
    severity: 'unavailable',
    isAvailable: false,
    balances: [cny('0.00000000', '0.00000000', '0.00000000')],
    selected: { currency: 'CNY', total: '0.00000000' },
  }),

  /** 有旧值但本次刷新失败。 */
  stale: make({ state: 'stale', stale: true, severity: 'unknown', ageMs: 3_600_000, fetchedAt: T0 - 3_600_000, error: { code: 'NETWORK', message: 'fetch failed' } }),

  /** 无值失败。 */
  error: make({
    state: 'error',
    stale: false,
    severity: 'unknown',
    isAvailable: false,
    balances: [],
    selected: null,
    ageMs: 0,
    error: { code: 'HTTP_500', message: 'upstream returned 500' },
  }),

  /** 未配置。 */
  empty: make({ state: 'empty', severity: 'unknown', isAvailable: false, balances: [], selected: null, ageMs: 0 }),

  /** 未配置且带 NO_KEY 错误。 */
  noKey: make({ state: 'empty', severity: 'unknown', isAvailable: false, balances: [], selected: null, ageMs: 0, error: { code: 'NO_KEY', message: 'no API key configured' } }),

  /** 多币种。 */
  multiCurrency: make({
    balances: [cny('110.00000000', '10.00000000', '100.00000000'), { currency: 'USD', total: '20.00000000', granted: '0.00000000', toppedUp: '20.00000000' }],
    thresholds: { CNY: { warn: '10.00000000', critical: '5.00000000' }, USD: { warn: '2.00000000', critical: '1.00000000' } },
  }),

  /** 选定了账户里没有的币种（USD），账户只有 CNY。 */
  currencyMismatch: make({
    balances: [cny('110.00000000', '10.00000000', '100.00000000')],
  }),

  /** 账户完全没有余额。 */
  noBalanceAtAll: make({
    severity: 'unknown',
    isAvailable: true,
    balances: [],
    selected: null,
  }),

  /** 今日用量缺失（第一版 UI 不消费，用于契约回归）。 */
  usageMissing: make({ todayUsage: null }),

  /** 今日用量需复核（第一版 UI 不消费，用于契约回归）。 */
  usageNeedsReview: make({
    todayUsage: {
      value: '3.21000000', currency: 'CNY', source: 'projection',
      confidence: 'low', needsReview: true, range: ['1.50000000', '6.40000000'],
    },
  }),
} satisfies Record<string, BalanceResponse>

/** 场景键。 */
export type ScenarioKey = keyof typeof scenarios

/** 场景键清单，供开发切换器使用。 */
export const scenarioKeys = Object.keys(scenarios) as ScenarioKey[]

/** 默认场景。 */
export const defaultScenario: ScenarioKey = 'ok'

/** 运行时判断一个字符串是不是已知场景键。 */
export function isScenarioKey(value: string): value is ScenarioKey {
  return Object.prototype.hasOwnProperty.call(scenarios, value)
}

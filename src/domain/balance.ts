/**
 * 余额领域类型。
 *
 * 这里定义的是**契约形状**：金额一律 `bigint` 最小单位，序列化时才变字符串。
 * @module dsh-ds-balance/domain/balance
 */

import type { ErrorInfo } from './errors.js'
import type { Units } from './money.js'
import type { Situation } from './situation.js'

/** 币种代码，例如 `CNY` / `USD`。 */
export type Currency = string

/**
 * 余额来源：官方的两条取数路。
 *
 * - `deepseek-http`：官方余额端点 `GET /user/balance`，凭据是 API Key（解析链见 `KeyResolver`）。
 * - `deepseek-account`：宿主账号服务的钱包查询，凭据是账号登录态。
 *
 * **取值是追加式的**：已落盘的记录里只有前者，所以它必须一直是合法值（域版本不抬）。
 */
export type BalanceSource = 'deepseek-http' | 'deepseek-account'

/** 缓存状态。闭集。 */
export type CacheState = 'empty' | 'ok' | 'stale' | 'error'

/** 颜色严重度。闭集，前端只做机械映射。 */
export type Severity = 'ok' | 'warn' | 'critical' | 'unavailable' | 'unknown'

/** 单个币种的余额。 */
export interface BalanceInfo {
  currency: Currency
  total: Units
  granted: Units
  toppedUp: Units
}

/** 一次成功抓取的不可变快照。 */
export interface BalanceSnapshot {
  /** 快照标识，单调可排序。 */
  snapshotId: string
  /** 账本作用域标识：HMAC(serverSalt, apiKey) 前缀，不含明文。 */
  accountTag: string
  /** 抓取时刻（毫秒）。 */
  fetchedAt: number
  /** 上游 `is_available`。 */
  isAvailable: boolean
  /** 全币种余额。 */
  balances: BalanceInfo[]
  /** 数据来源。 */
  source: BalanceSource
  /** 原始响应，审计用。 */
  raw: unknown
}

/**
 * 每个账本保留多少条快照。**历史保留深度，不是功能开关。**
 *
 * **为什么住在 domain**：写入路径（`SourceLedger.persist`）与启动清理
 * （`DomainCoreStore.initialize`）都要读它，而 adapters 与 services 互相不能依赖 ——
 * `domain/` 是两层共同的下游，是唯一能放这个常量的地方。
 * （最初它住在 `balance-source.ts` 顶部，理由是「紧挨唯一调用点」；启动清理加入后
 * 调用点变成两个，那条理由就不再成立。）
 *
 * - 当前**没有任何功能读第二条以后的记录**：唯一读点是 `loadLatestSnapshot` 取最新一条，
 *   仓内没有 `listSnapshots`，也没有历史端点（`docs/ARCHITECTURE.md` 的阶段边界
 *   明写不做图表）。所以这个数**不是**为功能服务的，不要因为「用不到」就调到 1。
 * - 它真正的作用是**故障回退余量**：最新那条写失败、写坏、或落盘途中崩了时还能退到上一条，
 *   覆盖连续两次失败就要 ≥ 3。
 * - **刻意不进配置面**：配置字段用户看得见、改得动，而这个数没有用户可感知的语义 ——
 *   改小它用户看不出界面变化，只会在某天丢快照时才后悔。给一个看不出区别的旋钮比不给更糟。
 *
 * 量级：一条快照约 0.9 KB，20 条约 18 KB —— 余量与存储成本之间没有取舍压力。
 */
export const SNAPSHOT_KEEP_N = 20

/** 一个币种的预警 / 告急阈值。 */
export interface ThresholdPair {
  warn: Units
  critical: Units
}

/** 给前端的余额视图。 */
export interface BalanceView {
  /** 这一份数字是哪条取数路给的。界面据此标来源。 */
  source: BalanceSource
  /**
   * 处境：界面唯一的分支入口。
   *
   * 环、文案、来源标签都从它派生 —— 界面**不再**自己组合 `state` / `severity` / `error.code`。
   * 判定只有一处（[situation.ts](situation.ts) 的 `situationOf`）。
   */
  situation: Situation
  state: CacheState
  stale: boolean
  fetchedAt: number | null
  ageMs: number | null
  isAvailable: boolean | null
  balances: BalanceInfo[]
  selected: { currency: Currency; total: Units } | null
  severity: Severity
  thresholds: Record<Currency, ThresholdPair>
  error: ErrorInfo | null
}

/** 上游 `GET /user/balance` 的原始响应形状。字段名保持上游拼写。 */
export interface RawBalanceResponse {
  is_available: boolean
  balance_infos: Array<{
    currency: string
    total_balance: string
    granted_balance: string
    topped_up_balance: string
  }>
}

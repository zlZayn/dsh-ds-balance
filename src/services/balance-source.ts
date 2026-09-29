/**
 * 一个取数来源的账本：快照、状态机、抓取与落盘。
 *
 * 职责：把「读一次 → 归一化 → 落快照」包成一次可合并的请求，并维护这一条路自己的缓存状态。
 * **对外永不抛错**：一切失败都变成 `view.state` 与 `view.error`。
 *
 * 两条路（API Key / 账号登录）各持一份账本，互不影响 —— 谁的失败都不该拖累另一条。
 * @module dsh-ds-balance/services/balance-source
 */

import type {
  BalanceInfo,
  BalanceSnapshot,
  BalanceSource,
  BalanceView,
  CacheState,
  Severity,
} from '../domain/balance.js'
import {
  classify,
  describeError,
  parseRetryAfter,
  type ErrorCode,
  type ErrorInfo,
} from '../domain/errors.js'
import { normalize } from '../domain/normalize.js'
import { pickBalance } from '../domain/select.js'
import { severityOf, thresholdsFor } from '../domain/severity.js'
import { situationOf } from '../domain/situation.js'
import type { Clock } from '../ports/clock.js'
import type { CoreStore } from '../ports/core-store.js'
import type { Logger } from '../ports/logger.js'
import { noopMetrics, type Metrics } from '../ports/metrics.js'
import { accountTag8 } from './account-tag.js'
import type { ConfigService } from './config-service.js'

/**
 * 一条路的读取策略。
 *
 * 账本不认识凭据、不认识 HTTP —— 换来源就是换一个 reader。
 * `available()` 与 `tag()` 都是**本地读**（凭据/身份来自内存），只有 `read()` 打上游。
 */
export interface SourceReader {
  /** 这条路的凭据此刻可用吗。 */
  available(): Promise<boolean>
  /** 这次快照的账本标识；凭据拿不到时抛错（由调用方吸收）。 */
  tag(): Promise<string>
  /** 抓一次余额，连账本标识一起给。 */
  read(): Promise<{ raw: unknown; accountTag: string }>
}

/** `forceRefresh` 的返回值，形状对齐契约 §8.4。 */
export interface RefreshResult {
  triggered: boolean
  joined: boolean
  cooldownMs: number
  state: CacheState
}

/** 调度器需要的状态切片。 */
export interface BalanceStatus {
  state: CacheState
  errorCode: ErrorCode | null
  consecutiveFailures: number
  hasSnapshot: boolean
  serverRefreshSeconds: number
  /** 上游给的 `Retry-After`，优先于自算退避。 */
  retryAfterMs: number | null
  /** 最近一次成功抓取的时刻；从未成功过是 `null`。健康检查要用。 */
  lastSuccessAt: number | null
  /** 这一份状态属于哪条路。 */
  source: BalanceSource
  /**
   * 下面四项**只服务健康检查里的处境**（`GET /api/v1/healthz` 的 `situation`）：
   * 不开浏览器也要能知道活跃账本此刻会画成什么。判定口径与 `toView` 完全同源。
   */
  /** 快照里的上游 `is_available`；没有快照时 `false`。 */
  isAvailable: boolean
  /** 按当前显示币种偏好挑得出可展示的币种吗。 */
  hasSelected: boolean
  /** 后端算好的严重度。 */
  severity: Severity
}

/** `getView` 的可选参数（账本层：来源已经定好了）。 */
export interface LedgerViewOptions {
  /** 跳过新鲜度判据强制拉一次。 */
  force?: boolean
  /** 覆盖展示币种偏好；缺省读配置。 */
  currency?: string
}

/** 构造参数。 */
export interface SourceLedgerOptions {
  source: BalanceSource
  reader: SourceReader
  store: CoreStore
  config: ConfigService
  clock: Clock
  logger?: Logger | undefined
  metrics?: Metrics | undefined
}

/** 一条路的账本。 */
export class SourceLedger {
  private readonly options: SourceLedgerOptions
  private readonly metrics: Metrics
  private snapshot: BalanceSnapshot | null = null
  private state: CacheState = 'empty'
  private error: ErrorInfo | null = null
  private failures = 0
  private retryAfterMs: number | null = null
  /** 上一次真的触发过手动刷新的时刻；`null` 表示本账本还没有过。 */
  private lastManualRefreshAt: number | null = null
  private inflight: Promise<BalanceView> | null = null
  /** 落盘失败只报一次，避免每轮刷新都刷屏。 */
  private persistWarned = false

  constructor(options: SourceLedgerOptions) {
    this.options = options
    this.metrics = options.metrics ?? noopMetrics
  }

  /** 这条路的 id。 */
  source(): BalanceSource {
    return this.options.source
  }

  /** 这条路的凭据此刻可用吗。 */
  available(): Promise<boolean> {
    return this.options.reader.available()
  }

  /** 当前状态切片，供调度与健康检查使用。 */
  status(): BalanceStatus {
    // 处境判定的四个事实与 `toView` 同源：这里也现算一次挑币种，不走第二套规则。
    const preference = this.options.config.current().displayCurrency
    const selected = this.snapshot === null ? null : pickBalance(this.snapshot.balances, preference)
    return {
      source: this.options.source,
      state: this.state,
      errorCode: this.error?.code ?? null,
      consecutiveFailures: this.failures,
      hasSnapshot: this.snapshot !== null,
      serverRefreshSeconds: this.options.config.current().serverRefreshSeconds,
      retryAfterMs: this.retryAfterMs,
      lastSuccessAt: this.snapshot?.fetchedAt ?? null,
      isAvailable: this.snapshot?.isAvailable ?? false,
      hasSelected: selected !== null,
      severity: this.severityOf(selected),
    }
  }

  /**
   * 当前账本标识的前 8 位；还没有快照时是 `null`。
   *
   * **只回前 8 位**：完整 tag 是账本作用域标识，没有对外的理由。
   */
  accountTag8(): string | null {
    const tag = this.snapshot?.accountTag
    return tag === undefined ? null : accountTag8(tag)
  }

  /**
   * 从存储恢复最近快照（这条账本第一次被用到时调一次）。
   *
   * **按 `accountTag` 过滤**：凭据轮换后 tag 变了，旧快照视为不存在，不混用。
   * 没有凭据可算 tag 时静默跳过。
   */
  async restore(): Promise<void> {
    try {
      const accountTag = await this.options.reader.tag()
      const stored = await this.options.store.loadLatestSnapshot(accountTag)
      if (stored === null) return
      this.snapshot = stored
      this.state = this.withinWindow() ? 'ok' : 'stale'
      this.publishGauge()
    } catch (error) {
      this.options.logger?.debug('ds-balance: no snapshot restored', {
        source: this.options.source,
        error: describeError(error),
      })
    }
  }

  /**
   * 取当前视图。
   *
   * 有在飞的请求就合并；不 force 且未过期就返回缓存；否则拉一次。
   */
  async getView(options: LedgerViewOptions = {}): Promise<BalanceView> {
    if (this.inflight !== null) return this.inflight
    if (options.force !== true && this.canServeCache()) return this.toView(options.currency)

    const run = this.fetchOnce(options.currency).finally(() => {
      this.inflight = null
    })
    this.inflight = run
    return run
  }

  /**
   * 手动刷新。
   *
   * 冷却中不触发；已有请求在飞时合并并回报 `joined`。
   *
   * **冷却的锚点是「上一次手动刷新」，不是「上一次抓取」**：调度与轮询也在抓，
   * 拿 `snapshot.fetchedAt` 当锚点的话，一次自动刷新就会把用户刚按下的一下吞掉 ——
   * 界面转了圈、倒计时也走了，上游却一次没打。
   *
   * 时刻取**决定触发那一刻**（不是抓完那一刻）：客户端从「拿到结果那一刻」起算，
   * 两者相差一个往返 ⇒ 客户端更保守，按钮亮起时按下去一定真的会抓。
   */
  async forceRefresh(reason: string): Promise<RefreshResult> {
    const now = this.options.clock.now()
    const cooldownMs = this.options.config.current().manualRefreshCooldownSeconds * 1000
    const last = this.lastManualRefreshAt
    if (last !== null && now - last < cooldownMs) {
      const remaining = cooldownMs - (now - last)
      this.metrics.counter('force_rejected_total', { source: this.options.source })
      this.options.logger?.debug('ds-balance: manual refresh rejected by cooldown', {
        source: this.options.source,
        reason,
        cooldownMs: remaining,
      })
      return { triggered: false, joined: false, cooldownMs: remaining, state: this.state }
    }
    this.lastManualRefreshAt = now
    if (this.inflight !== null) {
      await this.inflight
      return { triggered: true, joined: true, cooldownMs: 0, state: this.state }
    }
    await this.getView({ force: true })
    return { triggered: true, joined: false, cooldownMs: 0, state: this.state }
  }

  /** 快照是否还在 `serverRefreshSeconds` 窗口内。**只看时间，不看状态。** */
  private withinWindow(): boolean {
    if (this.snapshot === null) return false
    const window = this.options.config.current().serverRefreshSeconds * 1000
    return this.options.clock.now() - this.snapshot.fetchedAt < window
  }

  /**
   * 能否直接拿缓存顶上。
   *
   * 与 {@link withinWindow} 分开：`restore` 要在状态还是 `empty` 时用纯时间判据，
   * 而这里必须要求 `ok` —— 否则一次失败之后，窗口内的旧快照会让 `getView`
   * 永远不再重试。
   */
  private canServeCache(): boolean {
    return this.state === 'ok' && this.withinWindow()
  }

  /** 跑一次真实抓取。**所有异常都在这里被吸收。** */
  private async fetchOnce(currency: string | undefined): Promise<BalanceView> {
    const startedAt = this.options.clock.now()
    try {
      const { raw, accountTag } = await this.options.reader.read()
      const snapshot = normalize(raw, accountTag, this.options.clock.now(), this.options.source)
      // 落盘失败不算这次抓取失败：快照留在内存里，界面照常显示，
      // 代价只是重启后不恢复。存储是可降级的一层。
      await this.persist(snapshot)
      this.snapshot = snapshot
      this.state = 'ok'
      this.error = null
      this.failures = 0
      this.retryAfterMs = null
      this.count('ok')
      this.observe(this.options.clock.now() - startedAt)
      this.publishGauge()
      return this.toView(currency)
    } catch (error) {
      this.applyFailure(error, startedAt)
      return this.toView(currency)
    }
  }

  /**
   * 把快照落盘。
   *
   * **失败只记一次 warn，不往上抛**：存储层降级不该让整个余额功能不可用。
   * @param snapshot - 刚归一化出来的快照。
   */
  private async persist(snapshot: BalanceSnapshot): Promise<void> {
    try {
      await this.options.store.saveSnapshot(snapshot)
    } catch (error) {
      if (this.persistWarned) return
      this.persistWarned = true
      this.options.logger?.warn('ds-balance: snapshot not persisted, continuing in memory', {
        source: this.options.source,
        error: describeError(error),
      })
    }
  }

  /** 记录一次失败，并把状态推到 `stale` 或 `error`。 */
  private applyFailure(error: unknown, startedAt: number): void {
    const info = classify(error)
    this.failures += 1
    this.error = info
    this.state = this.snapshot === null ? 'error' : 'stale'
    this.retryAfterMs = retryAfterOf(error, this.options.clock.now())
    // 只在首次失败打 warn，避免日志刷屏。
    if (this.failures === 1) {
      this.options.logger?.warn('ds-balance: balance fetch failed', {
        source: this.options.source,
        code: info.code,
      })
    }
    this.count('error')
    this.observe(this.options.clock.now() - startedAt)
    this.publishGauge()
  }

  /** 记一次抓取耗时（带上来源标签，两条路各自可看）。 */
  private observe(durationMs: number): void {
    this.metrics.histogram('balance_fetch_duration_ms', { source: this.options.source }, durationMs)
  }

  /** 记一次抓取结果。 */
  private count(result: 'ok' | 'error'): void {
    this.metrics.counter('balance_fetch_total', { result, source: this.options.source })
  }

  /** 把缓存状态推成指标。 */
  private publishGauge(): void {
    this.metrics.gauge('cache_state', { state: this.state, source: this.options.source }, 1)
  }

  /** 把缓存折成对外视图。 */
  private toView(currency: string | undefined): BalanceView {
    const config = this.options.config.current()
    const thresholds = this.options.config.thresholds()
    const preference = currency ?? config.displayCurrency
    const selected = this.snapshot === null ? null : pickBalance(this.snapshot.balances, preference)
    const severity = this.severityOf(selected)
    return {
      source: this.options.source,
      // 处境由事实一次判出；界面拿它当唯一分支入口。
      situation: situationOf({
        hasSnapshot: this.snapshot !== null,
        stale: this.state === 'stale',
        isAvailable: this.snapshot?.isAvailable ?? false,
        hasSelected: selected !== null,
        severity,
        errorCode: this.error?.code ?? null,
      }),
      state: this.state,
      stale: this.state === 'stale',
      fetchedAt: this.snapshot?.fetchedAt ?? null,
      ageMs:
        this.snapshot === null
          ? null
          : Math.max(0, this.options.clock.now() - this.snapshot.fetchedAt),
      isAvailable: this.snapshot?.isAvailable ?? null,
      balances: this.snapshot?.balances ?? [],
      selected: selected === null ? null : { currency: selected.currency, total: selected.total },
      severity,
      thresholds,
      error: this.state === 'ok' ? null : this.error,
    }
  }

  /**
   * 这一份视图的严重度。
   *
   * **只服务环的颜色与弧长**；「处境」是另一个维度，由 {@link situationOf} 判，
   * 两者不再各自决定界面形态（历史上它们是两条互相打架的链）。
   * @param selected - 选中币种的那条余额；没快照时是 `null`。
   * @returns 严重度。
   */
  private severityOf(selected: BalanceInfo | null): Severity {
    if (this.snapshot === null) {
      // 没有快照时只有两种事实：没接入（空环）与读不到（叉）。
      // 具体是哪一种由处境层判，这里给的 severity 只保证颜色不撒谎。
      return this.error?.code === 'NO_KEY' ? 'unknown' : 'unavailable'
    }
    const thresholds = this.options.config.thresholds()
    return severityOf(
      selected,
      this.snapshot?.isAvailable ?? false,
      thresholdsFor(selected?.currency ?? '', thresholds),
    )
  }
}

/** 从上游错误里抽 `Retry-After`；抽不到返回 `null`。 */
function retryAfterOf(error: unknown, now: number): number | null {
  if (typeof error !== 'object' || error === null || !('headers' in error)) return null
  const headers = error.headers
  if (!(headers instanceof Headers)) return null
  return parseRetryAfter(headers, now) ?? null
}

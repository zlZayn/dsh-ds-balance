/**
 * 余额服务门面：**决定这一轮走哪条取数路**，然后把活交给那条路的账本。
 *
 * 门面自己不持状态、不抓数据 —— 两份状态在 {@link SourceLedger} 里，一个来源一份。
 * 选源规则是四层回落（会话路由 → 全局默认路由 → Key 优先 → 都没有），判据是纯函数
 * [source-selector.ts](source-selector.ts)；两条路的读取策略在
 * [source-readers.ts](source-readers.ts)。
 * @module dsh-ds-balance/services/balance-service
 */

import type { BalanceSource, BalanceView } from '../domain/balance.js'
import type { Logger } from '../ports/logger.js'
import type {
  BalanceStatus,
  LedgerViewOptions,
  RefreshResult,
  SourceLedger,
} from './balance-source.js'
import { pickSource, routeOf } from './source-selector.js'

export type { BalanceStatus, RefreshResult, SourceReader } from './balance-source.js'

/** `getView` 的可选参数。 */
export interface GetViewOptions extends LedgerViewOptions {
  /**
   * 客户端给的**当前会话路由 id**（宿主 provider 名）。
   *
   * 只当提示用：认不出来或没给，就回落到全局默认路由 —— 客户端读不到会话时，
   * 界面不该因此失去来源。
   */
  providerHint?: string | null
}

/** 构造参数。 */
export interface BalanceServiceOptions {
  /** 两条账本；两个 id 都要在。 */
  ledgers: ReadonlyMap<BalanceSource, SourceLedger>
  /** 全局默认路由 id（宿主 `agentDefaultModel.currentSelection().provider`）；读不到回 `null`。 */
  routeProvider: () => string | null
  logger?: Logger | undefined
}

/** 余额服务门面。 */
export class BalanceService {
  private readonly options: BalanceServiceOptions
  /** 当前活跃来源；由最近一次解析决定，调度与健康检查读它。 */
  private active: BalanceSource = 'deepseek-http'
  /**
   * 来源判据是否已经定下来过。
   *
   * 宿主刚起来时两个可选服务（账号、默认模型）可能还没到，那一次解析只能按兜底走；
   * 服务到齐后由装配处调 {@link invalidateSource} + `scheduler.reset()` 重新定一次。
   * 一旦有请求解析过就以请求为准 —— 调度不拿全局默认去顶会话级的来源。
   */
  private resolved = false
  /** 每条路只恢复一次（存储扫描不便宜，来回切来源不该重复扫）。 */
  private readonly restores = new Map<BalanceSource, Promise<void>>()

  constructor(options: BalanceServiceOptions) {
    this.options = options
  }

  /** 当前活跃来源。诊断与测试用。 */
  activeSource(): BalanceSource {
    return this.active
  }

  /** 当前活跃账本的状态切片，供调度与健康检查使用。 */
  status(): BalanceStatus {
    return this.ledger(this.active).status()
  }

  /**
   * 当前账本标识的前 8 位；还没有快照时是 `null`。
   *
   * **只回前 8 位**：完整 tag 是账本作用域标识，没有对外的理由。
   */
  accountTag8(): string | null {
    return this.ledger(this.active).accountTag8()
  }

  /** 从存储恢复最近快照（挂载时调一次，恢复的是**当前活跃来源**那条账本）。 */
  async restore(): Promise<void> {
    await this.restoreLedger(await this.resolve(undefined))
  }

  /**
   * 取当前视图。
   *
   * `providerHint` 一变（用户切了会话、切了模型）就重新解析来源 —— 这是「跟着会话走」的入口。
   */
  async getView(options: GetViewOptions = {}): Promise<BalanceView> {
    const id = await this.resolve(options.providerHint)
    await this.restoreLedger(id)
    return this.ledger(id).getView({ force: options.force, currency: options.currency })
  }

  /**
   * 定时刷新：刷**当前活跃来源**。
   *
   * 来源还没定过（宿主刚起来、可选服务未到齐）时先解析一次；定过之后**不重新解析** ——
   * 节拍属于「这份数据」，不属于某一次请求，每轮都按全局默认重算会把会话级的来源无声顶掉。
   */
  async refreshActive(): Promise<BalanceView> {
    let id = this.resolved ? this.active : await this.resolve(undefined)
    // **服务晚到的自愈点**：宿主刚起来时判据可能还没齐（账号服务已注册、但它自己的凭据
    // 还没读出来），那一轮会落在一条不可用的路上。下一轮发现仍旧不可用就再解析一次 ——
    // 不必等界面来请求，也不必靠外部作废。
    if (!(await this.ledger(id).available())) id = await this.resolve(undefined)
    await this.restoreLedger(id)
    return this.ledger(id).getView({ force: true })
  }

  /**
   * 作废「来源已定」这件事，让下一次调度重新解析。
   *
   * 装配处在可选服务（账号 / 默认模型）到位时调它：那一刻判据才齐，之前那次解析是兜底。
   */
  invalidateSource(): void {
    this.resolved = false
  }

  /** 手动刷新：与 {@link getView} 同一条解析路径；冷却由该来源的账本自己管。 */
  async forceRefresh(reason: string, providerHint?: string | null): Promise<RefreshResult> {
    const id = await this.resolve(providerHint)
    await this.restoreLedger(id)
    return this.ledger(id).forceRefresh(reason)
  }

  /** 解析这一轮用哪条路，并把它记为活跃来源。 */
  private async resolve(hint: string | null | undefined): Promise<BalanceSource> {
    const routed = routeOf(hint ?? this.options.routeProvider())
    // 问**每一条**账本自己「此刻可用吗」：新增来源时这里一行都不用改。
    const availability = new Map<BalanceSource, boolean>()
    await Promise.all(
      [...this.options.ledgers].map(async ([id, ledger]) => {
        availability.set(id, await ledger.available())
      }),
    )
    const picked = pickSource({ routed, available: (id) => availability.get(id) === true })
    this.resolved = true
    if (picked !== this.active) {
      this.options.logger?.debug('ds-balance: balance source switched', {
        from: this.active,
        to: picked,
        routed,
      })
    }
    this.active = picked
    return picked
  }

  /** 取账本；缺一条属于装配错误，直接抛（静默降级会让界面永远停在空态）。 */
  private ledger(id: BalanceSource): SourceLedger {
    const ledger = this.options.ledgers.get(id)
    if (ledger === undefined) throw new Error(`ds-balance: no ledger for source ${id}`)
    return ledger
  }

  /** 首次用到某条路时才恢复它的快照；并发调用合并成一次。 */
  private restoreLedger(id: BalanceSource): Promise<void> {
    let pending = this.restores.get(id)
    if (pending === undefined) {
      pending = this.ledger(id).restore()
      this.restores.set(id, pending)
    }
    return pending
  }
}

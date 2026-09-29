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
import { FALLBACK_ORDER, pickSource, routeOf } from './source-selector.js'

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
   *
   * **本插件只记官方的那一个数字**，所以首选那条路拿不出数字时**退到另一条官方路**：
   * 叉（空态 / 失败态）只在「官方两条路都拿不到数据」时才出现 —— 那才是「没接入官方」。
   */
  async getView(options: GetViewOptions = {}): Promise<BalanceView> {
    const preferred = await this.resolve(options.providerHint)
    const view = await this.viewOf(preferred, options)
    // 展示出去的那条 = 刷新与标签认的那条（否则「数字是账号的、刷新去刷 Key」）。
    if (view.state === 'ok') {
      this.mark(preferred)
      return view
    }

    // 兜底顺序：固定顺序里排在前面的先试，跳过刚试过的那条。
    for (const id of FALLBACK_ORDER) {
      if (id === preferred) continue
      const fallback = await this.viewOf(id, options)
      // 有快照就赢过没快照（陈的官方数字也比一个叉有信息）；两边都没快照就继续找。
      if (fallback.state === 'ok' || fallback.fetchedAt !== null) {
        this.mark(id)
        return fallback
      }
    }
    this.mark(preferred)
    return view
  }

  /** 取一条路的视图（先确保它恢复过）。 */
  private async viewOf(id: BalanceSource, options: GetViewOptions): Promise<BalanceView> {
    await this.restoreLedger(id)
    return this.ledger(id).getView({ force: options.force, currency: options.currency })
  }

  /**
   * 定时刷新：刷**用户实际看到的那条**。
   *
   * 来源还没定过（宿主刚起来、可选服务未到齐）时先解析一次；定过之后就认 `active` ——
   * 而 `active` 是**上一次真正把数字交出去的那条**（`getView` 兜底出去的也算），
   * 所以兜底展示的账号数字才会被继续刷新，不会永远停在一张旧快照上。
   */
  async refreshActive(): Promise<BalanceView> {
    let id = this.resolved ? this.active : await this.resolve(undefined)
    // **服务晚到的自愈点**：宿主刚起来时判据可能还没齐（账号服务已注册、但它自己的凭据
    // 还没读出来），那一轮会落在一条不可用的路上。下一轮发现仍旧不可用就再解析一次 ——
    // 不必等界面来请求，也不必靠外部作废。
    if (!(await this.ledger(id).available())) id = await this.resolve(undefined)
    this.mark(id)
    await this.restoreLedger(id)
    return this.ledger(id).getView({ force: true })
  }

  /** 作废「来源已定」这件事，让下一次调度重新解析。 */
  invalidateSource(): void {
    this.resolved = false
  }

  /**
   * 手动刷新：**用户看哪条就刷哪条**（与 {@link getView} 同一条判定）。
   *
   * 首选那条一条数字都没有时，界面上实际是兜底那条在撑着 —— 那就刷兜底那条，
   * 否则用户点了刷新、数字却永远不动。冷却仍由那条自己的账本管。
   */
  async forceRefresh(reason: string, providerHint?: string | null): Promise<RefreshResult> {
    const preferred = await this.resolve(providerHint)
    await this.restoreLedger(preferred)
    const shown = this.ledger(preferred).status().hasSnapshot
      ? preferred
      : await this.firstWithSnapshot(preferred)
    this.mark(shown)
    await this.restoreLedger(shown)
    return this.ledger(shown).forceRefresh(reason)
  }

  /** 找一条**有快照**的官方路；都没有就退回默认那条（那时才画叉）。 */
  private async firstWithSnapshot(preferred: BalanceSource): Promise<BalanceSource> {
    for (const id of FALLBACK_ORDER) {
      if (id === preferred) continue
      await this.restoreLedger(id)
      if (this.ledger(id).status().hasSnapshot) return id
    }
    return preferred
  }

  /** 记下「这条刚刚把数字交出去了」：展示、刷新、标签从此都认它。 */
  private mark(id: BalanceSource): void {
    if (id !== this.active) {
      this.options.logger?.debug('ds-balance: balance source switched', {
        from: this.active,
        to: id,
      })
    }
    this.active = id
    this.resolved = true
  }

  /** 解析这一轮**首选**哪条路。 */
  private async resolve(hint: string | null | undefined): Promise<BalanceSource> {
    const routed = routeOf(hint ?? this.options.routeProvider())
    // 问**每一条**账本自己「此刻可用吗」：新增来源时这里一行都不用改。
    const availability = new Map<BalanceSource, boolean>()
    await Promise.all(
      [...this.options.ledgers].map(async ([id, ledger]) => {
        availability.set(id, await ledger.available())
      }),
    )
    return pickSource({ routed, available: (id) => availability.get(id) === true })
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

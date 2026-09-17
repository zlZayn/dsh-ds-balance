/**
 * 侧栏左下角的余额条目。
 *
 * 两个形态共用同一个状态圆环：展开态是「圆环 + 金额」，折叠态是轨道里居中一个圆环。
 * 点击条目弹出余额浮层，Escape 或点击外部关闭（刻意不做悬停即开：浮层向上展开，
 * 会盖住左邻条目；悬停时指针只是路过我们这一行，邻居的图标就被顶开了）。
 *
 * 数据默认走真实端点（`GET /api/v1/balance`，按 `clientPollSeconds` 轮询）；
 * 只有 URL 参数或 localStorage 明确选过场景时才切到 mock 旁路。
 * 颜色仍只由 `dotStateOf(severity)` 决定。弧长是唯一读阈值的去处，且只当刻度：
 * 由 `ringRatioOf` 算好交给圆环。组件内不做配色判断、不读 ctx。
 * @module dsh-ds-balance/client/sidebar/SidebarBalance
 */

import {
  useCallback, useEffect, useMemo, useRef, useState, type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import {
  IconWarningOutline16, Tooltip, useAnchoredPosition, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BalanceResponse, Severity } from '../api-types.ts'
import { interpolate, type LocaleKey } from '../locales.ts'
import {
  formatMoney, ringRatioOf, ringSpecOf, selectionOf, type CurrencySelection, type RingMarker,
} from '../model.ts'
import { currentBalance, resolveScenario, subscribeScenario } from '../mock/index.ts'
import { pendingView, requestBalance, requestRefresh, unreachableView } from '../data.ts'
import { BalancePopover } from './BalancePopover.tsx'
import { PercentRing, type RingState } from './PercentRing.tsx'
import css from './SidebarBalance.module.css'

/** 模拟一次刷新的耗时（毫秒）。 */
const REFRESH_SIMULATION_MS = 600

/** 面板与触发区之间的间距（对齐官方 stat-dialog 的 PANEL_GAP）。 */
const PANEL_GAP = 8

/** 面板与视口各边的间距（对齐官方 stat-dialog 的 PANEL_MARGIN）。 */
const PANEL_MARGIN = 12

/**
 * 尚未定位时的面板样式：隐藏但仍参与布局，好让钳制在同一个 commit 里用真实尺寸量一次。
 * 与官方 stat-dialog 的 MEASURE_STYLE 逐字一致。
 */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** 一秒的毫秒数；相对时间与手动刷新冷却都按它换算。 */
const MS_PER_SECOND = 1000

/** 浮层打开时相对时间的刷新间隔。 */
const TICK_MS = MS_PER_SECOND

/** 条目属性。 */
export interface SidebarBalanceProps {
  /** 侧栏是否展开（false = 56px 轨道）。 */
  wide: boolean
  /** 词典函数。 */
  t: (key: LocaleKey) => string
  /** 本组件消费的配置切片。 */
  config: {
    displayCurrency: string
    manualRefreshCooldownSeconds: number
    /** 浏览器来取缓存的节奏（秒）。 */
    clientPollSeconds: number
    /**
     * 配置指纹。任何一项设置改动都会换一个值，用来**立刻**重问一次后端缓存 ——
     * 改了阈值圆环要当场变，不该等下一轮轮询。
     */
    configSignature: string
    /**
     * 读某个币种的 warn 阈值。**只用来定弧长**，颜色不走这里。
     * 没配的币种给 `undefined`，由 `ringRatioOf` 退回按 severity 定性。
     */
    warnThresholdOf: (currency: string) => number | undefined
  }
}

/**
 * 状态圆环要播报的状态名。
 *
 * 一切正常时返回 null：词典里没有「一切正常」这一条（也不该新增），
 * 此时只报余额即可。
 * @param response - 当前余额响应。
 * @param selection - 币种选择结果。
 * @returns 词典键，或 null 表示正常。
 */
function stateLabelKey(response: BalanceResponse, selection: CurrencySelection): LocaleKey | null {
  if (response.state === 'error') return response.error?.code === 'NO_KEY' ? 'state.noKey' : 'state.error'
  if (response.state === 'empty') return response.error?.code === 'NO_KEY' ? 'state.noKey' : 'state.empty'
  if (response.state === 'stale') return 'state.stale'
  if (!response.isAvailable) return 'state.unavailable'
  if (selection.shown === null) return 'state.noBalance'
  return null
}

/**
 * 把 severity 收敛成圆环的形态。
 *
 * 映射出自 `model.ts` 的 `ringSpecOf`；它的 `state` 类型含 `'ongoing'`，
 * 但 severity 的映射取不到那个值，这里只做类型收窄。
 * @param severity - 后端给的严重度。
 * @returns 弧状态与中心符号。
 */
function ringSpecFor(severity: Severity): { state: RingState; marker: RingMarker | null } {
  const spec = ringSpecOf(severity)
  return { state: spec.state === 'ongoing' ? 'idle' : spec.state, marker: spec.marker }
}

/**
 * 渲染侧栏左下角的余额条目。
 * @param props - 展开态、词典与配置切片。
 * @returns 条目元素。
 */
export function SidebarBalance({ wide, t, config }: SidebarBalanceProps): JSX.Element | null {
  /** 是否走 mock 旁路。默认否 —— 真机上必须显示真实余额。 */
  const [mock, setMock] = useState(() => resolveScenario() !== null)
  const [response, setResponse] = useState<BalanceResponse>(() => (resolveScenario() === null ? pendingView() : currentBalance()))
  /** 是否至少成功取过一次。失败的轮询不该把已显示的数据换成错误态。 */
  const loadedRef = useRef(false)
  /** 「改用 X」只写本地偏好；父代理后续把它接到设置。 */
  const [localCurrency, setLocalCurrency] = useState<string | null>(null)
  /** 模拟刷新后的抓取时刻；null 表示仍用 mock 给的值。 */
  const [localFetchedAt, setLocalFetchedAt] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  const rootRef = useRef<HTMLDivElement>(null)
  /** 面板在 portal 里，这个 ref 同时喂给 useAnchoredPosition（量尺寸）与外部点击判定。 */
  const panelRef = useRef<HTMLElement>(null)
  const refreshTimer = useRef<number | undefined>(undefined)
  const lastScenario = useRef<string | null>(null)
  /** 挂载时刻：把后端给的 ageMs 换算成一个绝对时刻。 */
  const mountedAt = useRef(Date.now())

  const preference = localCurrency ?? config.displayCurrency
  // 币种由后端选定，前端只做映射：见 model.ts 的 selectionOf。
  const selection = useMemo(() => selectionOf(response, preference), [response, preference])

  // 生效的抓取时刻。本地模拟刷新后就是刷新那一刻；
  // 否则以 ageMs 反推 —— mock 的 fetchedAt 是固定的 T0，只有 ageMs 是真实年龄，
  // 而且后端时钟与浏览器时钟未必一致，基准本来就该取 ageMs。
  const fetchedAt = localFetchedAt ?? (mountedAt.current - response.ageMs)

  // 开发场景切换时换数据。subscribeScenario 会立刻回调一次，用 key 比对跳过它。
  // 每次回调都重判来源：`?dsb=live` 打开后会把 localStorage 里的场景清掉，
  // 于是这里从 mock 切回真实端点。
  useEffect(() => subscribeScenario((key) => {
    const active = resolveScenario() !== null
    setMock(active)
    if (!active || lastScenario.current === key) return
    lastScenario.current = key
    setResponse(currentBalance())
    setLocalFetchedAt(null)
    setRefreshing(false)
    setCooldownUntil(0)
    setOpen(false)
  }), [])

  // 真实数据：首拉一次，然后按 clientPollSeconds 轮询。
  // 轮询读的是后端缓存，不穿透到上游 —— 上游节奏由 serverRefreshSeconds 决定。
  useEffect(() => {
    if (mock) return
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const next = await requestBalance({ currency: preference })
        if (cancelled) return
        loadedRef.current = true
        setResponse(next)
        setLocalFetchedAt(null)
      } catch (error) {
        if (cancelled || loadedRef.current) return
        setResponse(unreachableView(error instanceof Error ? error.message : String(error)))
      }
    }
    void load()
    const id = window.setInterval(() => { void load() }, Math.max(5, config.clientPollSeconds) * MS_PER_SECOND)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
    // 两个额外依赖都是有意的：
    // - preference：「改用 X」写的是本地偏好，换币种必须立刻按新币种重问一次后端。
    // - configSignature：改阈值要当场看到圆环变色，不能等下一轮轮询。
    // 两条都不穿透上游 —— 后端从缓存快照按新阈值重算，只有 state 不是 ok 时才会真去拉。
  }, [mock, preference, config.clientPollSeconds, config.configSignature])

  useEffect(() => () => {
    if (refreshTimer.current !== undefined) window.clearTimeout(refreshTimer.current)
  }, [])

  const closeNow = useCallback((): void => {
    setOpen(false)
  }, [])

  // 点击触发按钮 toggle。处理器只挂在按钮上、不挂根 div ——
  // 否则浮层内部（刷新按钮、两个动作按钮）的点击会冒泡上来把浮层关掉。
  const toggleOpen = useCallback((): void => {
    setOpen((value) => !value)
  }, [])

  // 定位交给官方 hook：量锚点、按 side/gap 偏移、钳进视口，
  // 并在 scroll（capture，覆盖嵌套滚动容器）、resize 与面板自身尺寸变化时重算。
  // 锚点就是我们这一整行：浮层左缘与行对齐（侧栏左缘）、向上展开，与官方用量浮层同构。
  // 打开时它确实会盖住上方邻居那一格（与官方 cordis 面板同构，维护者已确认可接受）；
  // 关键是关闭时点邻居要落到邻居身上 —— 那由触发按钮不写 aria-haspopup 保证。
  const pos = useAnchoredPosition({
    open,
    anchorRef: rootRef,
    panelRef,
    side: 'top',
    gap: PANEL_GAP,
    margin: PANEL_MARGIN,
  })

  // 相对时间与冷却秒数只在浮层打开时推进。
  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const id = window.setInterval(() => { setNow(Date.now()) }, TICK_MS)
    return () => { window.clearInterval(id) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeNow()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, closeNow])

  // 面板 portal 到了 body，不再是 rootRef 的 DOM 后代，
  // 所以要把它作为第 4 个参数传进去，否则点浮层内部会被当成「外部」而关掉。
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)

  const handleRefresh = useCallback((): void => {
    if (refreshing) return
    // 冷却中：不旋转，浮层里的就地文字已经在报剩余秒数。
    if (Date.now() < cooldownUntil) return
    setRefreshing(true)
    const finish = (): void => {
      setLocalFetchedAt(Date.now())
      setRefreshing(false)
      setCooldownUntil(Date.now() + Math.max(0, config.manualRefreshCooldownSeconds) * MS_PER_SECOND)
    }
    // mock 旁路没有上游可打，用一次短延迟模拟往返，让刷新态仍然可见。
    if (mock) {
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = undefined
        finish()
      }, REFRESH_SIMULATION_MS)
      return
    }
    void (async () => {
      try {
        // 先让后端穿透上游抓一次，再读回它刚写好的缓存。
        await requestRefresh({ reason: 'manual' })
        const next = await requestBalance({ currency: preference })
        loadedRef.current = true
        setResponse(next)
      } catch (error) {
        if (!loadedRef.current) setResponse(unreachableView(error instanceof Error ? error.message : String(error)))
      } finally {
        finish()
      }
    })()
  }, [cooldownUntil, config.manualRefreshCooldownSeconds, mock, preference, refreshing])

  const handleUseShown = useCallback((): void => {
    const current = selection.shown
    if (current === null) return
    setLocalCurrency(current.currency)
  }, [selection])

  // 设置面板没有公开的「打开并跳到某一节」入口（原生无公开入口），
  // 本阶段只做占位；父代理接上真实入口后替换这里。
  const handleOpenSettings = useCallback((): void => {}, [])

  const shown = selection.shown
  const ring = ringSpecFor(response.severity)
  // 弧长：余额占该币种 warn 阈值的几分之几。阈值只当刻度，颜色仍只由 severity 决定。
  const ringRatio = ringRatioOf(
    shown === null ? null : shown.total,
    shown === null ? undefined : config.warnThresholdOf(shown.currency),
    response.severity,
  )

  // 圆环的状态文案。正常时为 null —— 词典里没有对应键，也不该新增。
  const stateKey = stateLabelKey(response, selection)
  const stateText = stateKey === null ? null : t(stateKey)

  let markerLabel: string | null = null
  let markerHint = ''
  if (shown === null) {
    markerLabel = t(stateKey ?? 'state.noBalance')
    markerHint = markerLabel
  } else if (!selection.matchesPreference) {
    markerLabel = t('sidebar.aria.mismatch')
    markerHint = interpolate(t('popover.mismatch'), { wanted: preference, shown: shown.currency })
  }

  // 按钮的 aria-label 会盖掉子树里的名字，圆环本身又是 aria-hidden，
  // 所以金额、状态与标记含义都必须并进来 —— 读屏用户在点开浮层之前就能听到余额。
  // 首段与可见标签逐字一致（sidebar.label），满足「无障碍名必须包含可见标签」。
  const ariaParts = [wide ? t('sidebar.label') : t('sidebar.aria.ring')]
  // 没有余额时不念占位符：紧随其后的状态文案已经说了「暂无余额」。
  if (shown !== null) ariaParts.push(formatMoney(shown.total, shown.currency))
  // 没有余额时状态文案与标记文案本就是同一条，去重避免念两遍。
  if (stateText !== null && stateText !== markerLabel) ariaParts.push(stateText)
  if (markerLabel !== null) ariaParts.push(markerLabel)
  const ariaLabel = ariaParts.join(' ')
  const cooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / MS_PER_SECOND))

  // 折叠态只有环、没有任何可见文字，用原生 title 补一条悬停提示；
  // 展开态标签与标记就在旁边，不再叠第二个 tooltip。
  const ringTitle = !wide && stateText !== null ? `${t('sidebar.aria.ring')} ${stateText}` : undefined

  return (
    <div
      ref={rootRef}
      className={css.root}
      data-mode={wide ? 'wide' : 'rail'}
      tabIndex={-1}
    >
      {/* 刻意不写 aria-haspopup="dialog"：
          已装的 dsh-usage-statistics-panel 用 button[aria-haspopup="dialog"] 从它自己的
          按钮往上逐层 querySelector 去找设置触发按钮（SidebarEntry.tsx:35-60）。我们和它
          同在一个槽容器里、注册得又比它晚，那个选择器会在容器这一层先命中我们，
          于是点它反而打开了我们的浮层。
          aria-expanded 表达的是同一个事实（这里会展开一个弹层），且不会被那个启发式命中。
          浮层面板自己的 role="dialog" 保留不变。 */}
      <button
        type="button"
        className={css.trigger}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={toggleOpen}
      >
        {wide ? (
          <>
            <span className={css.icon}>
              <PercentRing state={ring.state} marker={ring.marker} ratio={ringRatio} size={16} />
            </span>
            <span className={css.label}>{t('sidebar.label')}</span>
            {markerLabel === null ? null : (
              <Tooltip label={markerHint} side="bottom" delayMs={500}>
                <span className={css.marker} role="img" aria-label={markerLabel}>
                  <IconWarningOutline16 size={12} />
                </span>
              </Tooltip>
            )}
          </>
        ) : (
          <PercentRing state={ring.state} marker={ring.marker} ratio={ringRatio} size={18} title={ringTitle} />
        )}
      </button>

      {/* 关闭时整个浮层卸载：DOM 里不留任何可命中区域。
          浮层向上展开、正压在左邻条目上，所以只有点击才会打开它 —— 悬停打开会让
          指针只是路过我们这一行时就把邻居的图标顶掉。 */}
      {open ? createPortal(
        <BalancePopover
          t={t}
          selection={selection}
          displayCurrency={preference}
          fetchedAt={fetchedAt}
          now={now}
          refreshing={refreshing}
          cooldownSeconds={cooldownSeconds}
          panelRef={panelRef}
          style={pos ?? MEASURE_STYLE}
          onRefresh={handleRefresh}
          onUseShown={handleUseShown}
          onOpenSettings={handleOpenSettings}
        />,
        document.body,
      ) : null}
    </div>
  )
}

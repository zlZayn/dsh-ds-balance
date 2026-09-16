/**
 * 侧栏左下角的余额条目。
 *
 * 两个形态共用同一个状态圆环：展开态是「圆环 + 金额」，折叠态是轨道里居中一个圆环。
 * 点击条目弹出余额浮层，Escape 或点击外部关闭（刻意不做悬停即开：浮层向上展开，
 * 会盖住左邻条目；悬停时指针只是路过我们这一行，邻居的图标就被顶开了）。
 * 数据来自 mock 场景，颜色只由 `dotStateOf(severity)` 决定，
 * 金额全程按字符串走 model.ts 的函数，组件内不做任何金额阈值判断、不读 ctx。
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
import { dotStateOf, formatMoney, selectCurrency, type CurrencySelection } from '../model.ts'
import { currentBalance, subscribeScenario } from '../mock/index.ts'
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
  config: { displayCurrency: string; manualRefreshCooldownSeconds: number }
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
 * 把 severity 收敛成圆环的四档状态。
 *
 * 映射仍然出自 `dotStateOf`；它的返回类型含 `'ongoing'`，
 * 但 severity 的映射取不到那个值（见 model.ts 的 dotStateOf），这里只做类型收窄。
 * @param severity - 后端给的严重度。
 * @returns 圆环状态。
 */
function ringStateOf(severity: Severity): RingState {
  const state = dotStateOf(severity)
  return state === 'ongoing' ? 'idle' : state
}

/**
 * 渲染侧栏左下角的余额条目。
 * @param props - 展开态、词典与配置切片。
 * @returns 条目元素。
 */
export function SidebarBalance({ wide, t, config }: SidebarBalanceProps): JSX.Element | null {
  const [response, setResponse] = useState<BalanceResponse>(() => currentBalance())
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
  const selection = useMemo(() => selectCurrency(response, preference), [response, preference])

  // 生效的抓取时刻。本地模拟刷新后就是刷新那一刻；
  // 否则以 ageMs 反推 —— mock 的 fetchedAt 是固定的 T0，只有 ageMs 是真实年龄，
  // 而且后端时钟与浏览器时钟未必一致，基准本来就该取 ageMs。
  const fetchedAt = localFetchedAt ?? (mountedAt.current - response.ageMs)

  // 开发场景切换时换数据。subscribeScenario 会立刻回调一次，用 key 比对跳过它。
  useEffect(() => subscribeScenario((key) => {
    if (lastScenario.current === key) return
    lastScenario.current = key
    setResponse(currentBalance())
    setLocalFetchedAt(null)
    setRefreshing(false)
    setCooldownUntil(0)
    setOpen(false)
  }), [])

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
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = undefined
      setLocalFetchedAt(Date.now())
      setRefreshing(false)
      setCooldownUntil(Date.now() + Math.max(0, config.manualRefreshCooldownSeconds) * MS_PER_SECOND)
    }, REFRESH_SIMULATION_MS)
  }, [cooldownUntil, config.manualRefreshCooldownSeconds, refreshing])

  const handleUseShown = useCallback((): void => {
    const current = selection.shown
    if (current === null) return
    setLocalCurrency(current.currency)
  }, [selection])

  // 设置面板没有公开的「打开并跳到某一节」入口（原生无公开入口），
  // 本阶段只做占位；父代理接上真实入口后替换这里。
  const handleOpenSettings = useCallback((): void => {}, [])

  const shown = selection.shown
  const ringState = ringStateOf(response.severity)

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
              <PercentRing state={ringState} size={16} />
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
          <PercentRing state={ringState} size={18} title={ringTitle} />
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

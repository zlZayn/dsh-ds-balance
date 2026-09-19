/**
 * 余额浮层：点击条目后在条目的上方展开。
 *
 * 皮肤照抄官方「用量 / 用时」浮层（ui-chat 的 stat-dialog.module.css）；
 * 定位由父组件用 useAnchoredPosition 算好后经 style 传入，本组件只渲染表面。
 * 面板由父组件 createPortal 挂到 document.body，所以 panelRef 指向面板自身。
 * @module dsh-ds-balance/client/sidebar/BalancePopover
 */

import type { CSSProperties, RefObject } from 'react'
import { Button, FishLogo, IconRefreshOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { interpolate, type LocaleKey } from '../locales.ts'
import { ageBucket, formatMoney, type AgeBucket, type CurrencySelection } from '../model.ts'
import css from './BalancePopover.module.css'

/** 没有可显示金额时的占位符；条目与浮层共用同一个字面量。 */
export const BALANCE_PLACEHOLDER = '--'

/** ageBucket 里带数值的四档。 */
type CountedBucket = Exclude<AgeBucket, 'just-now' | 'unknown'>

/** 档位对应的 Intl 单位名。 */
const AGE_UNIT: Record<CountedBucket, string> = {
  seconds: 'second',
  minutes: 'minute',
  hours: 'hour',
  days: 'day',
}

/**
 * 探测词典语言。
 *
 * `t` 只接受键、不暴露当前语言，而词典里没有时长单位词条（键名已定、不许新增），
 * 所以单位的本地化交给 `Intl.NumberFormat` 的 unit 样式：中文得「3分钟」、
 * 英文得「3 minutes」，再套进 `{value}前` / `{value} ago` 两种模板都成立。
 * @param t - 词典函数。
 * @returns 传给 Intl 的 BCP-47 语言标签。
 */
function unitLocale(t: (key: LocaleKey) => string): string {
  return /[\u3400-\u9fff]/.test(t('popover.updated.justNow')) ? 'zh-CN' : 'en-US'
}

/**
 * 把一档数值时长渲染成本地化的单位短语。
 * @param bucket - 已排除 just-now / unknown 的档位。
 * @param value - 该档位的数值。
 * @param locale - 目标语言标签。
 * @returns 形如「3分钟」或「3 minutes」的短语。
 */
function ageValueText(bucket: CountedBucket, value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: AGE_UNIT[bucket],
      unitDisplay: 'long',
    }).format(value)
  } catch {
    /* 老引擎缺 unit 样式时退化成裸数字，不阻断渲染。 */
    return String(value)
  }
}

/** 浮层属性。 */
export interface BalancePopoverProps {
  /** 词典函数。 */
  t: (key: LocaleKey) => string
  /** 币种选择结果。 */
  selection: CurrencySelection
  /** 用户在设置里选的币种，用于不匹配文案。 */
  displayCurrency: string
  /** 数据现在的年龄（毫秒）= 收到那份响应时后端报的年龄 + 此后流逝的时间。 */
  ageMs: number
  /** 是否正在刷新。 */
  refreshing: boolean
  /** 冷却剩余秒数；0 表示可以刷新。 */
  cooldownSeconds: number
  /**
   * 「本宿主没有配置槽」的提示行；null 表示不提示。
   *
   * 文案由 [config-slot.ts](../config-slot.ts) 给：它是英文 `[WARN]` 诊断行，
   * 按兼容性硬约束两种语言下都照原文给，所以刻意不进双语词典。
   */
  configSlotWarning: string | null
  /** 面板自身的引用：useAnchoredPosition 用它量尺寸，外部点击判定用它算「内部」。 */
  panelRef: RefObject<HTMLElement>
  /** 由 useAnchoredPosition 给出的 fixed 坐标；首帧是 MEASURE_STYLE（隐藏待测）。 */
  style: CSSProperties
  /** 刷新回调。 */
  onRefresh: () => void
  /** 「改用 X」回调。 */
  onUseShown: () => void
  /** 「去设置」回调；本阶段只做占位。 */
  onOpenSettings: () => void
}

/**
 * 渲染余额浮层。
 * @param props - 选择结果、时间、刷新状态、面板 ref/style 与三个动作回调。
 * @returns 浮层元素。
 */
export function BalancePopover(props: BalancePopoverProps): JSX.Element {
  const {
    t, selection, displayCurrency, ageMs, refreshing, cooldownSeconds,
    configSlotWarning, panelRef, style, onRefresh, onUseShown, onOpenSettings,
  } = props

  const shown = selection.shown
  const totalText = shown === null ? BALANCE_PLACEHOLDER : formatMoney(shown.total, shown.currency)
  const grantedText = shown === null ? BALANCE_PLACEHOLDER : formatMoney(shown.granted, shown.currency)
  const toppedUpText = shown === null ? BALANCE_PLACEHOLDER : formatMoney(shown.toppedUp, shown.currency)

  const age = ageBucket(ageMs)
  const updatedText = age.bucket === 'just-now' || age.bucket === 'unknown'
    ? t('popover.updated.justNow')
    : interpolate(t('popover.updated'), {
      value: ageValueText(age.bucket, age.value, unitLocale(t)),
    })

  const cooling = cooldownSeconds > 0

  // 刷新中优先于冷却：两者不会同时成立，但刷新中的文案更贴近当下。
  let statusText = ''
  if (refreshing) statusText = t('popover.refreshing')
  else if (cooling) statusText = interpolate(t('popover.cooldown'), { value: String(cooldownSeconds) })

  const refreshLabel = t('sidebar.aria.refresh')

  return (
    <section
      ref={panelRef}
      className={css.panel}
      style={style}
      role="dialog"
      aria-label={t('popover.title')}
    >
      <div className={css.title}>
        <span className={css.titleLabel}>
          <FishLogo size={14} />
          {t('popover.title')}
        </span>
      </div>

      {/* 标题与明细之间唯一的一条分隔线；只靠边框成线，所以标 aria-hidden。 */}
      <div className={css.titleRule} aria-hidden />

      <dl className={css.details}>
        <dt>{t('popover.total')}</dt>
        <dd>{totalText}</dd>
        <dt>{t('popover.granted')}</dt>
        <dd>{grantedText}</dd>
        <dt>{t('popover.toppedUp')}</dt>
        <dd>{toppedUpText}</dd>
      </dl>

      {shown !== null && !selection.matchesPreference ? (
        <div className={css.notice}>
          <p className={css.noticeText}>
            {interpolate(t('popover.mismatch'), { wanted: displayCurrency, shown: shown.currency })}
          </p>
          <div className={css.noticeActions}>
            <Button size="sm" variant="outline" onClick={onUseShown}>
              {interpolate(t('popover.action.useShown'), { shown: shown.currency })}
            </Button>
            <Button size="sm" variant="outline" onClick={onOpenSettings}>
              {t('popover.action.openSettings')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* 缺配置槽的诊断行：只解释「为什么这里没有配置入口」并给升级指引，
          不提供任何动作按钮 —— 升级宿主不是这个浮层能做的事。 */}
      {configSlotWarning === null ? null : (
        <div className={css.notice}>
          <p className={css.noticeText}>{configSlotWarning}</p>
        </div>
      )}

      <div className={css.footer}>
        <span className={css.updated}>{updatedText}</span>
        <span className={css.status} role="status">{statusText}</span>
        <Tooltip label={refreshLabel} side="top" delayMs={500} disabled={refreshing || cooling}>
          <button
            type="button"
            className={css.refresh}
            aria-label={refreshLabel}
            // 冷却期内也算不可用：点了不会发请求，按钮就该灰着，而不是只换一行文字。
            disabled={refreshing || cooling}
            data-refreshing={refreshing || undefined}
            data-cooling={cooling || undefined}
            onClick={onRefresh}
          >
            <IconRefreshOutline16 size={16} />
          </button>
        </Tooltip>
      </div>
    </section>
  )
}

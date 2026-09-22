/**
 * 手写字段控件：一行一个字段，控件只报告用户输入，写入统一由卡片的保存完成。
 * 结构对齐官方 ui-settings-plugins/fields.tsx，取值全部走 --dsw-alias-* 语义令牌。
 * @module dsh-ds-balance/client/settings/fields
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  DisclosureRow, IconChevronDownOutlineRegular, Menu, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './fields.module.css'

/** 一个配置分组的属性。展开状态由调用方持有：DisclosureRow 是完全受控组件。 */
export interface FieldGroupProps {
  /** 折叠头左侧的图标；展开后会被原语自己的 chevron 取代。 */
  icon: ReactNode
  /** 折叠头标题，收起态也显示。 */
  title: string
  /** 展开体开头的组级说明。 */
  note?: ReactNode
  open: boolean
  onToggle: () => void
  /** 卡片里的最后一组：由它自己补上尾部 12px，卡片 body 不再单独贡献尾距。 */
  last?: boolean
  children: ReactNode
}

/**
 * 一个可折叠的配置分组。
 * 折叠头用原语 DisclosureRow（不自己画），展开体由原语在 open 时条件渲染、无动画。
 * 各组独立展开，不做手风琴：官方 PluginCard 的注释写明多项同时展开是刻意的。
 * @param props - 图标、标题、可选说明、受控展开状态与字段。
 * @returns 分组元素。
 */
export function FieldGroup(props: FieldGroupProps) {
  return (
    <DisclosureRow
      className={clsx(css.group, props.last === true && css.groupLast)}
      icon={props.icon}
      title={props.title}
      open={props.open}
      expandable
      expandOnRowClick
      onToggle={props.onToggle}
    >
      {props.note === undefined ? null : <p className={css.groupNote}>{props.note}</p>}
      <div className={css.fields}>{props.children}</div>
    </DisclosureRow>
  )
}

/** 标签行右侧的状态胶囊：文案与色调都由调用方决定。 */
export interface FieldStatus {
  readonly label: string
  readonly tone: TagTone
}

/** 标签行右侧的徽标区：状态胶囊、未保存标记与撤销入口。 */
export interface FieldBadgesProps {
  /** 常驻状态胶囊；为 null 或省略时不渲染。 */
  status?: FieldStatus | null
  /** 存在未保存的草稿。 */
  pending: boolean
  /** 存在可撤销的东西：草稿或已存的用户覆盖。 */
  resettable: boolean
  /** 「未保存」文案。 */
  pendingLabel: string
  /** 撤销入口文案。 */
  resetLabel: string
  disabled: boolean
  /** 暂存一次清除。 */
  onReset: () => void
}

/**
 * 渲染字段的徽标区。三者都不存在时不渲染任何东西。
 * 状态胶囊排在最前，因为它描述的是当前生效值，而后面两个描述的是待保存的改动。
 * @param props - 状态胶囊、两种改动状态与撤销回调。
 * @returns 徽标区元素或 null。
 */
export function FieldBadges(props: FieldBadgesProps) {
  const status = props.status ?? null
  if (status === null && !props.pending && !props.resettable) return null
  return (
    <span className={css.badges}>
      {status === null ? null : <Tag tone={status.tone}>{status.label}</Tag>}
      {props.pending ? <Tag tone="neutral">{props.pendingLabel}</Tag> : null}
      {props.resettable
        ? (
          <button
            type="button"
            className={css.reset}
            disabled={props.disabled}
            onClick={props.onReset}
          >
            {props.resetLabel}
          </button>
        )
        : null}
    </span>
  )
}

/** 字段容器：标签行、控件、提示行。 */
export interface FieldFrameProps extends FieldBadgesProps {
  /** 关联 label 与控件的稳定 id。 */
  id: string
  /** 可见标签。 */
  label: string
  /** 是否为非法草稿；为真时提示行换成 invalidNote。 */
  invalid: boolean
  /** 常驻说明；省略或为空串时不渲染提示行。 */
  hint?: ReactNode
  /** 非法时替换说明的文案；省略时沿用 hint。 */
  invalidNote?: ReactNode
  /** 控件本体。 */
  children: ReactNode
}

/**
 * 渲染一个字段行。
 * @param props - 字段文案、状态与控件。
 * @returns 字段行元素。
 */
export function FieldFrame(props: FieldFrameProps) {
  const note = props.invalid ? props.invalidNote ?? props.hint : props.hint
  const hasNote = note !== undefined && note !== null && note !== ''
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        <FieldBadges
          status={props.status ?? null}
          pending={props.pending}
          resettable={props.resettable}
          pendingLabel={props.pendingLabel}
          resetLabel={props.resetLabel}
          disabled={props.disabled}
          onReset={props.onReset}
        />
      </div>
      {props.children}
      {hasNote ? <p className={props.invalid ? css.invalid : css.hint}>{note}</p> : null}
    </div>
  )
}

/** 文本 / 数字输入。numeric 只提示数字键盘，不改变接受范围。 */
export interface TextControlProps {
  id: string
  text: string
  /** 用 inputMode 的 numeric 值提示键盘；控件始终是 type 为 text。 */
  numeric: boolean
  invalid: boolean
  disabled: boolean
  /** 失焦回调；阈值字段用它触发成对校验。 */
  onBlur?: () => void
  onEdit: (text: string) => void
}

/**
 * 渲染单行文本框。
 * @param props - 草稿文本与编辑回调。
 * @returns 输入框元素。
 */
export function TextControl(props: TextControlProps) {
  return (
    <input
      id={props.id}
      className={props.invalid ? css.inputInvalid : css.input}
      type="text"
      {...props.numeric ? { inputMode: 'numeric' as const } : {}}
      {...props.invalid ? { 'aria-invalid': true } : {}}
      value={props.text}
      disabled={props.disabled}
      onBlur={props.onBlur}
      onChange={(event) => { props.onEdit(event.target.value) }}
    />
  )
}

/**
 * 只读输入：字段照常渲染，但不可编辑，**框内不写任何文字**。
 *
 * 不从「隐藏字段」也不从「换一块只读文本」走：仍是真输入框，与官方凭据字段同一形态。
 * **只给 `readOnly`，不给 `disabled`** —— 官方「网页搜索」卡片里配好的密钥就是一个常态空框
 * （不降透明度），置灰只属于整份设置不可写的那种情况。
 * 只读的因由由标签行右侧的状态徽章与它下方的说明行承担，那两处的措辞来自词典。
 *
 * **为什么没有 placeholder**：灰字写在框里读起来像「这里该填但没填」。
 * **交互一律不响应**：它看着像输入框，但悬停不换描边、指针不是插入符、点了也没有焦点环
 * （`inputStatic` 那条规则，含 `pointer-events: none`）—— 看着像能编辑才是错的。
 */
export interface ReadOnlyControlProps {
  id: string
}

/**
 * 渲染只读输入。
 * @param props - 控件 id。
 * @returns 输入框元素。
 */
export function ReadOnlyControl(props: ReadOnlyControlProps) {
  return (
    <input
      id={props.id}
      className={clsx(css.input, css.inputStatic)}
      type="text"
      value=""
      readOnly
    />
  )
}

/** 二级折叠：卡片里的「自定义设置」。 */
export interface DetailsGroupProps {
  title: string
  /** 初始展开状态；省略即收起。 */
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * 渲染一个原生 details 折叠块。
 *
 * **受控但跟手**：`open` 由 state 持有，用户拨动时从 DOM 读回真实状态，
 * 所以卡片每次重渲染（每敲一个字都会）不会把用户展开的块弹回去。
 * @param props - 标题、初始状态与内容。
 * @returns 折叠块元素。
 */
export function DetailsGroup(props: DetailsGroupProps) {
  const [open, setOpen] = useState(props.defaultOpen === true)
  return (
    <details
      className={css.details}
      open={open}
      onToggle={(event) => { setOpen(event.currentTarget.open) }}
    >
      <summary className={css.detailsSummary}>{props.title}</summary>
      <div className={css.detailsBody}>{props.children}</div>
    </details>
  )
}

/** 选择器的一个选项。 */
export interface SelectorOption {
  readonly id: string
  readonly label: string
}

/** 整行选择器：自绘 pill 触发按钮 + 原语 Menu 弹层。 */
export interface SelectorControlProps {
  /** 触发按钮的 id，供行容器或测试锚点定位。 */
  id: string
  /** 触发按钮的可访问名，也是弹层的 aria-label。 */
  label: string
  options: readonly SelectorOption[]
  selectedId: string
  disabled: boolean
  onSelect: (id: string) => void
}

/**
 * 渲染原生形态的整行选择器。
 * 官方设置页的「整行选择型」都是这一套：pill 按钮带 aria-haspopup，弹层由 Menu 自绘并 portal 出去。
 * 弹层本身（圆角、高程、勾选、键盘、外部点击关闭）全由 Menu 负责，这里只管触发器的外观。
 * @param props - 当前选中项、可选项与回调。
 * @returns 选择器元素。
 */
export function SelectorControl(props: SelectorControlProps) {
  const [open, setOpen] = useState(false)
  const selected = props.options.find(option => option.id === props.selectedId)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={props.options.map(option => ({ id: option.id, label: option.label }))}
      selectedId={props.selectedId}
      onSelect={(id) => {
        props.onSelect(id)
        setOpen(false)
      }}
      align="end"
      portal
      // 根 span 是整行里的 flex 项，给它不收缩的类，pill 才不会被左槽挤压。
      className={css.selectorAnchor}
      anchor={(
        <button
          id={props.id}
          type="button"
          className={css.selector}
          aria-label={props.label}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={props.disabled}
          onClick={() => { setOpen(value => !value) }}
        >
          {selected?.label ?? ''}
          <IconChevronDownOutlineRegular className={css.selectorChevron} />
        </button>
      )}
    />
  )
}

/** 动作行与它的结果行。 */
export interface ActionRowProps {
  label: string
  disabled: boolean
  /** 结果文案；无结果时为 null，此时不渲染结果行。 */
  result: { readonly ok: boolean; readonly text: string } | null
  onClick: () => void
}

/**
 * 渲染一个动作按钮与它的状态结果行。
 * @param props - 按钮文案、禁用态、结果与回调。
 * @returns 动作行元素。
 */
export function ActionRow(props: ActionRowProps) {
  return (
    <>
      <div className={css.actions}>
        <button
          type="button"
          className={css.actionButton}
          disabled={props.disabled}
          onClick={props.onClick}
        >
          {props.label}
        </button>
      </div>
      {props.result === null
        ? null
        : (
          // 成功只是通报，用 polite 的 status；失败需要用户处理，按 06 §6.7 的「行内错误」用 alert。
          <p
            className={props.result.ok ? css.resultOk : css.resultFail}
            role={props.result.ok ? 'status' : 'alert'}
          >
            {props.result.text}
          </p>
        )}
    </>
  )
}

/**
 * 状态圆环：条目在展开态与折叠态共用的唯一图标。
 *
 * 几何逐条照抄官方 ContextMeter：viewBox 14×14、r=5.5、stroke-width 2、
 * 用 strokeDasharray 而不是 stroke-dashoffset，起点靠 rotate(-90 7 7) 挪到 12 点。
 * 环恒为满环 —— 它只表达状态，不表达比例。环上唯一可用的比例是「赠送 / 总额」，
 * 那会被读成剩余额度，属于没有诚实语义的仪表，所以不画。
 * 颜色按 state 机械映射，取值与原生 StateDot 的 data-state 一一对应。
 * 账户不可用（unavailable）在这条弧上再加一个中心叉号：颜色只有四个色相可用，
 * 形状负责把「账户维度不可用」与「余额维度告急」分开。
 * @module dsh-ds-balance/client/sidebar/PercentRing
 */

import type { RingMarker } from '../model.ts'
import css from './PercentRing.module.css'

/** viewBox 边长，与官方 ContextMeter 一致。 */
const VIEW = 14

/** 描边宽度。 */
const STROKE = 2

/** 半径：外径 13 落在 14 的 viewBox 里，四周各留 0.5。 */
const RADIUS = (VIEW - STROKE) / 2

/** 圆心。 */
const CENTER = VIEW / 2

/** 周长。满环时 dasharray 的两个值都取它。 */
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * 中心叉号的半臂长（viewBox 单位）。
 *
 * 环内径 = 2 × RADIUS − STROKE = 10，取它的 50% 作为整条对角线长度 → 半臂 ≈ 1.8。
 * 用 viewBox 单位写，所以符号跟着环一起缩放，12px 下仍清晰。
 */
const CROSS_ARM = 1.8

/** 圆环能表达的状态；取值域与原生 StateDot 对齐，本插件用不到 ongoing。 */
export type RingState = 'done' | 'warning' | 'error' | 'idle'

/** 圆环属性。 */
export interface PercentRingProps {
  /** 状态，决定环的颜色；语义与原生 StateDot 的同一套枚举一致。 */
  state: RingState
  /** 中心符号；`null` 或省略时不画。 */
  marker?: RingMarker | null
  /** 渲染边长（px），默认 18。 */
  size?: number
  /** 可选的原生悬停提示，由 SVG 的 <title> 子元素承载。 */
  title?: string
}

/**
 * 渲染状态圆环。
 * @param props - 状态、边长与可选提示。
 * @returns 圆环 svg；自身 aria-hidden，语义名由调用方的 aria-label 提供。
 */
export function PercentRing({ state, marker = null, size = 18, title }: PercentRingProps): JSX.Element {
  return (
    <svg
      className={css.ring}
      data-state={state}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {/* <title> 是 SVG 的原生悬停提示；aria-hidden 只影响无障碍树，不影响它。 */}
      {title === undefined ? null : <title>{title}</title>}
      <circle className={css.track} cx={CENTER} cy={CENTER} r={RADIUS} />
      {/* 满环 = 比例恒为 1 的那一档。保留 dasharray 与 rotate，接缝才会落在 12 点而不是 3 点。 */}
      <circle
        className={css.fill}
        cx={CENTER}
        cy={CENTER}
        r={RADIUS}
        strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
        transform={`rotate(-90 ${CENTER} ${CENTER})`}
      />
      {/* 中心叉号：两条对角短线，颜色跟弧走（currentColor）。没有动画。 */}
      {marker === 'cross'
        ? (
          <g className={css.cross}>
            <line
              x1={CENTER - CROSS_ARM}
              y1={CENTER - CROSS_ARM}
              x2={CENTER + CROSS_ARM}
              y2={CENTER + CROSS_ARM}
            />
            <line
              x1={CENTER + CROSS_ARM}
              y1={CENTER - CROSS_ARM}
              x2={CENTER - CROSS_ARM}
              y2={CENTER + CROSS_ARM}
            />
          </g>
        )
        : null}
    </svg>
  )
}

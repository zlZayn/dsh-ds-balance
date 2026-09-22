/**
 * 状态圆环：条目在展开态与折叠态共用的唯一图标。
 *
 * 几何分两处照官方，**不是整份照抄同一个文件**：
 * - **网格与笔画**照左栏那批图标 —— viewBox 16×16、笔画 1（宿主
 *   `ui-primitives/src/icons/index.tsx` 的 `ICON_REGULAR_STROKE`；每个 `Icon*Artwork` 都是
 *   `viewBox="0 0 16 16"`）。这样它与侧栏里任何一个字形共用同一套度量，
 *   并排时轻重一致；旧写法是 14 格 / 笔画 2，比邻居粗一倍多。
 * - **弧的读法**照官方 `ContextMeter`：用 strokeDasharray 而不是 stroke-dashoffset，
 *   起点靠 `rotate(-90 <center> <center>)` 挪到 12 点。
 *
 * 两件事分开编码：
 * - **弧长**表达比例：余额占该币种 warn 阈值的几分之几，由 `model.ts` 的 `ringRatioOf` 算好传进来。
 *   阈值是用户自己设的刻度，所以不必再定义「满」是多少；本组件不做任何金额判断。
 * - **颜色**按 state 机械映射，取值与原生 StateDot 的 data-state 一一对应，来源只有 `severity`。
 * 账户不可用（unavailable）在这条弧上再加一个中心叉号：颜色只有四个色相可用，
 * 形状负责把「账户维度不可用」与「余额维度告急」分开。
 * @module dsh-ds-balance/client/sidebar/PercentRing
 */

import type { RingMarker } from '../model.ts'
import css from './PercentRing.module.css'

/** viewBox 边长，与官方 `Icon*Artwork` 的网格一致。 */
const VIEW = 16

/**
 * 描边宽度，取官方 `ICON_REGULAR_STROKE` —— 宿主 `ui-primitives/src/icons/index.tsx:21`
 * 的 `ICON_REGULAR_STROKE = 1`（viewBox 单位）。
 *
 * 注释里带出处是**故意的**：svg 上的 `stroke-width` 由 CSS（`PercentRing.module.css`）写，
 * 组件这两条常量只决定几何，所以「笔画有没有跟丢官方」只能靠
 * [test/redlines.test.ts](../../../test/redlines.test.ts) 拿它对账。
 */
const STROKE = 1

/**
 * 圆本身在网格里四周各留多少（不含笔画）。
 *
 * 取 1 是照官方 `ContextMeter` 的比例反推出来的：它 `viewBox 14` / `RADIUS 5.5` / `stroke 2`
 * ⇒ 圆留 0.5、**墨迹外径 13 落在 14 的格里**（四周各留 0.5）。本仓换成 16 的格子、
 * 笔画 1，同一套「留白 = 半径之外那一圈」的算下来：
 * 墨迹外径 = 2 × RADIUS + STROKE = 14，四周各留 1 —— 与官方字形实测的 12–13.75 同一档。
 */
const RING_INSET = 1

/**
 * 半径。
 *
 * 与官方 `ContextMeter` **同一个公式**（`RADIUS = 边长/2 − 圆留白 − 笔画/2`，那边算出来是 5.5），
 * 所以环在格子里的大小关系与它逐值同构；渲染 16px 时笔画 1.000px、墨迹外径 14.0px。
 */
const RADIUS = VIEW / 2 - RING_INSET - STROKE / 2

/** 圆心。 */
const CENTER = VIEW / 2

/** 周长。满环时 dasharray 的两个值都取它。 */
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * 中心叉号的半臂长（viewBox 单位）。
 *
 * 环内径取 50% 作整条对角线，半臂 = 内径 / 2 / √2。内径 = 2 × RADIUS − STROKE = 12，
 * 于是对角线长 6、半臂 ≈ 2.121。用 viewBox 单位写，所以符号跟着环一起缩放，12px 下仍清晰。
 * 写成由 RADIUS 与 STROKE 推出来（而不是写死 2.121）：环的几何一改，叉号跟着走。
 */
const CROSS_ARM = (2 * RADIUS - STROKE) / 2 / Math.SQRT2

/**
 * 保留三位小数。
 * viewBox 单位下 0.001 远小于一个像素，写全精度只是让 DOM 难读。
 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** 圆环能表达的状态；取值域与原生 StateDot 对齐，本插件用不到 ongoing。 */
export type RingState = 'done' | 'warning' | 'error' | 'idle'

/** 圆环属性。 */
export interface PercentRingProps {
  /** 状态，决定环的颜色；语义与原生 StateDot 的同一套枚举一致。 */
  state: RingState
  /** 中心符号；`null` 或省略时不画。 */
  marker?: RingMarker | null
  /** 弧长比例 0~1；省略即满环。越界与非数都夹回 [0, 1]。 */
  ratio?: number
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
export function PercentRing({ state, marker = null, ratio = 1, size = 18, title }: PercentRingProps): JSX.Element {
  const clamped = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 1
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
      {/* dash 取弧长、gap 取整周长，于是只画出一条弧；rotate 让接缝落在 12 点而不是 3 点
          （中心跟着 VIEW 走，16 格时是 rotate(-90 8 8)）。
          比例为 0 时整条弧不画：dash 长度为 0 配上圆头线帽会在 12 点留下一个点。 */}
      {clamped === 0 ? null : (
        <circle
          className={css.fill}
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          strokeDasharray={`${round3(CIRCUMFERENCE * clamped)} ${round3(CIRCUMFERENCE)}`}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
        />
      )}
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

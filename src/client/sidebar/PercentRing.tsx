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
 * 中心记号用**形状**补颜色表达不了的那两件事，两者几何同源、只差朝向：
 * - `cross`（斜交 45°）：账号维度读不到 —— 否定；
 * - `plus`（正交 0°/90°）：没有接入凭据，需要用户去配置 —— 肯定／添加。
 * 颜色只有四个色相可用，形状负责把「读不到」「待配置」「余额告急」三者分开。
 * @module dsh-ds-balance/client/sidebar/PercentRing
 */

import type { DotState, RingMarker } from '../model.ts'
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
 * 内半径：环内缘到圆心的距离（不含笔画）。内径 = 2 × 它 = 12。
 */
const INNER_RADIUS = RADIUS - STROKE / 2

/**
 * 中心记号的半臂长（viewBox 单位）。
 *
 * **两个记号共用这一个常量**，这是「两者同大」的唯一实现方式。
 * 口径：整条对角线取**内径的 50%**，于是半臂 = 内径 / 2 / √2 = 内半径 / 2 / √2 ≈ 2.1213。
 * 用 viewBox 单位写，符号跟着环一起缩放。
 *
 * **写成由 RADIUS 与 STROKE 推出来的表达式**（而不是写死 2.1213）：环的几何一改，记号跟着走。
 * 历史上这里漂过 2 倍 —— 注释写着「内径」而表达式写的是 `2 * RADIUS - STROKE`（= 内径而不是
 * 内半径），于是「约内径一半」变成了「端点顶到内壁」。守它的是
 * [test/redlines.test.ts](../../../test/redlines.test.ts) 的「圆环几何」一组：
 * 那条断言会**求值源码里的这个表达式**再与「内径 50%」比对，注释与实现再也漂不开。
 */
const MARK_ARM = INNER_RADIUS / 2 / Math.SQRT2

/**
 * 保留三位小数。
 * viewBox 单位下 0.001 远小于一个像素，写全精度只是让 DOM 难读。
 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * 转弧的长度（占圆周的比例）：**照官方 StateDot 的 `ongoing`**。
 *
 * 官方那条弧的 `stroke-dasharray: 12 150`，配 `r = 9.5`（周长 2π×9.5 ≈ 59.69）——
 * 弧长占圆周 12 / 59.69 ≈ 0.2010。本组件半径不同（6.5，周长 40.84），
 * 但**取同一个比例**，这样两者在各自网格里看起来一样长。
 *
 * 比例写在这里而不是写一个「我们自己算出来的弧长」：官方改刻度时这里能跟着对齐，
 * 红线会去核官方那份 CSS 的实际数值。
 */
const SPIN_ARC_RATIO = 12 / (2 * Math.PI * 9.5)

/** 转弧的 dasharray：弧长 + 整周长（gap 取周长 ⇒ 只画一条弧）。 */
const SPIN_ARC = round3(CIRCUMFERENCE * SPIN_ARC_RATIO)

/**
 * 圆环能表达的状态。
 *
 * **是 `DotState` 的别名，不是另抄一份**：抄一份的代价是两处各自增删取值都能编译通过，
 * 而 CSS 的 `data-state` 规则只认其中一个 —— 那时会出现「组件传了一个没有对应规则的值」，
 * 颜色静默回落到基色。取值域与原生 StateDot 的 `data-state` 逐值对齐（含 `ongoing`）。
 */
export type RingState = DotState

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
export function PercentRing({
  state,
  marker = null,
  ratio = 1,
  size = 18,
  title,
}: PercentRingProps): JSX.Element {
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
      {/* 轨道永远画、且**永不参与动画**：它是「这一格有个环」的底，
          转起来的是上面那条弧（见下）。 */}
      <circle className={css.track} cx={CENTER} cy={CENTER} r={RADIUS} />
      {/* 进行中：一条**不完整**的弧绕圆心转。
          为什么必须不完整：圆是对称的，整圈转等于没转 —— 只有缺口在动才看得出来。
          rotate(-90) 只定相位（接缝落在 12 点，与其余弧同源），转的是外层 <g>；
          两者分属不同元素，所以减动效停掉 <g> 的动画时，这条弧仍停在 12 点。
          弧共用 `css.fill`（同色、同宽、同圆头），只多一层旋转 —— 不新增 stroke-width。 */}
      {state === 'ongoing' ? (
        <g className={css.spin}>
          <circle
            className={css.fill}
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            strokeDasharray={`${SPIN_ARC} ${round3(CIRCUMFERENCE)}`}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
          />
        </g>
      ) : /* dash 取弧长、gap 取整周长，于是只画出一条弧；rotate 让接缝落在 12 点而不是 3 点
             （中心跟着 VIEW 走，16 格时是 rotate(-90 8 8)）。
             比例为 0 时整条弧不画：dash 长度为 0 配上圆头线帽会在 12 点留下一个点。 */
      clamped === 0 ? null : (
        <circle
          className={css.fill}
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          strokeDasharray={`${round3(CIRCUMFERENCE * clamped)} ${round3(CIRCUMFERENCE)}`}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
        />
      )}
      {/* 中心记号：两条短线，颜色跟弧走（currentColor）。没有动画。
          两条分支取自**同一个 MARK_ARM**，所以两者外接框逐值相等（4.2426 见方）——
          「同大」就是这么保证的，不是靠两处各写一个数。
          墨量不同是几何必然：叉的每一笔走对角线，比正交的 ＋ 长 √2 倍；
          视觉轻重由「笔画宽度 + 外接框」决定，两者都相同。
          两者的 <g> 共用 css.marker 一个类（同宽、同圆头、同无填充），
          少一个类就少一处 stroke-width，红线「笔画条数」那条也就少一份对账。 */}
      {marker === null ? null : (
        <g className={css.marker}>
          {marker === 'cross' ? (
            <>
              <line
                x1={CENTER - MARK_ARM}
                y1={CENTER - MARK_ARM}
                x2={CENTER + MARK_ARM}
                y2={CENTER + MARK_ARM}
              />
              <line
                x1={CENTER + MARK_ARM}
                y1={CENTER - MARK_ARM}
                x2={CENTER - MARK_ARM}
                y2={CENTER + MARK_ARM}
              />
            </>
          ) : (
            <>
              <line x1={CENTER} y1={CENTER - MARK_ARM} x2={CENTER} y2={CENTER + MARK_ARM} />
              <line x1={CENTER - MARK_ARM} y1={CENTER} x2={CENTER + MARK_ARM} y2={CENTER} />
            </>
          )}
        </g>
      )}
    </svg>
  )
}

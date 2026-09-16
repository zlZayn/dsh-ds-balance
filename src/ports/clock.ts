/**
 * 时钟端口。时间必须可注入，测试里不许依赖真实时钟。
 * @module dsh-ds-balance/ports/clock
 */

/** 时间来源。 */
export interface Clock {
  /** 当前时刻（毫秒）。 */
  now(): number
  /** 账本使用的时区。 */
  timezone(): 'Asia/Shanghai'
}

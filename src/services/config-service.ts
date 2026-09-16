/**
 * 配置读取。
 *
 * 薄封装：把设置作用域包成「现读 + 订阅」两件事，并给出派生值（阈值、超时）。
 * **不缓存** —— 用户改设置要立刻生效。
 * @module dsh-ds-balance/services/config-service
 */

import type { Currency, ThresholdPair } from '../domain/balance.js'
import { thresholdsOf } from '../domain/severity.js'
import { resolveTimeoutMs, type Config } from '../config.js'

/** 配置来源。生产里包 `ctx.settings` 的 scope，测试里给替身。 */
export interface ConfigSource {
  /** 现读当前解析值。 */
  get(): Config
  /** 订阅变更，返回退订函数。 */
  watch(listener: (next: Config, previous: Config) => void): () => void
}

/** 构造参数。 */
export interface ConfigServiceOptions {
  source: ConfigSource
  /** 环境变量表；默认 `process.env`。超时**每次现读**，改完立刻生效。 */
  env?: Record<string, string | undefined>
}

/** 配置读取与派生值。 */
export class ConfigService {
  private readonly source: ConfigSource
  private readonly env: Record<string, string | undefined>

  constructor(options: ConfigServiceOptions) {
    this.source = options.source
    this.env = options.env ?? process.env
  }

  /** 现读整份配置。 */
  current(): Config {
    return this.source.get()
  }

  /** 订阅配置变更。 */
  watch(listener: (next: Config, previous: Config) => void): () => void {
    return this.source.watch(listener)
  }

  /** 当前生效的阈值表（按币种）。 */
  thresholds(): Record<Currency, ThresholdPair> {
    return thresholdsOf(this.current())
  }

  /** 当前生效的上游超时（毫秒）。**每次现读环境变量。** */
  timeoutMs(): number {
    return resolveTimeoutMs(this.env)
  }

  /** 当前展示币种偏好。 */
  displayCurrency(): string {
    return this.current().displayCurrency
  }
}

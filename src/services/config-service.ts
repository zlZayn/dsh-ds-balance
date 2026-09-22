/**
 * 配置读取。
 *
 * 薄封装：把配置来源包成「现读 + 订阅」两件事，并给出派生值（阈值、超时）。
 * **不缓存** —— 用户改设置要立刻生效。
 *
 * 端口形状与 0.1.6 时逐字相同，所以本文件在设置接缝迁移里**一行都没改**：
 * 变的只是装配点（`src/index.ts` 收到的是 Loader 的 `Volatile` 引用面，
 * 写回走 `ctx.settings.mutate`）。这正是分层的收益。
 * @module dsh-ds-balance/services/config-service
 */

import type { Currency, ThresholdPair } from '../domain/balance.js'
import { ValidationError } from '../domain/errors.js'
import { thresholdsOf } from '../domain/severity.js'
import { resolveTimeoutMs, type Config } from '../config.js'

/** 配置来源。生产里是 Loader 引用面 + `ctx.settings.mutate`，测试里给替身。 */
export interface ConfigSource {
  /** 现读当前解析值。 */
  get(): Config
  /** 订阅变更，返回退订函数。 */
  watch(listener: (next: Config, previous: Config) => void): () => void
  /**
   * 把补丁合并进用户层并持久化。
   *
   * 可选：装配里可能没有设置服务，此时配置只读。**宿主拒绝写入会 reject**，
   * 调用方要把它翻成 `422`。
   *
   * 跨字段约束**不在这一层**：宿主侧已经没有钩子，写入侧的先行校验在
   * `src/http/handlers.ts`（它比别处多一层我们的代码），消费侧的兜底在
   * `src/config.ts` 的 `resolveThresholdPairs`。
   */
  update?(patch: Record<string, unknown>): Promise<void>
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

  /**
   * 写回一份配置补丁。
   * @param patch - 字段子集；键必须已被调用方过滤过。
   * @throws {ValidationError} 配置源只读，或 schema 拒绝了这份补丁。
   */
  async update(patch: Record<string, unknown>): Promise<void> {
    const update = this.source.update
    if (update === undefined) throw new ValidationError('configuration store is not writable')
    await update(patch)
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

/**
 * 控制台日志。
 *
 * 宿主半边**没有统一的 logger 服务**，所以直接落 `console`。
 * 字段对象原样序列化，因此**调用方不许把凭据传进来** ——
 * 这是 `services/` 与 `adapters/` 共同的规则。
 * @module dsh-ds-balance/adapters/console-logger
 */

import type { Logger } from '../ports/logger.js'

/** 每条日志的前缀，便于在宿主输出里筛。 */
export const LOG_PREFIX = '[ds-balance]'

/** 日志落点。测试注入替身，生产用全局 `console`。 */
export interface ConsoleLike {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** 把字段对象序列化；序列化不了就退回占位串，绝不因为日志把流程打断。 */
function render(fields: Record<string, unknown> | undefined): string {
  if (fields === undefined) return ''
  try {
    return ' ' + JSON.stringify(fields)
  } catch {
    return ' [unserializable fields]'
  }
}

/**
 * 造一个落 `console` 的日志器。
 * @param sink - 落点；默认全局 `console`。
 * @returns 端口实现。
 */
export function createConsoleLogger(sink: ConsoleLike = console): Logger {
  return {
    debug: (message, fields) => { sink.debug(`${LOG_PREFIX} ${message}${render(fields)}`) },
    info: (message, fields) => { sink.info(`${LOG_PREFIX} ${message}${render(fields)}`) },
    warn: (message, fields) => { sink.warn(`${LOG_PREFIX} ${message}${render(fields)}`) },
    error: (message, fields) => { sink.error(`${LOG_PREFIX} ${message}${render(fields)}`) },
  }
}

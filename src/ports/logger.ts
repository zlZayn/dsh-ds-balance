/**
 * 日志端口。字段化的结构化日志，便于机器筛。
 * @module dsh-ds-balance/ports/logger
 */

/** 结构化日志。 */
export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
}

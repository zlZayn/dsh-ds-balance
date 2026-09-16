/**
 * 版本常量。
 *
 * `PLUGIN_VERSION` 必须与 `package.json` 的 `version` 逐字一致 —— 由
 * `test/version.test.ts` 兜底。抄成两份必然漂，所以让它可校验。
 * @module dsh-ds-balance/version
 */

/** 线上 schema 版本。响应里逐条回传，消费方据此判断兼容性。 */
export const SCHEMA_VERSION = 1

/** 插件版本。与 `package.json` 的 `version` 一致（有测试兜底）。 */
export const PLUGIN_VERSION = '0.0.1'

/**
 * 服务端盐的读写。
 *
 * `accountTag` 由它派生，所以**它丢了账本就会孤立**：见 docs/backend-architecture.md §19 第 5 条。
 * 文件权限 0600；路径由组装点用 `@deepseek-ai/dsh-home-paths` 的 `dshHomePath()` 拼出来。
 * @module dsh-ds-balance/adapters/salt-file
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** 盐的字节数与编码。 */
export const SALT_BYTES = 32
export const SALT_ENCODING = 'hex' as const

/** 构造参数。 */
export interface SaltFileOptions {
  /** 盐文件绝对路径。 */
  path: string
  /** 注入随机源，测试用。 */
  random?: (bytes: number) => string
  /** 注入读，测试用。 */
  read?: (path: string) => Promise<string>
  /** 注入写，测试用。 */
  write?: (path: string, data: string, mode: number) => Promise<void>
  /** 注入建目录，测试用。 */
  makeDir?: (path: string) => Promise<void>
}

/**
 * 读取盐；不存在则生成并落盘。
 *
 * 空文件与空白内容视为缺失（与 `$DSH_HOME` 的空白处理保持一致）。
 * @param options - 路径与可注入依赖。
 * @returns 十六进制盐字符串。
 */
export async function loadOrCreateSalt(options: SaltFileOptions): Promise<string> {
  const read = options.read ?? (async (path: string) => readFile(path, 'utf8'))
  const write = options.write ?? (async (path: string, data: string, mode: number) => writeFile(path, data, { mode }))
  const makeDir = options.makeDir ?? (async (path: string) => { await mkdir(path, { recursive: true }) })
  const random = options.random ?? ((bytes: number) => randomBytes(bytes).toString(SALT_ENCODING))

  try {
    const existing = (await read(options.path)).trim()
    if (existing !== '') return existing
  } catch {
    // 不存在或读不动：落到生成分支。
  }

  const created = random(SALT_BYTES)
  await makeDir(dirname(options.path))
  // 0600：只有本用户可读写。
  await write(options.path, created, 0o600)
  return created
}

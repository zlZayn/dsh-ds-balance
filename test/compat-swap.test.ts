import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/**
 * 换版脚本的形状守卫。
 *
 * 为什么值得单独一条：`swap` 会改 `package.json` 的声明区间，而它曾经无条件写回
 * `'^' + version` —— 那样本仓统一写着的 `>=0.1.7-alpha.1` 会被**每周的 compat 巡检**
 * 静默改回 `^`，形状与 `engines.dsh` 漂开，还留下一条没人看懂来源的 diff。
 * 这类错误一年只发作几十次、每次都要人去认，所以把它变成可执行的断言。
 *
 * 断言方式是跑脚本自己的 `selftest` 子命令（形状表在脚本里，与生产代码同一份实现），
 * 而不是在测试里重写一遍规则 —— 重写的那份迟早与实现漂开。
 */
describe('compat-swap 换版保形', () => {
  it('认识的形状保留运算符，不认识的形状报错停下', () => {
    // 不装依赖、不打网络：selftest 只跑本地那张形状表。
    const result = spawnSync(process.execPath, ['scripts/compat-swap.mjs', 'selftest'], { encoding: 'utf8' })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain('条全部符合预期')
  })

  it('用法里列了 selftest 这条子命令', () => {
    const result = spawnSync(process.execPath, ['scripts/compat-swap.mjs', '--help'], { encoding: 'utf8' })
    expect(result.stderr + result.stdout).toContain('selftest')
  })
})

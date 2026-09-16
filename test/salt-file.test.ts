import { describe, expect, it, vi } from 'vitest'
import { SALT_BYTES, loadOrCreateSalt } from '../src/adapters/salt-file.ts'

const PATH = '/tmp/x/.salt'

describe('loadOrCreateSalt', () => {
  it('已有非空盐时直接返回，不写盘', async () => {
    const write = vi.fn()
    const salt = await loadOrCreateSalt({
      path: PATH,
      read: async () => 'existing-salt\n',
      write,
    })
    expect(salt).toBe('existing-salt')
    expect(write).not.toHaveBeenCalled()
  })

  it('文件不存在时生成并落盘', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const makeDir = vi.fn().mockResolvedValue(undefined)
    const salt = await loadOrCreateSalt({
      path: PATH,
      read: async () => { throw new Error('ENOENT') },
      write,
      makeDir,
      random: () => 'a'.repeat(SALT_BYTES * 2),
    })
    expect(salt).toHaveLength(SALT_BYTES * 2)
    expect(makeDir).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('落盘权限是 0600', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    await loadOrCreateSalt({ path: PATH, read: async () => '', write, makeDir: async () => {}, random: () => 'ff' })
    expect(write.mock.calls[0]![2]).toBe(0o600)
  })

  it('空白内容视为缺失', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const salt = await loadOrCreateSalt({
      path: PATH, read: async () => '   \n  ', write, makeDir: async () => {}, random: () => 'beef',
    })
    expect(salt).toBe('beef')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('把盐写到给定路径', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    await loadOrCreateSalt({ path: PATH, read: async () => '', write, makeDir: async () => {}, random: () => 'ab' })
    expect(write.mock.calls[0]![0]).toBe(PATH)
  })

  it('两次生成得到同一个盐（幂等）', async () => {
    let stored = ''
    const deps = {
      path: PATH,
      read: async () => stored,
      write: async (_path: string, data: string) => { stored = data },
      makeDir: async () => {},
      random: () => 'c0ffee',
    }
    const first = await loadOrCreateSalt(deps)
    const second = await loadOrCreateSalt(deps)
    expect(second).toBe(first)
  })
})

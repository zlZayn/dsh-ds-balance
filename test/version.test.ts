import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PLUGIN_VERSION, SCHEMA_VERSION } from '../src/version.ts'

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

describe('版本常量', () => {
  it('PLUGIN_VERSION 与 package.json 逐字一致（抄两份必漂，所以断言它）', () => {
    expect(PLUGIN_VERSION).toBe(pkg.version)
  })

  it('schema 版本是正整数', () => {
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true)
    expect(SCHEMA_VERSION).toBeGreaterThan(0)
  })
})

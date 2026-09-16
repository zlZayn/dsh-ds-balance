/**
 * 配置表单的暂存与保存状态机。
 * 编辑只落在本地草稿，保存是草稿变成设置的唯一出口。
 * 快照三元组语义与官方 card-form 一致：value 是生效值，user 是用户覆盖层，键存在即「已覆盖」。
 * @module dsh-ds-balance/client/settings/use-config-form
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

/** 作用域快照。真实 ctx.settingsScope 的快照还带 status/base/revision/mode，这里只取需要的三片。 */
export interface SettingsScopeSnapshotLike {
  /** 合并后的生效配置。 */
  value: Record<string, unknown>
  /** 用户覆盖层；键是否存在就是「已覆盖」的判据。 */
  user: Record<string, unknown>
  /** 宿主文档是否接受写入。 */
  writable: boolean
}

/**
 * 配置卡片依赖的最小作用域面。
 * 真实的 ctx.settingsScope.bind() 返回值结构上满足它，但 set/unset 返回 Promise，父代理的适配层可以原样透传。
 */
export interface SettingsScope {
  /** 读当前快照。 */
  getSnapshot(): SettingsScopeSnapshotLike
  /** 订阅快照变化。 */
  subscribe(listener: () => void): () => void
  /** 写入一个字段。 */
  set(field: string, value: unknown): void
  /** 清除一个字段的用户覆盖。 */
  unset(field: string): void
}

/** 一次字段写入。 */
export type FieldWrite =
  | { readonly kind: 'set'; readonly value: unknown }
  | { readonly kind: 'clear' }

/** 字段控件类型。 */
export type FieldKind = 'text' | 'secret' | 'number' | 'select'

/** 文本类字段规格。 */
export interface TextFieldSpec {
  readonly field: string
  readonly kind: 'text' | 'secret' | 'number'
  /** 把生效值渲染成草稿文本。 */
  format(value: unknown): string
  /** 把草稿文本解析成写入；返回 undefined 表示这份草稿非法并阻止保存。 */
  parse(text: string): FieldWrite | undefined
}

/** 值类字段规格（下拉这类不经过文本草稿的控件）。 */
export interface ValueFieldSpec {
  readonly field: string
  readonly kind: 'select'
}

/** 任一字段规格。 */
export type AnyFieldSpec = TextFieldSpec | ValueFieldSpec

/**
 * 判断规格是否文本类。
 * @param spec - 字段规格。
 * @returns 是否文本类。
 */
export function isTextSpec(spec: AnyFieldSpec): spec is TextFieldSpec {
  return spec.kind === 'text' || spec.kind === 'secret' || spec.kind === 'number'
}

/** 自由文本：空串等于清除，与官方 textField 同规则。 */
export function textField(field: string, kind: 'text' | 'secret' = 'text'): TextFieldSpec {
  return {
    field,
    kind,
    format: value => (typeof value === 'string' ? value : ''),
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

/** 数字文本：空串等于清除，非有限数视为非法；上下界由宿主 schema 决定。 */
export function numberField(field: string): TextFieldSpec {
  return {
    field,
    kind: 'number',
    format: value => (typeof value === 'number' && Number.isFinite(value) ? String(value) : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
    },
  }
}

/** 下拉字段。 */
export function selectField(field: string): ValueFieldSpec {
  return { field, kind: 'select' }
}

/** 自动币种取值。 */
export const AUTO_CURRENCY = 'auto'

/** 已知币种。阈值分组就是按这两个币种定义的，故它们是币种列表的最小闭集。 */
export const KNOWN_CURRENCIES: readonly string[] = ['CNY', 'USD']

/**
 * 下拉可选的币种代码。
 * 已知币种打底；传入的取值里若是未知代码也一并保留，避免把用户已存或编辑中的取值弄丢。
 * @param currents - 任意个候选取值，通常同时给草稿值与生效值。
 * @returns 非自动的币种代码列表。
 */
export function currencyCodes(...currents: readonly unknown[]): readonly string[] {
  const codes = new Set<string>(KNOWN_CURRENCIES)
  for (const current of currents) {
    if (typeof current !== 'string') continue
    const trimmed = current.trim().toUpperCase()
    if (trimmed !== '' && trimmed !== AUTO_CURRENCY.toUpperCase()) codes.add(trimmed)
  }
  return [...codes]
}

/** 卡片配置的全部字段，顺序即渲染顺序的参照。 */
export const CONFIG_FIELDS: readonly AnyFieldSpec[] = [
  textField('apiKey', 'secret'),
  textField('apiKeyRef'),
  textField('baseUrl'),
  numberField('serverRefreshSeconds'),
  numberField('clientPollSeconds'),
  numberField('manualRefreshCooldownSeconds'),
  selectField('displayCurrency'),
  numberField('cnyWarn'),
  numberField('cnyCritical'),
  numberField('usdWarn'),
  numberField('usdCritical'),
]

/** 字段名到规格的索引。 */
export const SPEC_BY_FIELD: ReadonlyMap<string, AnyFieldSpec> = new Map(
  CONFIG_FIELDS.map(spec => [spec.field, spec]),
)

/** 一个字段渲染所需的状态。 */
export interface FieldState {
  /** 文本类字段的草稿文本。 */
  readonly text: string
  /** 值类字段的草稿值；文本类字段为 undefined。 */
  readonly value: unknown
  /** 快照里的生效值，与草稿无关。 */
  readonly effective: unknown
  /** 用户层当前就存着这个字段（不看草稿）。状态徽标用它判「已覆盖」。 */
  readonly stored: boolean
  /** 保存后该字段是否会留下用户层条目。 */
  readonly overridden: boolean
  /** 这份草稿是否会产生一次写入。 */
  readonly dirty: boolean
  /** 草稿是否不是该字段接受的值。 */
  readonly invalid: boolean
}

/** 表单整体状态。 */
export interface ConfigFormState {
  /** 宿主文档是否接受写入。 */
  readonly writable: boolean
  /** 是否存在会产生写入的草稿。 */
  readonly dirty: boolean
  /** 是否存在非法草稿；为真时禁止保存。 */
  readonly invalid: boolean
  /** 是否正在跨线写入。 */
  readonly saving: boolean
  /** 上一次保存是否没有落定；下一次编辑或保存会清掉它。 */
  readonly failed: boolean
}

/** 测试连接的状态。 */
export interface TestState {
  /** 是否正在测试。 */
  readonly running: boolean
  /** 结果；未出结果时为 null。 */
  readonly ok: boolean | null
  /** 失败原因；成功或未出结果时为空串。 */
  readonly message: string
}

/** 表单暴露给卡片的面。 */
export interface ConfigFormApi {
  /** 整体状态。 */
  readonly state: ConfigFormState
  /** 读一个字段的渲染状态。 */
  field(field: string): FieldState
  /** 暂存文本类字段的编辑。 */
  edit(field: string, text: string): void
  /** 暂存值类字段的编辑。 */
  setValue(field: string, value: unknown): void
  /** 暂存一次清除，让该字段回到组合层。 */
  resetField(field: string): void
  /** 丢弃全部草稿。 */
  discard(): void
  /** 写入全部草稿，并从快照读回落定结果。 */
  save(): Promise<void>
  /** 测试连接状态。 */
  readonly test: TestState
  /** 跑一次本地模拟的连接测试。 */
  runTest(): void
}

/** 本地模拟的连接测试耗时。 */
export const TEST_LATENCY_MS = 800

/**
 * 判定一次模拟连接测试是否失败。
 * 规则：Base URL 必须以 http:// 或 https:// 开头；API Key 与引用名不能同时为空。
 * 返回的是宿主诊断风格的英文短句，与官方卡片直接展示宿主诊断的做法一致。
 * @param baseUrl - 当前草稿或生效的 Base URL。
 * @param apiKey - 当前草稿或生效的 API Key。
 * @param apiKeyRef - 当前草稿或生效的引用名。
 * @returns 失败原因；可通过时为 null。
 */
export function probeFailure(baseUrl: string, apiKey: string, apiKeyRef: string): string | null {
  const url = baseUrl.trim()
  if (!/^https?:\/\//i.test(url)) return 'base URL must start with http:// or https://'
  if (apiKey.trim() === '' && apiKeyRef.trim() === '') return 'no API key or credential reference configured'
  return null
}

/** 一次待写入的编辑。 */
type StagedEdit =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'clear' }

/** 规范化后的快照。 */
interface NormalizedSnapshot {
  readonly value: Record<string, unknown>
  readonly user: Record<string, unknown>
  readonly writable: boolean
}

/**
 * 收窄成普通对象；非对象一律当空对象，读路径保持全域可读。
 * @param input - 任意快照分片。
 * @returns 普通对象。
 */
function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

/**
 * 浅比较两个普通对象。
 * @param a - 左值。
 * @param b - 右值。
 * @returns 键集与每个键的值都相同。
 */
function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) {
    if (!Object.hasOwn(b, key) || a[key] !== b[key]) return false
  }
  return true
}

/**
 * 等待一次写入落定。
 * 契约里 set/unset 返回 void，真实作用是 Promise，这里两种都接得住。
 * @param outcome - 写入调用的返回值。
 * @returns 落定后的 Promise。
 */
async function settle(outcome: unknown): Promise<void> {
  if (outcome === null || typeof outcome !== 'object') return
  if (typeof (outcome as { then?: unknown }).then !== 'function') return
  await (outcome as PromiseLike<unknown>)
}

/**
 * 判断一次写入是否真的落进了用户层。
 * 真实作用域被宿主拒绝时不会抛错，只会让快照保持不变，所以成功与否必须从快照读回判定。
 * @param snapshot - 写入后的快照。
 * @param field - 字段名。
 * @param write - 这次写入。
 * @returns 快照是否已经反映这次写入。
 */
function landedWrite(snapshot: NormalizedSnapshot, field: string, write: FieldWrite): boolean {
  if (write.kind === 'clear') return !Object.hasOwn(snapshot.user, field)
  return Object.hasOwn(snapshot.user, field) && snapshot.user[field] === write.value
}

/** 计划中的一次写入；write 为 undefined 表示草稿非法。 */
interface PlannedWrite {
  readonly field: string
  readonly write: FieldWrite | undefined
}

/**
 * 把草稿折成写入计划。
 * @param snapshot - 当前快照。
 * @param staged - 当前草稿。
 * @returns 计划条目；空数组表示没有可写的东西。
 */
function planWrites(
  snapshot: NormalizedSnapshot,
  staged: ReadonlyMap<string, StagedEdit>,
): PlannedWrite[] {
  const plan: PlannedWrite[] = []
  for (const [field, edit] of staged) {
    const spec = SPEC_BY_FIELD.get(field)
    if (spec === undefined) continue
    const effective = snapshot.value[field]
    const overridden = Object.hasOwn(snapshot.user, field)
    if (!isTextSpec(spec)) {
      if (edit.kind === 'clear') {
        if (overridden) plan.push({ field, write: { kind: 'clear' } })
        continue
      }
      if (edit.kind === 'value' && edit.value !== effective) {
        plan.push({ field, write: { kind: 'set', value: edit.value } })
      }
      continue
    }
    if (edit.kind === 'clear') {
      if (overridden) plan.push({ field, write: { kind: 'clear' } })
      continue
    }
    if (edit.kind !== 'text') continue
    if (edit.text === spec.format(effective)) continue
    plan.push({ field, write: spec.parse(edit.text) })
  }
  return plan
}

/**
 * 读一个字段的渲染状态。
 * @param snapshot - 当前快照。
 * @param spec - 字段规格。
 * @param edit - 该字段的草稿。
 * @returns 字段状态。
 */
function fieldStateOf(
  snapshot: NormalizedSnapshot,
  spec: AnyFieldSpec,
  edit: StagedEdit | undefined,
): FieldState {
  const effective = snapshot.value[spec.field]
  const stored = Object.hasOwn(snapshot.user, spec.field)
  if (edit === undefined) {
    return isTextSpec(spec)
      ? { text: spec.format(effective), value: undefined, effective, stored, overridden: stored, dirty: false, invalid: false }
      : { text: '', value: effective, effective, stored, overridden: stored, dirty: false, invalid: false }
  }
  if (edit.kind === 'clear') {
    return isTextSpec(spec)
      ? { text: '', value: undefined, effective, stored, overridden: false, dirty: stored, invalid: false }
      : { text: '', value: effective, effective, stored, overridden: false, dirty: stored, invalid: false }
  }
  if (!isTextSpec(spec)) {
    return edit.kind === 'value'
      ? { text: '', value: edit.value, effective, stored, overridden: true, dirty: edit.value !== effective, invalid: false }
      : { text: '', value: effective, effective, stored, overridden: stored, dirty: false, invalid: false }
  }
  if (edit.kind !== 'text') {
    return { text: '', value: undefined, effective, stored, overridden: stored, dirty: false, invalid: false }
  }
  const write = spec.parse(edit.text)
  const dirty = write === undefined
    ? true
    : write.kind === 'clear' ? stored : edit.text !== spec.format(effective)
  return {
    text: edit.text,
    value: undefined,
    effective,
    stored,
    overridden: write !== undefined && write.kind === 'set',
    dirty,
    invalid: write === undefined,
  }
}

/**
 * 绑定一个设置命名空间的配置表单。
 * @param scope - 卡片拿到的设置作用域。
 * @returns 表单状态与动作。
 */
export function useConfigForm(scope: SettingsScope): ConfigFormApi {
  const cacheRef = useRef<{
    value: Record<string, unknown>
    user: Record<string, unknown>
    writable: boolean
    snapshot: NormalizedSnapshot
  } | null>(null)
  const readSnapshot = useCallback((): NormalizedSnapshot => {
    const raw = scope.getSnapshot()
    const value = asRecord(raw.value)
    const user = asRecord(raw.user)
    const writable = raw.writable !== false
    const cache = cacheRef.current
    if (cache !== null
      && cache.writable === writable
      && (cache.value === value || shallowEqual(cache.value, value))
      && (cache.user === user || shallowEqual(cache.user, user))) {
      return cache.snapshot
    }
    const snapshot: NormalizedSnapshot = { value, user, writable }
    cacheRef.current = { value, user, writable, snapshot }
    return snapshot
  }, [scope])

  const subscribe = useCallback(
    (listener: () => void) => scope.subscribe(listener),
    [scope],
  )
  const snapshot = useSyncExternalStore(subscribe, readSnapshot)
  const [staged, setStaged] = useState<ReadonlyMap<string, StagedEdit>>(() => new Map())
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const savingRef = useRef(false)
  const [test, setTest] = useState<TestState>({ running: false, ok: null, message: '' })
  const testTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const testRunningRef = useRef(false)

  useEffect(() => () => {
    if (testTimerRef.current !== null) clearTimeout(testTimerRef.current)
    testTimerRef.current = null
    testRunningRef.current = false
  }, [])

  const plan = useMemo(() => planWrites(snapshot, staged), [snapshot, staged])
  const invalid = plan.some(item => item.write === undefined)

  const stage = useCallback((field: string, edit: StagedEdit | null) => {
    setStaged((current) => {
      const next = new Map(current)
      if (edit === null) next.delete(field)
      else next.set(field, edit)
      return next
    })
    setFailed(false)
    // 草稿一变，上一次的连接测试结论就不再描述当前值：清掉，免得旧结果留在屏幕上。
    if (testTimerRef.current !== null) {
      clearTimeout(testTimerRef.current)
      testTimerRef.current = null
    }
    testRunningRef.current = false
    setTest((current) => (current.running || current.ok !== null
      ? { running: false, ok: null, message: '' }
      : current))
  }, [])

  const edit = useCallback((field: string, text: string) => {
    stage(field, { kind: 'text', text })
  }, [stage])

  const setValue = useCallback((field: string, value: unknown) => {
    stage(field, { kind: 'value', value })
  }, [stage])

  const resetField = useCallback((field: string) => {
    stage(field, { kind: 'clear' })
  }, [stage])

  const discard = useCallback(() => {
    setStaged((current) => (current.size === 0 ? current : new Map()))
    setFailed(false)
    // 弃稿后表单回到生效值，上一次的连接测试结论也不再描述屏幕上的内容。
    if (testTimerRef.current !== null) {
      clearTimeout(testTimerRef.current)
      testTimerRef.current = null
    }
    testRunningRef.current = false
    setTest((current) => (current.running || current.ok !== null
      ? { running: false, ok: null, message: '' }
      : current))
  }, [])

  const save = useCallback(async (): Promise<void> => {
    if (savingRef.current) return
    const current = readSnapshot()
    const writes = planWrites(current, staged)
    if (writes.length === 0) return
    if (writes.some(item => item.write === undefined)) return
    savingRef.current = true
    setSaving(true)
    setFailed(false)
    let landed = true
    for (const item of writes) {
      const write = item.write
      if (write === undefined) { landed = false; break }
      try {
        const outcome: unknown = write.kind === 'clear'
          ? scope.unset(item.field)
          : scope.set(item.field, write.value)
        await settle(outcome)
      } catch {
        landed = false
        break
      }
      if (!landedWrite(readSnapshot(), item.field, write)) { landed = false; break }
    }
    savingRef.current = false
    setSaving(false)
    if (landed) setStaged(new Map())
    setFailed(!landed)
  }, [readSnapshot, scope, staged])

  const runTest = useCallback((): void => {
    if (testRunningRef.current) return
    const current = readSnapshot()
    const draftOf = (field: string): string => {
      const spec = SPEC_BY_FIELD.get(field)
      const edit = staged.get(field)
      if (edit !== undefined && edit.kind === 'text') return edit.text
      return spec !== undefined && isTextSpec(spec) ? spec.format(current.value[field]) : ''
    }
    const failure = probeFailure(draftOf('baseUrl'), draftOf('apiKey'), draftOf('apiKeyRef'))
    testRunningRef.current = true
    setTest({ running: true, ok: null, message: '' })
    testTimerRef.current = setTimeout(() => {
      testTimerRef.current = null
      testRunningRef.current = false
      setTest(failure === null
        ? { running: false, ok: true, message: '' }
        : { running: false, ok: false, message: failure })
    }, TEST_LATENCY_MS)
  }, [readSnapshot, staged])

  const field = useCallback((name: string): FieldState => {
    const spec = SPEC_BY_FIELD.get(name)
    if (spec === undefined) {
      return {
        text: '', value: undefined, effective: undefined, stored: false, overridden: false, dirty: false, invalid: false,
      }
    }
    return fieldStateOf(snapshot, spec, staged.get(name))
  }, [snapshot, staged])

  return {
    state: {
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid,
      saving,
      failed,
    },
    field,
    edit,
    setValue,
    resetField,
    discard,
    save,
    test,
    runTest,
  }
}

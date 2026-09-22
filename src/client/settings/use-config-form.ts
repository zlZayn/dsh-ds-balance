/**
 * 配置表单的暂存与保存状态机。
 * 编辑只落在本地草稿，保存是草稿变成设置的唯一出口。
 *
 * 0.1.7 起不再有「设置作用域」这个对象：官方客户端服务
 * `ctx.configForms.get(ENTRY_ID)` 给出的是 {@link ConfigForm} ——
 * `getSnapshot / subscribe / mutate / set / unset`，其中 `set` / `unset` 直接返回
 * **宿主是否接受**，所以「写完读回 user 层猜成败」那一套整个删掉了。
 *
 * 保存走**一次** `mutate`：全部字段共享一道修订栅栏、一次宿主校验、一次落盘决定
 * （官方 `config-form-types.ts` 的原话）。这也是 `orderPairWrites` 退役的原因 ——
 * 逐字段写入才有的中间态在原子提交下不存在。
 * @module dsh-ds-balance/client/settings/use-config-form
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

/** 配置表单的键域：11 个字段都是标量，按普通对象收窄。 */
export type ConfigFormOf = ConfigForm<Record<string, unknown>>

/**
 * `mutate` 接受的操作表。
 *
 * **从官方类型推导，不 import `@deepseek-ai/dsh-api-remotes`** —— 那个包不在本仓的
 * 声明面里，而这里要的只是「这次写入长什么样」。
 */
type MutateOps = Parameters<ConfigFormOf['mutate']>[0]
type MutateOp = MutateOps[number]
type MutateValue = Extract<MutateOp, { op: 'set' }>['value']

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

/** 一对阈值：同一币种内的预警与告急。 */
export interface ThresholdPair {
  readonly currency: string
  readonly warn: string
  readonly critical: string
  /**
   * 两个字段的宿主默认值。
   *
   * **必须在这里存一份**：草稿清空之后生效的是默认值而不是旧值，判「空值算不算合法」就得知道它。
   * 两个半体不许值导入，所以抄一份是没办法的事 —— 与宿主 schema 的一致性由
   * `test/threshold-pairs.test.ts` 对着 [src/config.ts](../../config.ts) 的 `Config` 兜底。
   */
  readonly defaultWarn: number
  readonly defaultCritical: number
}

/** 阈值成对的清单；字段名沿用宿主 schema 的「币种代码小写 + Warn / Critical」。 */
export const THRESHOLD_PAIRS: readonly ThresholdPair[] = [
  { currency: 'CNY', warn: 'cnyWarn', critical: 'cnyCritical', defaultWarn: 10, defaultCritical: 5 },
  { currency: 'USD', warn: 'usdWarn', critical: 'usdCritical', defaultWarn: 2, defaultCritical: 1 },
]

/** 草稿文本折算成数字；空草稿按默认值算，不是数字则给 `null`（那由字段自己的 parse 报错）。 */
function pairNumber(state: FieldState, fallback: number): number | null {
  const text = state.text.trim()
  if (text === '') return fallback
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 一对阈值是否满足「告急 **严格低于** 预警」。
 *
 * 相等也拒绝：那时余额恰好压线会被同时判成 warn 与 critical，「预警」这一档等于不存在。
 * 任一侧的草稿不是数字时返回 `true` —— 那种情况由各自的 `parse` 报错，不在这里重复报。
 * @param pair - 币种与它的两个字段。
 * @param warn - 预警字段的状态。
 * @param critical - 告急字段的状态。
 * @returns 是否通过。
 */
export function thresholdsOk(pair: ThresholdPair, warn: FieldState, critical: FieldState): boolean {
  const w = pairNumber(warn, pair.defaultWarn)
  const c = pairNumber(critical, pair.defaultCritical)
  if (w === null || c === null) return true
  return c < w
}

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
  /**
   * 宿主是否在服务这个命名空间（官方快照的 `status === 'ready'`）。
   *
   * 为假时卡片**什么都不渲染** —— 官方所有卡片都这么处理（`ui-primitives` 的
   * `SettingsFormModel`：`available: snapshot.status === 'ready'`）。
   * 首帧是 `loading`，所以真机上会先空一拍再出现。
   */
  readonly available: boolean
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
  /** 一个币种的阈值草稿是否满足「告急 < 预警」；空草稿按默认值算。 */
  thresholdPairOk(currency: string): boolean
  /** 该字段是否已经失焦过；用来决定要不要显示成对校验提示。 */
  touched(field: string): boolean
  /** 记一次失焦。 */
  touch(field: string): void
  /** 测试连接状态。 */
  readonly test: TestState
  /** 跑一次本地模拟的连接测试。 */
  runTest(): void
}

/** 本地模拟的连接测试耗时。 */
export const TEST_LATENCY_MS = 800

/**
 * 判定一次模拟连接测试是否失败。
 * 规则：Base URL **留空合法**（走官方默认地址），非空时必须以 http:// 或 https:// 开头；
 * API Key 与引用名不能同时为空。
 * 返回的是宿主诊断风格的英文短句，与官方卡片直接展示宿主诊断的做法一致。
 * @param baseUrl - 当前草稿或生效的 Base URL。
 * @param apiKey - 当前草稿或生效的 API Key。
 * @param apiKeyRef - 当前草稿或生效的引用名。
 * @returns 失败原因；可通过时为 null。
 */
export function probeFailure(baseUrl: string, apiKey: string, apiKeyRef: string): string | null {
  const url = baseUrl.trim()
  if (url !== '' && !/^https?:\/\//i.test(url)) return 'base URL must start with http:// or https://'
  if (apiKey.trim() === '' && apiKeyRef.trim() === '') return 'no API key or credential reference configured'
  return null
}

/** 一次待写入的编辑。 */
type StagedEdit =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'clear' }

/** 规范化后的快照：官方快照收窄成卡片依赖的四片。 */
interface NormalizedSnapshot {
  readonly value: Record<string, unknown>
  readonly user: Record<string, unknown>
  readonly writable: boolean
  readonly available: boolean
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
 * 写一个字段。
 *
 * 设置卡片与侧栏「改用 X」共用这一条写路径。**返回值就是宿主是否接受**
 * （官方 `ConfigForm.set` 的契约），所以不需要再读回 user 层猜 ——
 * 那条 `landedWrite` 判据连同它的读回整个删掉了。传输失敗会 reject，调用方接住即可。
 * @param form - 该条目的配置表单。
 * @param field - 字段名。
 * @param value - 要写进该字段的值。
 * @returns 宿主是否接受这次写入。
 */
export async function writeFieldValue(
  form: ConfigFormOf,
  field: string,
  value: unknown,
): Promise<boolean> {
  return await form.set(field, value)
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

/** 取一个字段的渲染状态；字段不在规格表里时给一份全空的保守值。 */
function fieldOf(snapshot: NormalizedSnapshot, name: string, edit: StagedEdit | undefined): FieldState {
  const spec = SPEC_BY_FIELD.get(name)
  if (spec === undefined) {
    return {
      text: '', value: undefined, effective: undefined, stored: false, overridden: false, dirty: false, invalid: false,
    }
  }
  return fieldStateOf(snapshot, spec, edit)
}

/**
 * 绑定一个条目的配置表单。
 *
 * `readSnapshot` 必须返回**引用稳定**的对象（`useSyncExternalStore` 用 Object.is 比），
 * 而 `asRecord(undefined)` 每次都造一个新 `{}` —— 所以这里留一层缓存，逐片比过再决定
 * 要不要换快照。
 * @param form - `ctx.configForms.get(ENTRY_ID)` 给的表单，`apply` 期建一次、引用稳定。
 * @returns 表单状态与动作。
 */
export function useConfigForm(form: ConfigFormOf): ConfigFormApi {
  const cacheRef = useRef<{
    value: Record<string, unknown>
    user: Record<string, unknown>
    writable: boolean
    available: boolean
    snapshot: NormalizedSnapshot
  } | null>(null)
  const readSnapshot = useCallback((): NormalizedSnapshot => {
    const raw = form.getSnapshot()
    const value = asRecord(raw.value)
    const user = asRecord(raw.user)
    const writable = raw.writable !== false
    const available = raw.status === 'ready'
    const cache = cacheRef.current
    if (cache !== null
      && cache.writable === writable
      && cache.available === available
      && (cache.value === value || shallowEqual(cache.value, value))
      && (cache.user === user || shallowEqual(cache.user, user))) {
      return cache.snapshot
    }
    const snapshot: NormalizedSnapshot = { value, user, writable, available }
    cacheRef.current = { value, user, writable, available, snapshot }
    return snapshot
  }, [form])

  const subscribe = useCallback(
    (listener: () => void) => form.subscribe(listener),
    [form],
  )
  const snapshot = useSyncExternalStore(subscribe, readSnapshot)
  const [staged, setStaged] = useState<ReadonlyMap<string, StagedEdit>>(() => new Map())
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  /** 已经失焦过的字段。成对校验的提示在失焦后才出现，免得打字中途闪一下。 */
  const [blurred, setBlurred] = useState<ReadonlySet<string>>(() => new Set<string>())
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
  // 成对校验按**草稿**判，所以必须和 field() 看同一份状态；它也算进整体 invalid，
  // 「有非法项就置灰保存」这条才对这个跨字段规则成立。
  const pairsInvalid = useMemo(
    () => THRESHOLD_PAIRS.some(pair => !thresholdsOk(
      pair,
      fieldOf(snapshot, pair.warn, staged.get(pair.warn)),
      fieldOf(snapshot, pair.critical, staged.get(pair.critical)),
    )),
    [snapshot, staged],
  )
  const invalid = plan.some(item => item.write === undefined) || pairsInvalid

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
    const writes = planWrites(readSnapshot(), staged)
    if (writes.length === 0) return
    if (writes.some(item => item.write === undefined)) return
    savingRef.current = true
    setSaving(true)
    setFailed(false)
    // 一次原子提交：全部字段共享一道修订栅栏、一次宿主校验、一次落盘决定。
    // 所以**没有中间态**，成对字段的写入顺序不再需要排 —— 这就是 orderPairWrites 退役的原因。
    const ops: MutateOp[] = []
    for (const item of writes) {
      const write = item.write
      if (write === undefined) continue
      ops.push(write.kind === 'clear'
        ? { op: 'unset', path: [item.field] }
        : { op: 'set', path: [item.field], value: write.value as MutateValue })
    }
    let landed = false
    try {
      landed = await form.mutate(ops, form.getSnapshot().revision)
    } catch {
      landed = false
    }
    savingRef.current = false
    setSaving(false)
    if (landed) setStaged(new Map())
    setFailed(!landed)
  }, [form, readSnapshot, staged])

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

  const field = useCallback(
    (name: string): FieldState => fieldOf(snapshot, name, staged.get(name)),
    [snapshot, staged],
  )

  const thresholdPairOk = useCallback(
    (currency: string): boolean => {
      const pair = THRESHOLD_PAIRS.find(item => item.currency === currency)
      if (pair === undefined) return true
      return thresholdsOk(
        pair,
        fieldOf(snapshot, pair.warn, staged.get(pair.warn)),
        fieldOf(snapshot, pair.critical, staged.get(pair.critical)),
      )
    },
    [snapshot, staged],
  )

  /**
   * 记一次失焦。集合只增不减：提示一旦出现过就不该在下次敲键时消失。
   */
  const touch = useCallback((name: string): void => {
    setBlurred(current => (current.has(name) ? current : new Set(current).add(name)))
  }, [])

  const touched = useCallback((name: string): boolean => blurred.has(name), [blurred])

  return {
    state: {
      available: snapshot.available,
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
    thresholdPairOk,
    touched,
    touch,
    test,
    runTest,
  }
}

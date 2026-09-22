/**
 * 「DeepSeek 余额」在 bundle 详情页里的配置卡片：标题与描述由页面画，卡内只有控件与保存。
 * 只做配置：连接、展示、阈值、刷新四组；不展示任何额度信息，也不按阈值给任何东西上色。
 * 分组按使用频率排序：刷新三项有合理默认值，放最后。
 * @module dsh-ds-balance/client/settings/BalanceSettingsCard
 */

import { useState, type ReactNode } from 'react'
import {
  IconApiOutlineRegular, IconGlobeOutlineRegular, IconRefreshOutlineRegular, IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { interpolate } from '../locales.ts'
import type { LocaleKey } from '../locales.ts'
import {
  ActionRow, DetailsGroup, FieldBadges, FieldFrame, FieldGroup, ReadOnlyControl,
  SelectorControl, TextControl,
} from './fields.tsx'
import type { FieldStatus, SelectorOption } from './fields.tsx'
import { AUTO_CURRENCY, currencyCodes, THRESHOLD_PAIRS, useConfigForm } from './use-config-form.ts'
import type { ConfigFormOf } from './use-config-form.ts'
import { credentialViewOf, useCredentialState } from './use-credential-state.ts'
import type { CredentialView } from './use-credential-state.ts'
import css from './BalanceSettingsCard.module.css'
import fieldCss from './fields.module.css'

export type { ConfigFormOf } from './use-config-form.ts'

/** 卡片要求的属性。t 由框架按注册时声明的字典命名空间注入。 */
export interface BalanceSettingsCardProps {
  /** 词典读取器，键域来自本插件的命名空间。 */
  t: (key: LocaleKey) => string
  /** 该条目的配置表单，来自 `ctx.configForms.get(ENTRY_ID)`。 */
  form: ConfigFormOf
}

/** 与宿主 schema 的默认值逐字一致的凭据引用名；快照缺字段时兜底。 */
const DEFAULT_API_KEY_REF = 'DEEPSEEK_API_KEY'

/**
 * 只读凭据行的状态徽章。
 * 四档的判据在 `use-credential-state.ts` 的 `credentialViewOf`：它答的是「当前生效的值从哪来」。
 */
const CREDENTIAL_BADGE: Readonly<Record<CredentialView, LocaleKey>> = {
  // 官方那张卡右上角只有一句话：「已配置密钥。」——继承来的、自己填的、环境提供的都算配置好了。
  // 四档判据留着，是因为「覆盖 / 未覆盖」决定二级折叠里那两个字段的状态；徽章本身不区分它们。
  env: 'settings.credential.configured',
  configured: 'settings.credential.configured',
  notConfigured: 'settings.credential.notConfigured',
  overridden: 'settings.credential.configured',
}

/** 四个配置分组的键。 */
type GroupKey = 'connection' | 'display' | 'thresholds' | 'refresh'

/**
 * 分组的默认展开状态：四组默认**收起** —— 进页面先看到四行提纲，展开与否由用户点。
 * 组内有非法草稿时仍由 `groupOpenNow` 强制展开，不受这里影响。
 */
const DEFAULT_GROUP_OPEN: Readonly<Record<GroupKey, boolean>> = {
  connection: false,
  display: false,
  thresholds: false,
  refresh: false,
}

/** 每组包含哪些字段；用来判断「这一组里有没有需要用户看见的非法草稿」。 */
const GROUP_FIELDS: Readonly<Record<GroupKey, readonly string[]>> = {
  connection: ['apiKey', 'apiKeyRef', 'baseUrl'],
  display: ['displayCurrency'],
  thresholds: ['cnyWarn', 'cnyCritical', 'usdWarn', 'usdCritical'],
  refresh: ['serverRefreshSeconds', 'clientPollSeconds', 'manualRefreshCooldownSeconds'],
}

/** 字段名到控件 id 的映射。 */
const FIELD_IDS: Record<string, string> = {
  apiKey: 'ds-balance-api-key',
  apiKeyRef: 'ds-balance-api-key-ref',
  apiKeyState: 'ds-balance-api-key-state',
  baseUrl: 'ds-balance-base-url',
  serverRefreshSeconds: 'ds-balance-server-refresh-seconds',
  clientPollSeconds: 'ds-balance-client-poll-seconds',
  manualRefreshCooldownSeconds: 'ds-balance-manual-refresh-cooldown-seconds',
  displayCurrency: 'ds-balance-display-currency',
  cnyWarn: 'ds-balance-cny-warn',
  cnyCritical: 'ds-balance-cny-critical',
  usdWarn: 'ds-balance-usd-warn',
  usdCritical: 'ds-balance-usd-critical',
}

/**
 * 判断一个生效值算不算「有内容」。
 * @param value - 快照里的生效值。
 * @returns 非空串或任何非空值都为真。
 */
function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false
  return typeof value !== 'string' || value.trim() !== ''
}

/**
 * 渲染配置卡片。
 * @param props - 词典读取器与配置表单。
 * @returns 卡片元素；宿主没在服务这个命名空间时**什么都不渲染**。
 */
export function BalanceSettingsCard({ t, form: scopedForm }: BalanceSettingsCardProps) {
  const form = useConfigForm(scopedForm)
  const [groupOpen, setGroupOpen] = useState<Readonly<Record<GroupKey, boolean>>>(DEFAULT_GROUP_OPEN)

  // 各组独立展开，不做手风琴：多项同时展开是刻意的（官方 PluginCard.tsx:8-9 的注释）。
  const toggleGroup = (key: GroupKey): void => {
    setGroupOpen(current => ({ ...current, [key]: !current[key] }))
  }

  // 组里有非法草稿时该组强制展开：非法会禁用保存，用户必须看得见那个标红的字段，
  // 否则 footer 的「请检查标红的字段」会指向一个收起来的组。改好后即可自行收起。
  const groupOpenNow = (key: GroupKey): boolean =>
    groupOpen[key]
    || GROUP_FIELDS[key].some(name => form.field(name).invalid)
    // 成对校验不是字段级 invalid，得单独问一次：否则收起的阈值组会挡住「保存为什么是灰的」。
    || (key === 'thresholds' && THRESHOLD_PAIRS.some(pair => !form.thresholdPairOk(pair.currency)))

  const { available, writable, dirty, invalid, saving, failed } = form.state
  const disabled = !writable || saving

  // 凭据字段的状态胶囊：只描述已经存下来的事实，不看编辑中的草稿。
  // 官方 SecretField 与知乎卡片同构：标签行右侧一个 Tag，neutral 表示有值，quiet 表示没有。
  const credentialStatus = (name: string): FieldStatus => {
    const state = form.field(name)
    if (state.stored) return { label: t('settings.overridden'), tone: 'neutral' }
    if (isFilled(state.effective)) return { label: t('settings.configured'), tone: 'neutral' }
    return { label: t('settings.notConfigured'), tone: 'quiet' }
  }

  // 文本类字段：草稿或已存的用户覆盖都能撤销。
  const textRow = (name: string, labelKey: LocaleKey, hintKey: LocaleKey, withStatus: boolean) => {
    const state = form.field(name)
    return (
      <FieldFrame
        id={FIELD_IDS[name] ?? name}
        label={t(labelKey)}
        status={withStatus ? credentialStatus(name) : null}
        pending={state.dirty}
        resettable={state.overridden || state.dirty}
        pendingLabel={t('settings.unsaved')}
        resetLabel={t('settings.reset')}
        invalid={state.invalid}
        hint={t(hintKey)}
        disabled={disabled}
        onReset={() => { form.resetField(name) }}
      >
        <TextControl
          id={FIELD_IDS[name] ?? name}
          text={state.text}
          numeric={false}
          invalid={state.invalid}
          disabled={disabled}
          onEdit={(text) => { form.edit(name, text) }}
        />
      </FieldFrame>
    )
  }

  // 数字字段：只有 inputMode 提示数字键盘，接受范围由宿主 schema 决定。
  // 给了 hintKey 的字段常态出说明，非法时换成 settings.invalidNumber —— 两句不同的话，
  // 而不是同一句话换个颜色。没给的（阈值四行）常态不出说明，由分组说明承担常驻提示。
  const numberRow = (name: string, labelKey: LocaleKey, hintKey?: LocaleKey, note?: ReactNode) => {
    const state = form.field(name)
    return (
      <FieldFrame
        id={FIELD_IDS[name] ?? name}
        label={t(labelKey)}
        pending={state.dirty}
        resettable={state.overridden || state.dirty}
        pendingLabel={t('settings.unsaved')}
        resetLabel={t('settings.reset')}
        invalid={state.invalid}
        invalidNote={t('settings.invalidNumber')}
        hint={hintKey === undefined ? undefined : t(hintKey)}
        disabled={disabled}
        onReset={() => { form.resetField(name) }}
      >
        <TextControl
          id={FIELD_IDS[name] ?? name}
          text={state.text}
          numeric
          invalid={state.invalid}
          disabled={disabled}
          onBlur={() => { form.touch(name) }}
          onEdit={(text) => { form.edit(name, text) }}
        />
        {note ?? null}
      </FieldFrame>
    )
  }

  /**
   * 阈值成对的校验提示。它被放进那一对**最后一个字段的字段体**里，因此紧贴输入框下方，
   * 也不会在 `.fields` 的分隔线节奏里多出一条线。
   *
   * **打字时不出现**：只在其中一个失焦过、或这一对本来就非法（例如从旧版本带过来的值）时才显示。
   * 保存按钮不按这条走 —— 它有非法项就置灰，判据在 use-config-form 的 `state.invalid`。
   */
  const pairNote = (currency: string): ReactNode => {
    const pair = THRESHOLD_PAIRS.find(item => item.currency === currency)
    if (pair === undefined || form.thresholdPairOk(currency)) return null
    const drafting = form.field(pair.warn).dirty || form.field(pair.critical).dirty
    if (drafting && !form.touched(pair.warn) && !form.touched(pair.critical)) return null
    return <p className={fieldCss.pairNote} role="alert">{t('settings.hint.thresholdPair')}</p>
  }

  const apiKey = form.field('apiKey')
  const apiKeyRef = form.field('apiKeyRef')
  // 读凭据状态用的是**生效**引用名：草稿还没保存时，后端认的仍是存下来的那个。
  const effectiveRef = typeof apiKeyRef.effective === 'string' && apiKeyRef.effective !== ''
    ? apiKeyRef.effective
    : DEFAULT_API_KEY_REF
  const credential = useCredentialState(effectiveRef)
  // 只读凭据行显示哪一档：覆盖优先（折叠里存过值就是它生效），其次才看宿主能不能写。
  // 「读不到就说什么」的策略也在这个函数里，见它的文档注释。
  const credentialView = credentialViewOf(credential, apiKey.stored || apiKeyRef.stored)

  const currency = form.field('displayCurrency')
  const currencyId = typeof currency.value === 'string' && currency.value !== '' ? currency.value : AUTO_CURRENCY
  const currencyOptions: SelectorOption[] = [
    { id: AUTO_CURRENCY, label: t('settings.currency.auto') },
    ...currencyCodes(currency.value, currency.effective).map(code => ({ id: code, label: code })),
  ]
  // 「显示币种」是整行选择型：左文字、右 pill，结构照官方 General 行。
  // 凭据字段才带状态徽标；这一行的左槽只放「未保存」与「重置」，右侧整块让给 pill。
  const currencyRow = (
    <div className={fieldCss.row}>
      <div className={fieldCss.rowText}>
        <div className={fieldCss.rowTitleLine}>
          <span className={fieldCss.rowTitle}>{t('settings.field.displayCurrency')}</span>
          <FieldBadges
            pending={currency.dirty}
            resettable={currency.dirty}
            pendingLabel={t('settings.unsaved')}
            resetLabel={t('settings.reset')}
            disabled={disabled}
            onReset={() => { form.resetField('displayCurrency') }}
          />
        </div>
        <p className={fieldCss.hint}>{t('settings.hint.displayCurrency')}</p>
      </div>
      <SelectorControl
        id={FIELD_IDS.displayCurrency ?? 'displayCurrency'}
        label={t('settings.field.displayCurrency')}
        options={currencyOptions}
        selectedId={currencyId}
        disabled={disabled}
        onSelect={(id) => { form.setValue('displayCurrency', id) }}
      />
    </div>
  )

  const testResult = form.test.ok === null
    ? null
    : form.test.ok
      ? { ok: true, text: t('settings.test.ok') }
      : { ok: false, text: interpolate(t('settings.test.fail'), { message: form.test.message }) }

  const footerNote = failed
    ? { text: t('settings.failed'), className: css.failed }
    : invalid
      ? { text: t('settings.invalid'), className: css.notice }
      : null

  // 宿主没在服务这个命名空间（错的 ENTRY_ID、陌生宿主、或远程页面停在 memory 模式）时
  // **什么都不渲染**：空控件配一个能点的保存按钮，比不渲染更坏。官方每张卡片都这么处理。
  // 放在所有 hook 之后 —— 提前 return 会换掉 hook 顺序。
  if (!available) return null

  return (
    // 页面把这一格渲染在自己的 <section> 里：无外框的一列控件，所以根节点是 div、不是 li。
    <div className={css.form}>
      {writable ? null : <p className={css.readOnly} role="status">{t('settings.readOnly')}</p>}

      <FieldGroup
        icon={<IconApiOutlineRegular size={14} />}
        title={t('settings.group.connection')}
        open={groupOpenNow('connection')}
        onToggle={() => { toggleGroup('connection') }}
      >
        {/* 凭据状态：只读展示。结构照搬官方「模型」卡片对「启动环境提供的密钥」的处理 ——
            字段照常渲染，disabled、整块降到 60%，而不是隐藏或另做只读块。
            **框内不写字**：状态改由标签行右侧的徽章（四档）与它下方的说明行承担；
            灰字占位符读起来像「这里该填但没填」，语气是错的。
            要覆盖它，展开下方的「自定义设置」。 */}
        <FieldFrame
          id={FIELD_IDS.apiKeyState ?? 'apiKeyState'}
          label={t('settings.field.apiKey')}
          status={{ label: t(CREDENTIAL_BADGE[credentialView]), tone: credentialView === 'notConfigured' ? 'quiet' : 'neutral' }}
          pending={false}
          resettable={false}
          pendingLabel={t('settings.unsaved')}
          resetLabel={t('settings.reset')}
          invalid={false}
          hint={t('settings.hint.credential')}
          disabled
          onReset={() => {}}
        >
          <ReadOnlyControl
            id={FIELD_IDS.apiKeyState ?? 'apiKeyState'}
          />
        </FieldFrame>

        {textRow('baseUrl', 'settings.field.baseUrl', 'settings.hint.baseUrl', false)}

        <div className={fieldCss.field} key="test">
          <ActionRow
            label={form.test.running ? t('settings.testing') : t('settings.test')}
            disabled={disabled || form.test.running}
            result={testResult}
            onClick={form.runTest}
          />
        </div>

        {/* 二级折叠，默认收起：**只能改凭据引用名，不能再填一个 Key** ——
            界面上唯一的 API Key 就是上面那个继承官方、不可改的框（官方「网页搜索」卡片同款）。
            Key 本身仍可由配置文件提供，所以 schema 与写入面都不动。 */}
        <DetailsGroup title={t('settings.group.customized')}>
          {textRow('apiKeyRef', 'settings.field.apiKeyRef', 'settings.hint.apiKeyRef', true)}
        </DetailsGroup>
      </FieldGroup>

      <FieldGroup
        icon={<IconGlobeOutlineRegular size={14} />}
        title={t('settings.group.display')}
        open={groupOpenNow('display')}
        onToggle={() => { toggleGroup('display') }}
      >
        {currencyRow}
      </FieldGroup>

      <FieldGroup
        icon={<IconWarningOutlineRegular size={14} />}
        title={t('settings.group.thresholds')}
        note={t('settings.hint.threshold')}
        open={groupOpenNow('thresholds')}
        onToggle={() => { toggleGroup('thresholds') }}
      >
        {numberRow('cnyWarn', 'settings.field.cnyWarn')}
        {numberRow('cnyCritical', 'settings.field.cnyCritical', undefined, pairNote('CNY'))}
        {numberRow('usdWarn', 'settings.field.usdWarn')}
        {numberRow('usdCritical', 'settings.field.usdCritical', undefined, pairNote('USD'))}
      </FieldGroup>

      {/* 刷新三项都有合理默认值，属于装了就不用动的那一档，因此排在最后。 */}
      <FieldGroup
        icon={<IconRefreshOutlineRegular size={14} />}
        title={t('settings.group.refresh')}
        note={t('settings.hint.refreshAdvanced')}
        open={groupOpenNow('refresh')}
        onToggle={() => { toggleGroup('refresh') }}
        last
      >
        {numberRow('serverRefreshSeconds', 'settings.field.serverRefreshSeconds', 'settings.hint.serverRefreshSeconds')}
        {numberRow('clientPollSeconds', 'settings.field.clientPollSeconds', 'settings.hint.clientPollSeconds')}
        {numberRow('manualRefreshCooldownSeconds', 'settings.field.manualRefreshCooldownSeconds', 'settings.hint.manualRefreshCooldownSeconds')}
      </FieldGroup>

      <div className={css.footer}>
        {footerNote === null
          ? null
          : <p className={footerNote.className} role="status">{footerNote.text}</p>}
        <button
          type="button"
          className={css.save}
          disabled={!dirty || invalid || saving || !writable}
          onClick={() => { void form.save() }}
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>
    </div>
  )
}

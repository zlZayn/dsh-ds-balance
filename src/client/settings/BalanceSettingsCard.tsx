/**
 * 「DeepSeek 余额」在设置页里的配置卡片。
 * 只做配置：连接、展示、阈值、刷新四组；不展示任何额度信息，也不按阈值给任何东西上色。
 * 分组按使用频率排序：刷新三项有合理默认值，放最后。
 * @module dsh-ds-balance/client/settings/BalanceSettingsCard
 */

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconApiOutline14, IconChevronDownOutline14, IconGlobeOutline14, IconRefreshOutline14, IconWarningOutline16, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { interpolate } from '../locales.ts'
import type { LocaleKey } from '../locales.ts'
import {
  ActionRow, DetailsGroup, FieldBadges, FieldFrame, FieldGroup, ReadOnlyControl, SecretControl,
  SelectorControl, TextControl,
} from './fields.tsx'
import type { FieldStatus, SelectorOption } from './fields.tsx'
import { AUTO_CURRENCY, currencyCodes, useConfigForm } from './use-config-form.ts'
import type { SettingsScope } from './use-config-form.ts'
import { useCredentialState } from './use-credential-state.ts'
import css from './BalanceSettingsCard.module.css'
import fieldCss from './fields.module.css'

export type { SettingsScope } from './use-config-form.ts'

/** 卡片要求的属性。t 由框架按注册时声明的字典命名空间注入。 */
export interface BalanceSettingsCardProps {
  /** 词典读取器，键域来自本插件的命名空间。 */
  t: (key: LocaleKey) => string
  /** 设置作用域；真实 ctx.settingsScope.bind() 的返回值结构上满足它。 */
  scope: SettingsScope
}

/** 与宿主 schema 的默认值逐字一致的凭据引用名；快照缺字段时兜底。 */
const DEFAULT_API_KEY_REF = 'DEEPSEEK_API_KEY'

/** 四个配置分组的键。 */
type GroupKey = 'connection' | 'display' | 'thresholds' | 'refresh'

/** 分组的默认展开状态：四组全收着，卡片一打开只占四行折叠头。 */
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
 * @param props - 词典读取器与设置作用域。
 * @returns 卡片元素。
 */
export function BalanceSettingsCard({ t, scope }: BalanceSettingsCardProps) {
  const form = useConfigForm(scope)
  const [open, setOpen] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [groupOpen, setGroupOpen] = useState<Readonly<Record<GroupKey, boolean>>>(DEFAULT_GROUP_OPEN)
  const saveStarted = useRef(false)

  // 各组独立展开，不做手风琴：多项同时展开是刻意的（官方 PluginCard.tsx:8-9 的注释）。
  const toggleGroup = (key: GroupKey): void => {
    setGroupOpen(current => ({ ...current, [key]: !current[key] }))
  }

  // 组里有非法草稿时该组强制展开：非法会禁用保存，用户必须看得见那个标红的字段，
  // 否则 footer 的「请检查标红的字段」会指向一个收起来的组。改好后即可自行收起。
  const groupOpenNow = (key: GroupKey): boolean =>
    groupOpen[key] || GROUP_FIELDS[key].some(name => form.field(name).invalid)

  const { writable, dirty, invalid, saving, failed } = form.state
  const disabled = !writable || saving

  // 保存落定后才折叠：被拒绝的写入保持展开，草稿与诊断留在原地供修正。
  useEffect(() => {
    if (saving) {
      saveStarted.current = true
      return
    }
    if (!saveStarted.current) return
    saveStarted.current = false
    if (!dirty && !failed) setOpen(false)
  }, [dirty, failed, saving])

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
  // 常态不给说明，非法时才出现 settings.invalidNumber —— 这样非法态的文案与常态是两句话，
  // 而不是同一句话换个颜色；分组说明承担「留空即默认」的常驻提示。
  const numberRow = (name: string, labelKey: LocaleKey) => {
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
        disabled={disabled}
        onReset={() => { form.resetField(name) }}
      >
        <TextControl
          id={FIELD_IDS[name] ?? name}
          text={state.text}
          numeric
          invalid={state.invalid}
          disabled={disabled}
          onEdit={(text) => { form.edit(name, text) }}
        />
      </FieldFrame>
    )
  }

  const apiKey = form.field('apiKey')
  const apiKeyRef = form.field('apiKeyRef')
  // 读凭据状态用的是**生效**引用名：草稿还没保存时，后端认的仍是存下来的那个。
  const effectiveRef = typeof apiKeyRef.effective === 'string' && apiKeyRef.effective !== ''
    ? apiKeyRef.effective
    : DEFAULT_API_KEY_REF
  const credential = useCredentialState(effectiveRef)
  // 读不到一律当「只读」：这个字段本来就是只读状态展示，编辑入口在下面的「自定义设置」，
  // 所以「当只读」在任何一种未知情况下都不会说错话，也不会因为字段缺失把卡片打挂。
  const credentialPlaceholder = credential?.writable === true
    ? credential.configured
      ? t('settings.configured')
      : t('settings.notConfigured')
    : t('settings.credential.envLocked')

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

  return (
    <li className={clsx(css.card, open && css.cardOpen)}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{t('settings.title')}</span>
          <span className={css.description}>{t('settings.description')}</span>
        </span>
        {dirty ? <Tag tone="neutral" className={css.pending}>{t('settings.unsaved')}</Tag> : null}
        {/* 折叠箭头是纯装饰：包一层 aria-hidden，图标本身不接受这个属性。 */}
        <span className={css.chevronWrap} aria-hidden="true">
          <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
        </span>
      </button>

      {open
        ? (
          <div className={css.body}>
            {writable ? null : <p className={css.readOnly} role="status">{t('settings.readOnly')}</p>}

            <FieldGroup
              icon={<IconApiOutline14 size={14} />}
              title={t('settings.group.connection')}
              open={groupOpenNow('connection')}
              onToggle={() => { toggleGroup('connection') }}
            >
              {/* 凭据状态：只读。结构照搬官方「模型」卡片对「启动环境提供的密钥」的处理 ——
                  字段照常渲染，disabled + 只读占位说明，整块降到 60%，而不是隐藏或另做只读块。
                  要覆盖它，展开下方的「自定义设置」。 */}
              <FieldFrame
                id={FIELD_IDS.apiKeyState ?? 'apiKeyState'}
                label={t('settings.field.apiKey')}
                pending={false}
                resettable={false}
                pendingLabel={t('settings.unsaved')}
                resetLabel={t('settings.reset')}
                invalid={false}
                disabled
                onReset={() => {}}
              >
                <ReadOnlyControl
                  id={FIELD_IDS.apiKeyState ?? 'apiKeyState'}
                  placeholder={credentialPlaceholder}
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

              {/* 二级折叠，默认收起：普通用户继承官方凭据就够了，高级用户想覆盖或换账户再展开。 */}
              <DetailsGroup title={t('settings.group.customized')}>
                <FieldFrame
                  id={FIELD_IDS.apiKey ?? 'apiKey'}
                  label={t('settings.field.apiKey')}
                  status={credentialStatus('apiKey')}
                  pending={apiKey.dirty}
                  resettable={apiKey.overridden || apiKey.dirty}
                  pendingLabel={t('settings.unsaved')}
                  resetLabel={t('settings.reset')}
                  invalid={false}
                  hint={t('settings.hint.apiKey')}
                  disabled={disabled}
                  onReset={() => { form.resetField('apiKey') }}
                >
                  <SecretControl
                    id={FIELD_IDS.apiKey ?? 'apiKey'}
                    text={apiKey.text}
                    invalid={false}
                    disabled={disabled}
                    revealed={revealed}
                    revealLabel={t('settings.field.apiKey')}
                    onToggleReveal={() => { setRevealed(!revealed) }}
                    onEdit={(text) => { form.edit('apiKey', text) }}
                  />
                </FieldFrame>
                {textRow('apiKeyRef', 'settings.field.apiKeyRef', 'settings.hint.apiKeyRef', true)}
              </DetailsGroup>
            </FieldGroup>

            <FieldGroup
              icon={<IconGlobeOutline14 size={14} />}
              title={t('settings.group.display')}
              open={groupOpenNow('display')}
              onToggle={() => { toggleGroup('display') }}
            >
              {currencyRow}
            </FieldGroup>

            <FieldGroup
              icon={<IconWarningOutline16 size={14} />}
              title={t('settings.group.thresholds')}
              note={t('settings.hint.threshold')}
              open={groupOpenNow('thresholds')}
              onToggle={() => { toggleGroup('thresholds') }}
            >
              {numberRow('cnyWarn', 'settings.field.cnyWarn')}
              {numberRow('cnyCritical', 'settings.field.cnyCritical')}
              {numberRow('usdWarn', 'settings.field.usdWarn')}
              {numberRow('usdCritical', 'settings.field.usdCritical')}
            </FieldGroup>

            {/* 刷新三项都有合理默认值，属于装了就不用动的那一档，因此排在最后。 */}
            <FieldGroup
              icon={<IconRefreshOutline14 size={14} />}
              title={t('settings.group.refresh')}
              note={t('settings.hint.refreshAdvanced')}
              open={groupOpenNow('refresh')}
              onToggle={() => { toggleGroup('refresh') }}
              last
            >
              {numberRow('serverRefreshSeconds', 'settings.field.serverRefreshSeconds')}
              {numberRow('clientPollSeconds', 'settings.field.clientPollSeconds')}
              {numberRow('manualRefreshCooldownSeconds', 'settings.field.manualRefreshCooldownSeconds')}
            </FieldGroup>

            <div className={css.footer}>
              {footerNote === null
                ? null
                : <p className={footerNote.className} role="status">{footerNote.text}</p>}
              <button
                type="button"
                className={css.discard}
                disabled={!dirty || saving}
                onClick={form.discard}
              >
                {t('settings.discard')}
              </button>
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
        : null}
    </li>
  )
}

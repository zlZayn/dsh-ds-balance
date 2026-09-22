/**
 * 本地化词典。`zh` 是键集真源，`en` 用 `Record<LocaleKey, string>` 做编译期完整性检查。
 * @module dsh-ds-balance/client/locales
 */

/** 词典命名空间，必须与 slot 注册项的 `locale` 字段一致。 */
export const NS = 'ds-balance'

/** 中文词典（键集真源）。 */
export const zh = {
  'sidebar.label': 'DeepSeek 余额',
  'sidebar.aria.balance': 'DeepSeek 余额',
  'sidebar.aria.ring': 'DeepSeek 余额状态',
  'sidebar.aria.refresh': '刷新余额',
  'sidebar.aria.mismatch': '显示的币种与你选择的不一致',

  'popover.title': '账户余额',
  'popover.total': '余额',
  'popover.granted': '赠送',
  'popover.toppedUp': '充值',
  'popover.updated': '{value}前',
  'popover.updated.justNow': '刚刚更新',
  'popover.refreshing': '刷新中',
  'popover.cooldown': '{value} 秒后可再次刷新',
  'popover.mismatch': '未找到 {wanted} 余额，当前显示 {shown}',
  'popover.action.useShown': '改用 {shown}',
  'popover.action.openPlugins': '打开插件页',

  'state.unavailable': '账户不可用',
  'state.stale': '数据已过期',
  'state.error': '读取失败',
  'state.empty': '尚未配置',
  'state.noKey': '尚未填写 API Key',
  'state.noBalance': '暂无余额',

  'settings.group.connection': '连接',
  'settings.group.refresh': '刷新',
  'settings.group.display': '展示',
  'settings.group.thresholds': '阈值',
  'settings.field.apiKey': 'API Key',
  'settings.field.apiKeyRef': 'API 密钥引用名',
  'settings.field.baseUrl': '接口地址',
  'settings.field.serverRefreshSeconds': '服务端刷新频率（秒）',
  'settings.field.clientPollSeconds': '客户端轮询频率（秒）',
  'settings.field.manualRefreshCooldownSeconds': '手动刷新冷却（秒）',
  'settings.field.displayCurrency': '显示币种',
  'settings.field.cnyWarn': 'CNY 预警',
  'settings.field.cnyCritical': 'CNY 告急',
  'settings.field.usdWarn': 'USD 预警',
  'settings.field.usdCritical': 'USD 告急',
  'settings.hint.apiKey': '留空则改用引用名从凭据存储读取。',
  'settings.hint.apiKeyRef': '凭据存储里的条目名；非空时优先于 API Key。',
  'settings.hint.baseUrl': '留空则使用提供方默认地址。',
  'settings.hint.displayCurrency': '所选币种不存在时，回落到账户实际持有的币种。',
  'settings.hint.number': '请填数字；留空表示使用默认值。',
  'settings.hint.threshold': '后端判定；界面颜色跟随返回的严重度。',
  'settings.hint.thresholdPair': '告急值必须低于预警值',
  'settings.hint.serverRefreshSeconds': '访问官方接口的间隔。',
  'settings.hint.clientPollSeconds': '刷新显示的间隔；只读本地缓存，不访问上游。',
  'settings.hint.manualRefreshCooldownSeconds': '两次手动刷新之间的最短间隔。',
  'settings.currency.auto': '自动（跟随账户）',
  // 凭据行的**状态徽章**：两条逐字用官方措辞 —— 取自 ui-settings-plugins 的
  // webSearchApiKeySet / webSearchApiKeyUnset（后者去掉搜索相关的后半句）。
  'settings.credential.configured': '已配置密钥。',
  'settings.credential.notConfigured': '未配置密钥。',
  // 凭据行下方的说明。官方 webSearchApiKeyHint 是一句与状态无关的常量说明，这里照做：
  // 状态由徽章交代，说明只讲字段契约。
  'settings.hint.credential': '不写入设置文件。留空表示保持当前密钥。',
  'settings.group.customized': '自定义设置',
  'settings.test': '测试连接',
  'settings.testing': '测试中…',
  'settings.test.ok': '连接正常。',
  'settings.test.fail': '连接失败：{message}',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.failed': '保存失败，请重试。',
  'settings.readOnly': '当前配置只读，无法保存修改。',
  'settings.unsaved': '未保存',
  'settings.invalid': '请检查标红的字段。',
  'settings.configured': '已配置',
  'settings.notConfigured': '未配置',
  'settings.overridden': '已覆盖',
  'settings.reset': '重置',
  'settings.invalidNumber': '请填数字；留空表示使用默认值。',
  'settings.hint.refreshAdvanced': '不常改：默认值适用于大多数情况。',
  'settings.currencyMismatch': '当前账户无 {wanted} 余额，实际显示 {shown}',
  // 该行 Configure 子页标题下方的那一行。本包没有发布展示元数据（locale/*.json），
  // 所以页面的行描述为空，这一档就是那一行的实际内容 —— 一句话说清这一行是什么。
  'settings.summary': '账户余额圆环与浮层的配置。',

  'dev.title': '开发场景',
  'dev.hint': '仅用于 UI 开发；不影响真实配置。',
} as const

/** 词典键。 */
export type LocaleKey = keyof typeof zh

// 把本命名空间并进 DSH 的词典表：`ctx.locale.register` 的实参因此有类型约束，
// 拼错命名空间或缺一种语言都是编译错误。
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'ds-balance': LocaleKey
  }
}

/** 英文词典。缺键会在编译期报错。 */
export const en: Record<LocaleKey, string> = {
  'sidebar.label': 'DeepSeek balance',
  'sidebar.aria.balance': 'DeepSeek balance',
  'sidebar.aria.ring': 'DeepSeek balance status',
  'sidebar.aria.refresh': 'Refresh balance',
  'sidebar.aria.mismatch': 'Shown currency differs from your selection',

  'popover.title': 'Account balance',
  'popover.total': 'Balance',
  'popover.granted': 'Granted',
  'popover.toppedUp': 'Topped up',
  'popover.updated': '{value} ago',
  'popover.updated.justNow': 'Updated just now',
  'popover.refreshing': 'Refreshing',
  'popover.cooldown': 'Refresh available in {value}s',
  'popover.mismatch': 'No {wanted} balance found; showing {shown}',
  'popover.action.useShown': 'Use {shown}',
  'popover.action.openPlugins': 'Open the Plugins page',

  'state.unavailable': 'Account unavailable',
  'state.stale': 'Data is stale',
  'state.error': 'Failed to load',
  'state.empty': 'Not configured',
  'state.noKey': 'API key missing',
  'state.noBalance': 'No balance',

  'settings.group.connection': 'Connection',
  'settings.group.refresh': 'Refresh',
  'settings.group.display': 'Display',
  'settings.group.thresholds': 'Thresholds',
  'settings.field.apiKey': 'API key',
  'settings.field.apiKeyRef': 'API key reference',
  'settings.field.baseUrl': 'Endpoint',
  'settings.field.serverRefreshSeconds': 'Server refresh (seconds)',
  'settings.field.clientPollSeconds': 'Client poll (seconds)',
  'settings.field.manualRefreshCooldownSeconds': 'Manual refresh cooldown (seconds)',
  'settings.field.displayCurrency': 'Display currency',
  'settings.field.cnyWarn': 'CNY warning',
  'settings.field.cnyCritical': 'CNY critical',
  'settings.field.usdWarn': 'USD warning',
  'settings.field.usdCritical': 'USD critical',
  'settings.hint.apiKey': 'Leave empty to resolve from the credential reference instead.',
  'settings.hint.apiKeyRef': 'Credential store entry name; takes precedence over the API key.',
  'settings.hint.baseUrl': 'Leave blank to use the provider default.',
  'settings.hint.displayCurrency': 'Falls back to a currency the account actually holds.',
  'settings.hint.number': 'Enter a number; leave empty to use the default.',
  'settings.hint.threshold': 'Decided on the server; the UI colour follows the returned severity.',
  'settings.hint.thresholdPair': 'Critical must be lower than warning',
  'settings.hint.serverRefreshSeconds': 'How often the official API is called.',
  'settings.hint.clientPollSeconds': 'How often the display refreshes; local cache only.',
  'settings.hint.manualRefreshCooldownSeconds': 'Minimum gap between two manual refreshes.',
  'settings.currency.auto': 'Automatic (follow account)',
  'settings.credential.configured': 'A key is configured.',
  'settings.credential.notConfigured': 'No key is configured.',
  'settings.hint.credential': 'Stored outside the settings file. Leave blank to keep the current key.',
  'settings.group.customized': 'Customized settings',
  'settings.test': 'Test connection',
  'settings.testing': 'Testing…',
  'settings.test.ok': 'Connection looks good.',
  'settings.test.fail': 'Connection failed: {message}',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.failed': 'Saving failed. Try again.',
  'settings.readOnly': 'This configuration is read-only.',
  'settings.unsaved': 'Unsaved',
  'settings.invalid': 'Check the highlighted fields.',
  'settings.configured': 'Configured',
  'settings.notConfigured': 'Not configured',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset',
  'settings.invalidNumber': 'Enter a number; leave empty to use the default.',
  'settings.hint.refreshAdvanced': 'Rarely changed: the defaults suit most setups.',
  'settings.currencyMismatch': 'The account has no {wanted} balance; showing {shown}',
  'settings.summary': 'Configuration for the balance ring and its popover.',

  'dev.title': 'Dev scenario',
  'dev.hint': 'UI development only; does not affect real configuration.',
}

/** 取词典。未知语言回落英文。 */
export function dictionaryFor(language: string): Record<LocaleKey, string> {
  return language.toLowerCase().startsWith('zh') ? zh : en
}

/** 极简插值：把 `{name}` 替换成实参。 */
export function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? params[name] : whole)
}

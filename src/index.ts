/**
 * 宿主半边入口。
 *
 * 组装点（Layer 5）：登记设置命名空间，把端口实现接上，交出生命周期。
 * **业务逻辑一律不在本文件** —— 它只做「谁实现哪个端口」这一个决定。
 *
 * 注意：宿主半边**没有模块热更**，改了这里要重建并让插件行重新挂载才生效。
 * @module dsh-ds-balance
 */

import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { Config, SETTINGS_NAMESPACE, type Config as ConfigShape } from './config.js'
import { DomainCoreStore, type DomainLike, type DomainOpener } from './adapters/domain-core-store.js'
import { HttpDeepSeekClient } from './adapters/http-deepseek-client.js'
import { SALT_BYTES, SALT_ENCODING, loadOrCreateSalt } from './adapters/salt-file.js'
import { createConsoleLogger } from './adapters/console-logger.js'
import { MemoryMetrics } from './adapters/memory-metrics.js'
import { registerHttpRoutes } from './http/routes.js'
import type { Clock } from './ports/clock.js'
import type { Credentials } from './ports/credentials.js'
import type { Logger } from './ports/logger.js'
import { BalanceService } from './services/balance-service.js'
import { ConfigService, type ConfigSource } from './services/config-service.js'
import { KeyResolver } from './services/key-resolver.js'
import { Scheduler } from './services/scheduler.js'

export { Config, SETTINGS_NAMESPACE } from './config.js'
export { CURRENCY_AUTO } from './config.js'

/** 插件名，loader 诊断用。 */
export const name = 'ds-balance'

/**
 * 运行时服务门禁。**删任何一项都会让 `apply` 静默不跑。**
 *
 * - `settings`：登记配置命名空间。
 * - `credentials`：复用官方模型页配好的 DeepSeek 凭据（阶段 0 已实测命中）。
 *
 * `connection` **不列在这里**：缺了它只该丢掉 HTTP 半边，不该让设置与调度一起消失。
 * 它由 `apply` 内部的 `ctx.inject` 单独把门。
 */
export const inject = ['settings', 'credentials']

/** 服务端盐的文件名。与契约 §6.1 / §10.5 一致，落在 DSH home 下。 */
export const SALT_FILE_NAME = '.salt'

/** 系统时钟。 */
const systemClock: Clock = {
  now: () => Date.now(),
  timezone: () => 'Asia/Shanghai',
}

/** 把未知异常压成一行。 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
/**
 * 读服务端盐；读不出来就退回一份进程内临时盐。
 *
 * **临时盐意味着重启后 `accountTag` 全变、旧快照读不回来** —— 降级但不致命，
 * 所以只记 error 不抛。契约 §19 第 5 条把这件事的后果写进了文档。
 * @param logger - 日志端口。
 * @returns 十六进制盐。
 */
async function resolveSalt(logger: Logger): Promise<string> {
  try {
    return await loadOrCreateSalt({ path: dshHomePath(SALT_FILE_NAME) })
  } catch (error) {
    logger.error('ds-balance: salt file unavailable, using an ephemeral salt', { error: describe(error) })
    return randomBytes(SALT_BYTES).toString(SALT_ENCODING)
  }
}

/** 把设置作用域包成配置端口。**每次现读**，不在构造期缓存。 */
function adaptSettingsScope(scope: SettingsScope<ConfigShape>): ConfigSource {
  return {
    get: () => scope.get(),
    watch: (listener) => scope.watch(listener),
    update: (patch) => scope.update(patch),
  }
}

/**
 * 把官方凭据服务收窄成 {@link Credentials}。
 *
 * 真实签名要 `CredentialRef`（带 brand 的字符串），端口只认普通 `string`；
 * 这里用 `credentialRef()` 补上 brand。引用名形状已由 KeyResolver 先校验过。
 * @param ctx - 宿主上下文。
 * @returns 端口实现；服务缺席时返回 `undefined`。
 */
function credentialsPort(ctx: Context): Credentials | undefined {
  let service: CredentialProvider | undefined
  try {
    service = ctx.credentials
  } catch {
    return undefined
  }
  if (service === undefined) return undefined
  return {
    async resolve(ref) {
      const resolved = await service.resolve(credentialRef(ref))
      // 未配置时官方回 `undefined`；端口的约定是「值可能为空串」，交给上游判空。
      return resolved === undefined ? { value: '', source: 'unset' } : { value: resolved.value, source: resolved.source }
    },
    describe: (ref) => service.describe(credentialRef(ref)),
  }
}

/**
 * 接上 `storageDomain` 并交出打开域的函数。
 *
 * 它是**可选服务**，而 cordis 不许读没 `inject` 过的服务（直接访问会抛
 * 「cannot get property ... without inject」），所以必须由 `ctx.inject` 把门；
 * 服务缺席时句柄保持 `undefined`，存储层据此降级，插件其余部分照常跑。
 *
 * 官方 `Domain<S>.table()` 的键类型由 spec 推导，而 {@link DomainLike} 只声明
 * 「按字符串取表」这一件事；运行时行为一致，所以在这里收窄一次，
 * 而不是把官方泛型签名抄进端口。
 * @param ctx - 宿主上下文。
 * @returns 打开域的函数；服务缺席时抛错，由存储适配器吸收成降级。
 */
function connectStorage(ctx: Context): DomainOpener {
  const handle: { facility?: DomainFacility } = {}
  ctx.inject(['storageDomain'], (storageCtx) => {
    storageCtx.effect(() => {
      handle.facility = storageCtx.storageDomain
      return () => { handle.facility = undefined }
    }, 'ds-balance: storage facility')
  })
  return async (spec) => {
    const facility = handle.facility
    if (facility === undefined) throw new Error('storageDomain service is unavailable')
    return await facility.open(spec) as unknown as DomainLike
  }
}
/**
 * 组装并交出生命周期。
 *
 * 异步是因为盐要从磁盘读；读失败会降级，不阻断挂载。
 * @param ctx - 宿主上下文。
 * @param config - 组合层给的配置基线。
 */
export async function apply(ctx: Context, config: ConfigShape): Promise<void> {
  const logger = createConsoleLogger()
  const salt = await resolveSalt(logger)

  const scope = ctx.settings.register(SETTINGS_NAMESPACE, Config, { base: config })
  const configService = new ConfigService({ source: adaptSettingsScope(scope) })
  const keys = new KeyResolver({
    readConfig: () => {
      const current = configService.current()
      return { apiKey: current.apiKey, apiKeyRef: current.apiKeyRef }
    },
    credentials: credentialsPort(ctx),
    logger,
  })
  const client = new HttpDeepSeekClient()
  const store = new DomainCoreStore({ open: connectStorage(ctx), logger })
  // 默认组合没有指标 sink，所以用内存登记表把聚合值留下来，
  // 由 healthz 的 metrics 段暴露（见 .agents/notes 的决策）。
  const metrics = new MemoryMetrics()
  const service = new BalanceService({
    client, store, keys, config: configService, clock: systemClock, salt, logger, metrics,
  })
  const scheduler = new Scheduler({ target: service, logger })

  ctx.effect(() => {
    const stopWatching = scope.watch(() => { scheduler.reset() })
    let stopped = false
    // 先恢复落盘快照再起调度，否则首拉之前的窗口里界面会闪一次空态。
    void service.restore().then(() => {
      if (!stopped) scheduler.start()
    })
    return () => {
      stopped = true
      stopWatching()
      scheduler.stop()
      // 句柄由调用方关闭：facility 不绑消费方 fiber（契约 §10.0）。
      void store.close()
    }
  }, 'ds-balance: lifecycle')

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(() => {
      const disposeRoutes = registerHttpRoutes(connectionCtx, {
        service, config: configService, keys, client, store, scheduler, logger, metrics,
      })
      return () => { void disposeRoutes() }
    }, 'ds-balance: http routes')
  })
}

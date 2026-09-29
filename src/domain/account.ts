/**
 * 账号钱包的领域形状与投影。
 *
 * 账号那条路（`ctx.deepseekAccount`）给的是**钱包列表**，不是官方余额端点的形状。
 * 投影成 {@link RawBalanceResponse} 之后，下游（归一化 → 存储 → 视图 → 界面）一行都不用改 ——
 * 这也是为什么这个函数放在领域层：它是纯的，且对着的是我们自己那条线上形状。
 * @module dsh-ds-balance/domain/account
 */

import type { RawBalanceResponse } from './balance.js'
import { formatMoney, parseMoney, type Units } from './money.js'

/** 一条钱包。金额是官方给的十进制字符串，原样带着，不改精度。 */
export interface AccountWallet {
  readonly currency: string
  readonly balance: string
}

/** 一次账号余额查询的结果：充值钱包与赠送钱包分开给。 */
export interface AccountBalance {
  readonly wallets: readonly AccountWallet[]
  readonly bonusWallets: readonly AccountWallet[]
}

/**
 * 把官方允许的科学计数法展开成十进制定点。
 *
 * 账号侧的钱包金额走 Platform 的 Web 客户端语法，允许 `1e+3` / `0E-16` / `.5` 这类写法；
 * 本仓的 {@link parseMoney} **只认十进制定点**（这是刻意的：线上金额从来不带指数）。
 * 所以先把形状补齐，再交给领域层 —— 缺了这一步，一个 `1e+3` 会让整次抓取报 ParseError。
 * @param value - 官方给的金额字符串。
 * @returns 定点字符串；形状认不出来时原样返回，让下游的 `parseMoney` 去报错。
 */
export function toPlainDecimal(value: string): string {
  const text = value.trim()
  const match = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text)
  if (match === null) return text
  const [, sign = '', whole = '', fraction = '', exponent] = match
  if (exponent === undefined) {
    return `${sign}${whole === '' ? '0' : whole}${fraction === '' ? '' : `.${fraction}`}`
  }
  const digits = `${whole}${fraction}`
  if (digits === '') return text
  const pointAt = whole.length + Number(exponent)
  if (pointAt <= 0) return `${sign}0.${'0'.repeat(-pointAt)}${digits}`
  if (pointAt >= digits.length) return `${sign}${digits}${'0'.repeat(pointAt - digits.length)}`
  return `${sign}${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`
}

/** 按币种把钱包折成最小单位；同币种出现多次时后者覆盖前者（官方不会给重复项）。 */
function walletTotals(wallets: readonly AccountWallet[]): Map<string, Units> {
  const totals = new Map<string, Units>()
  for (const wallet of wallets) {
    totals.set(wallet.currency, parseMoney(toPlainDecimal(wallet.balance)))
  }
  return totals
}

/**
 * 把账号钱包投影成官方余额端点的线上形状。
 *
 * 口径对齐官方账号页：**总余额 = 充值钱包 + 赠送钱包**，两个分项各自照给。
 * 两条路都出现同一个币种时合并，只在一侧出现的币种也照出。
 * @param balance - 账号服务给出的钱包。
 * @returns `GET /user/balance` 的形状，可直接进 {@link normalize}。
 * @throws {ParseError} 金额不是十进制定点（含展开后仍不合法的形状）。
 */
export function projectAccountBalance(balance: AccountBalance): RawBalanceResponse {
  const toppedUp = walletTotals(balance.wallets)
  const granted = walletTotals(balance.bonusWallets)
  const currencies = [...new Set([...toppedUp.keys(), ...granted.keys()])]
  return {
    // 能读到钱包就说明账号可用；这与 `/user/balance` 的 `is_available` 同义。
    is_available: true,
    balance_infos: currencies.map((currency) => {
      const topped = toppedUp.get(currency) ?? 0n
      const bonus = granted.get(currency) ?? 0n
      return {
        currency,
        total_balance: formatMoney(topped + bonus),
        granted_balance: formatMoney(bonus),
        topped_up_balance: formatMoney(topped),
      }
    }),
  }
}

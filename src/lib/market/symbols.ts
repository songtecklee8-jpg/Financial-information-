import type { AssetClass, Market, ProviderId } from '@/types'
import { CRYPTO_ASSETS, detectCrypto, normalizeSymbol } from '@/lib/universe'

/**
 * 标的解析与跨引擎符号路由。
 *
 * 同一个标的在各家 API 里的写法并不一致（Yahoo 用 BTC-USD、Binance 用 BTCUSDT、
 * CoinGecko 用 bitcoin），本模块把这些差异集中收敛，适配器只拿「已翻译好的符号」。
 */

export interface Instrument {
  /** 终端内部规范符号：AAPL / 1155.KL / BTCUSDT */
  symbol: string
  assetClass: AssetClass
  market: Market
  /** 数字资产基础币种，如 BTC */
  cryptoKey?: string
  /** CoinGecko 币种 id，如 bitcoin */
  cgId?: string
}

export function parseInstrument(input: string): Instrument {
  const symbol = normalizeSymbol(input)
  const crypto = detectCrypto(symbol)
  if (crypto) {
    return { symbol, assetClass: 'crypto', market: 'CRYPTO', cryptoKey: crypto.key, cgId: crypto.cgId }
  }
  const market: Market = symbol.endsWith('.KL') ? 'BURSA' : 'US'
  return { symbol, assetClass: 'equity', market }
}

export function isCryptoInstrument(input: string): boolean {
  return detectCrypto(input) !== null
}

export function cryptoKeyOf(input: string): string | null {
  return detectCrypto(input)?.key ?? null
}

/** Yahoo：加密用 BTC-USD，其余原样 */
export function yahooSymbol(symbol: string): string {
  const key = cryptoKeyOf(symbol)
  return key ? `${key}-USD` : normalizeSymbol(symbol)
}

/** Binance：统一为 BASEUSDT */
export function binanceSymbol(symbol: string): string {
  const key = cryptoKeyOf(symbol)
  return key ? `${key}USDT` : normalizeSymbol(symbol)
}

/** CoinGecko：需要币种 id */
export function coingeckoId(symbol: string): string | null {
  return detectCrypto(symbol)?.cgId ?? null
}

/** Alpha Vantage 数字资产接口需要 symbol + market 两个参数 */
export function alphaVantageCryptoSymbol(symbol: string): { symbol: string; market: string } | null {
  const key = cryptoKeyOf(symbol)
  return key ? { symbol: key, market: 'USD' } : null
}

/** FMP 加密写法为 BTCUSD，股票原样 */
export function fmpSymbol(symbol: string): string {
  const key = cryptoKeyOf(symbol)
  return key ? `${key}USD` : normalizeSymbol(symbol)
}

/** 各引擎最终使用的符号（未特殊说明者与规范符号一致） */
export function toProviderSymbol(symbol: string, provider: ProviderId): string {
  switch (provider) {
    case 'yahoo':
      return yahooSymbol(symbol)
    case 'binance':
      return binanceSymbol(symbol)
    case 'coingecko':
      return coingeckoId(symbol) ?? normalizeSymbol(symbol)
    case 'fmp':
      return fmpSymbol(symbol)
    default:
      return normalizeSymbol(symbol)
  }
}

/** 数字资产在基准数据里的默认展示名 */
export function cryptoSecurityName(symbol: string): string | null {
  const key = cryptoKeyOf(symbol)
  if (!key) return null
  return CRYPTO_ASSETS[key]?.name ?? key
}

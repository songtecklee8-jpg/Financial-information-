/**
 * APEX Terminal — 服务端环境变量读取。
 *
 * 所有 API Key 一律从 Vercel 环境变量读取，严禁在源码中硬编码。
 * 本地开发时可通过 `.env` 或 `vercel dev` 注入同样的变量名。
 */

export interface ServerKeys {
  gemini: string
  finnhub: string
  alpacaKey: string
  alpacaSecret: string
  alphavantage: string
  fmp: string
  twelvedata: string
  tiingo: string
  cronSecret: string
  redisUrl: string
  redisToken: string
}

/** 依次读取多个变量名，返回第一个非空值 */
function read(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function loadKeys(): ServerKeys {
  return {
    gemini: read('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'),
    finnhub: read('FINNHUB_API_KEY'),
    alpacaKey: read('ALPACA_API_KEY', 'ALPACA_API_KEY_ID', 'APCA_API_KEY_ID'),
    alpacaSecret: read(
      'ALPACA_API_SECRET',
      'ALPACA_SECRET_KEY',
      'ALPACA_API_SECRET_KEY',
      'APCA_API_SECRET_KEY',
    ),
    alphavantage: read('ALPHAVANTAGE_API_KEY', 'ALPHA_VANTAGE_API_KEY'),
    fmp: read('FMP_API_KEY'),
    twelvedata: read('TWELVEDATA_API_KEY', 'TWELVE_DATA_API_KEY'),
    tiingo: read('TIINGO_API_KEY'),
    cronSecret: read('CRON_SECRET'),
    redisUrl: read('UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'),
    redisToken: read('UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN'),
  }
}

export type WatchCategory = 'us' | 'bursa' | 'crypto'

export interface WatchItem {
  symbol: string
  category: WatchCategory
  /** 计价货币 */
  currency: 'USD' | 'MYR'
}

/** 自选池默认值（可由 WATCHLIST_US / WATCHLIST_KL / WATCHLIST_CRYPTO 覆盖） */
export const DEFAULT_WATCHLIST: Record<WatchCategory, string[]> = {
  us: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'JPM', 'XOM', 'AMD'],
  bursa: ['1155.KL', '1295.KL', '1023.KL', '5347.KL', '5225.KL', '6033.KL'],
  crypto: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'],
}

function parseList(name: string, fallback: string[]): string[] {
  const raw = process.env[name]
  if (!raw) return fallback
  const list = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
  return list.length > 0 ? list : fallback
}

/** 组装后台需要同步的自选池（含市场与计价货币） */
export function loadWatchlist(): WatchItem[] {
  const us = parseList('WATCHLIST_US', DEFAULT_WATCHLIST.us)
  const bursa = parseList('WATCHLIST_KL', DEFAULT_WATCHLIST.bursa)
  const crypto = parseList('WATCHLIST_CRYPTO', DEFAULT_WATCHLIST.crypto)

  return [
    ...us.map((symbol) => ({ symbol, category: 'us' as const, currency: 'USD' as const })),
    ...bursa.map((symbol) => ({ symbol, category: 'bursa' as const, currency: 'MYR' as const })),
    ...crypto.map((symbol) => ({ symbol, category: 'crypto' as const, currency: 'USD' as const })),
  ]
}

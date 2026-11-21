/**
 * APEX Research — 服务端环境变量读取。
 *
 * 所有 API Key 一律优先从 Vercel / Node 服务端环境变量读取，严禁在源码中硬编码。
 */

export interface ServerKeys {
  gemini: string
  geminiKeys: string[]
  groq: string
  openrouter: string
  cerebras: string
  nvidia: string
  cloudflareAccountId: string
  cloudflareApiToken: string
  mistral: string
  cohere: string
  custom1Url: string
  custom1Key: string
  custom1Model: string
  custom2Url: string
  custom2Key: string
  custom2Model: string
  finnhub: string
  alpacaKey: string
  alpacaSecret: string
  alphavantage: string
  fmp: string
  twelvedata: string
  tiingo: string
  newsData: string
  moomooKey: string
  moomooSecret: string
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

function collectUnique(...values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const val = raw.trim()
    if (!val || seen.has(val)) continue
    seen.add(val)
    out.push(val)
  }
  return out
}

export function loadKeys(): ServerKeys {
  const g1 = read('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY')
  const g2 = read('GEMINI_API_KEY_2')
  const g3 = read('GEMINI_API_KEY_3')
  const geminiKeys = collectUnique(g1, g2, g3)

  return {
    gemini: geminiKeys[0] ?? '',
    geminiKeys,
    groq: read('GROQ_API_KEY'),
    openrouter: read('OPENROUTER_API_KEY'),
    cerebras: read('CEREBRAS_API_KEY'),
    nvidia: read('NVIDIA_API_KEY', 'NVIDIA_NIM_API_KEY'),
    cloudflareAccountId: read('CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID'),
    cloudflareApiToken: read('CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN'),
    mistral: read('MISTRAL_API_KEY'),
    cohere: read('COHERE_API_KEY'),
    custom1Url: read('CUSTOM_OPENAI_1_URL'),
    custom1Key: read('CUSTOM_OPENAI_1_KEY'),
    custom1Model: read('CUSTOM_OPENAI_1_MODEL'),
    custom2Url: read('CUSTOM_OPENAI_2_URL'),
    custom2Key: read('CUSTOM_OPENAI_2_KEY'),
    custom2Model: read('CUSTOM_OPENAI_2_MODEL'),
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
    newsData: read('NEWS_DATA_API_KEY', 'NEWSDATA_API_KEY'),
    moomooKey: read('MOOMOO_API_KEY', 'MOOMOO_APP_ID'),
    moomooSecret: read('MOOMOO_SECRET_KEY', 'MOOMOO_SECRET', 'MOOMOO_API_SECRET'),
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

/**
 * APEX Terminal — 后台多引擎行情抓取（服务端，无 CORS 限制）。
 *
 * 覆盖：Finnhub / Alpaca / Yahoo Finance（直连行情代理）/ Binance 四大引擎，
 * 按市场类别（美股 / 马股 .KL / 加密资产）编排各自的降级链，任一引擎失败自动顺延。
 */

import type { ServerKeys, WatchItem } from './env.js'
import type { ServerQuote } from './types.js'

const TIMEOUT_MS = 9000

async function fetchJson(url: string, init: RequestInit = {}, timeout = TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'application/json,text/plain,*/*',
        ...(init.headers ?? {}),
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()) as unknown
  } finally {
    clearTimeout(timer)
  }
}

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

// ---------------------------------------------------------------------------
// 各引擎适配
// ---------------------------------------------------------------------------

/** Binance：加密资产（免 Key） */
async function binanceQuote(symbol: string): Promise<ServerQuote> {
  const data = rec(await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}USDT`))
  const price = num(data.lastPrice)
  const previousClose = num(data.prevClosePrice, price)
  if (!(price > 0)) throw new Error('Binance 无有效报价')
  return {
    symbol,
    name: symbol,
    price,
    previousClose,
    change: price - previousClose,
    changePercent: num(data.priceChangePercent, previousClose ? ((price - previousClose) / previousClose) * 100 : 0),
    open: num(data.openPrice, price),
    dayHigh: num(data.highPrice, price),
    dayLow: num(data.lowPrice, price),
    volume: num(data.volume),
    currency: 'USD',
    market: 'CRYPTO',
    provider: 'binance',
    updatedAt: new Date().toISOString(),
    origin: 'live',
  }
}

/** Yahoo Finance：通用兜底（美股 / 马股 / 加密，免 Key） */
async function yahooQuote(symbol: string, category: WatchItem['category']): Promise<ServerQuote> {
  const yahooSymbol = category === 'crypto' ? `${symbol}-USD` : symbol
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=5d&interval=1d`
  const data = rec(await fetchJson(url))
  const chart = rec(data.chart)
  const results = Array.isArray(chart.result) ? chart.result : []
  const meta = rec(rec(results[0]).meta)
  const price = num(meta.regularMarketPrice)
  if (!(price > 0)) throw new Error('Yahoo 无有效报价')
  const previousClose = num(meta.chartPreviousClose, num(meta.previousClose, price))
  const currency = String(meta.currency ?? (category === 'bursa' ? 'MYR' : 'USD')) === 'MYR' ? 'MYR' : 'USD'
  return {
    symbol,
    name: String(meta.shortName ?? meta.longName ?? symbol),
    price,
    previousClose,
    change: price - previousClose,
    changePercent: previousClose ? ((price - previousClose) / previousClose) * 100 : 0,
    open: num(meta.regularMarketDayHigh, price),
    dayHigh: num(meta.regularMarketDayHigh, price),
    dayLow: num(meta.regularMarketDayLow, price),
    volume: num(meta.regularMarketVolume),
    currency,
    market: category === 'bursa' ? 'BURSA' : category === 'crypto' ? 'CRYPTO' : 'US',
    provider: 'yahoo',
    updatedAt: new Date().toISOString(),
    origin: 'live',
  }
}

/** Finnhub：美股实时报价（需 Key） */
async function finnhubQuote(symbol: string, key: string): Promise<ServerQuote> {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`
  const data = rec(await fetchJson(url))
  const price = num(data.c)
  const previousClose = num(data.pc, price)
  if (!(price > 0)) throw new Error('Finnhub 无有效报价')
  return {
    symbol,
    name: symbol,
    price,
    previousClose,
    change: num(data.d, price - previousClose),
    changePercent: num(data.dp, previousClose ? ((price - previousClose) / previousClose) * 100 : 0),
    open: num(data.o, price),
    dayHigh: num(data.h, price),
    dayLow: num(data.l, price),
    volume: 0,
    currency: 'USD',
    market: 'US',
    provider: 'finnhub',
    updatedAt: new Date().toISOString(),
    origin: 'live',
  }
}

/** Alpaca：美股快照（需 Key + Secret） */
async function alpacaQuote(symbol: string, key: string, secret: string): Promise<ServerQuote> {
  const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/snapshot?feed=iex`
  const data = rec(
    await fetchJson(url, {
      headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
    }),
  )
  const latest = rec(data.latestTrade)
  const prevBar = rec(data.prevDailyBar)
  const daily = rec(data.dailyBar)
  const price = num(latest.p)
  const previousClose = num(prevBar.c, price)
  if (!(price > 0)) throw new Error('Alpaca 无有效报价')
  return {
    symbol,
    name: symbol,
    price,
    previousClose,
    change: price - previousClose,
    changePercent: previousClose ? ((price - previousClose) / previousClose) * 100 : 0,
    open: num(daily.o, price),
    dayHigh: num(daily.h, price),
    dayLow: num(daily.l, price),
    volume: num(daily.v),
    currency: 'USD',
    market: 'US',
    provider: 'alpaca',
    updatedAt: new Date().toISOString(),
    origin: 'live',
  }
}

// ---------------------------------------------------------------------------
// 调度
// ---------------------------------------------------------------------------

/** 单个标的的引擎降级链 */
async function quoteFor(item: WatchItem, keys: ServerKeys): Promise<ServerQuote | null> {
  const attempts: Array<() => Promise<ServerQuote>> = []

  if (item.category === 'crypto') {
    attempts.push(() => binanceQuote(item.symbol))
    attempts.push(() => yahooQuote(item.symbol, 'crypto'))
  } else if (item.category === 'us') {
    if (keys.finnhub) attempts.push(() => finnhubQuote(item.symbol, keys.finnhub))
    if (keys.alpacaKey && keys.alpacaSecret) {
      attempts.push(() => alpacaQuote(item.symbol, keys.alpacaKey, keys.alpacaSecret))
    }
    attempts.push(() => yahooQuote(item.symbol, 'us'))
  } else {
    attempts.push(() => yahooQuote(item.symbol, 'bursa'))
  }

  for (const attempt of attempts) {
    try {
      return await attempt()
    } catch {
      // 顺延到下一个引擎
    }
  }
  return null
}

/** 并发抓取自选池全部标的的实时行情，返回以 symbol 为键的快照 */
export async function fetchQuotes(
  watchlist: WatchItem[],
  keys: ServerKeys,
): Promise<Record<string, ServerQuote>> {
  const settled = await Promise.all(
    watchlist.map(async (item) => ({ symbol: item.symbol, quote: await quoteFor(item, keys) })),
  )
  const out: Record<string, ServerQuote> = {}
  for (const entry of settled) {
    if (entry.quote) out[entry.symbol] = entry.quote
  }
  return out
}

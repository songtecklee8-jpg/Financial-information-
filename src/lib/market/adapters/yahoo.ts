import type { Candle, IntervalKey, QuoteSnapshot, RangeKey } from '@/types'
import type { ProviderAdapter, ProviderCtx } from '@/lib/market/registry'
import { yahooSymbol } from '@/lib/market/symbols'
import { safeNumber } from '@/lib/format'
import { inferCurrency } from './shared'

/** Yahoo Finance 非官方接口：免 Key，但需经 CORS 代理路由（由 ctx 自动回退） */

const INTERVAL_MAP: Partial<Record<IntervalKey, string>> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '60m',
  '1d': '1d',
  '1w': '1wk',
  '1mo': '1mo',
}

interface YahooMeta {
  currency?: string
  regularMarketPrice?: number
  chartPreviousClose?: number
  previousClose?: number
  regularMarketDayHigh?: number
  regularMarketDayLow?: number
  regularMarketVolume?: number
  fiftyTwoWeekHigh?: number
  fiftyTwoWeekLow?: number
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: YahooMeta
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>
          high?: Array<number | null>
          low?: Array<number | null>
          close?: Array<number | null>
          volume?: Array<number | null>
        }>
      }
    }>
    error?: unknown
  }
}

function chartUrl(symbol: string, range: RangeKey, interval: string): string {
  const sym = yahooSymbol(symbol)
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`
}

function firstResult(data: YahooChartResponse) {
  return data.chart?.result?.[0]
}

function currencyOf(symbol: string, meta: YahooMeta): 'USD' | 'MYR' {
  if (meta.currency === 'MYR') return 'MYR'
  if (meta.currency === 'USD') return 'USD'
  return inferCurrency(symbol)
}

async function fetchCandles(
  symbol: string,
  range: RangeKey,
  interval: IntervalKey,
  ctx: ProviderCtx,
): Promise<Candle[]> {
  const iv = INTERVAL_MAP[interval] ?? '1d'
  const data = await ctx.json<YahooChartResponse>(chartUrl(symbol, range, iv))
  const result = firstResult(data)
  if (!result) return []
  const stamps = result.timestamp ?? []
  const quote = result.indicators?.quote?.[0]
  if (!quote) return []
  const out: Candle[] = []
  for (let i = 0; i < stamps.length; i += 1) {
    const t = stamps[i]
    const o = quote.open?.[i]
    const h = quote.high?.[i]
    const l = quote.low?.[i]
    const c = quote.close?.[i]
    if (t === undefined || o === undefined || o === null || h === undefined || h === null) continue
    if (l === undefined || l === null || c === undefined || c === null) continue
    out.push({ t: t * 1000, o, h, l, c, v: quote.volume?.[i] ?? 0 })
  }
  return out
}

/** 52 周高低兜底：拉一年日线自行计算 */
async function computeYearRange(symbol: string, ctx: ProviderCtx): Promise<{ high: number; low: number } | null> {
  try {
    const data = await ctx.json<YahooChartResponse>(chartUrl(symbol, '1y', '1d'))
    const result = firstResult(data)
    const quote = result?.indicators?.quote?.[0]
    if (!quote) return null
    const highs = (quote.high ?? []).filter((value): value is number => typeof value === 'number')
    const lows = (quote.low ?? []).filter((value): value is number => typeof value === 'number')
    if (highs.length === 0 || lows.length === 0) return null
    return { high: Math.max(...highs), low: Math.min(...lows) }
  } catch {
    return null
  }
}

async function fetchQuote(symbol: string, ctx: ProviderCtx): Promise<QuoteSnapshot> {
  const data = await ctx.json<YahooChartResponse>(chartUrl(symbol, '1d', '1m'))
  const result = firstResult(data)
  const meta = result?.meta ?? {}
  const price = safeNumber(meta.regularMarketPrice)
  const previousClose = safeNumber(meta.chartPreviousClose ?? meta.previousClose)
  let fiftyTwoWeekHigh = meta.fiftyTwoWeekHigh
  let fiftyTwoWeekLow = meta.fiftyTwoWeekLow
  if (fiftyTwoWeekHigh === undefined || fiftyTwoWeekLow === undefined) {
    const fallback = await computeYearRange(symbol, ctx)
    if (fallback) {
      fiftyTwoWeekHigh = fiftyTwoWeekHigh ?? fallback.high
      fiftyTwoWeekLow = fiftyTwoWeekLow ?? fallback.low
    }
  }
  return {
    price,
    previousClose,
    dayHigh: meta.regularMarketDayHigh,
    dayLow: meta.regularMarketDayLow,
    volume: meta.regularMarketVolume,
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
    currency: currencyOf(symbol, meta),
  }
}

export const yahooAdapter: ProviderAdapter = {
  id: 'yahoo',
  quote: fetchQuote,
  candles: fetchCandles,
}

import type { Candle, IntervalKey, QuoteSnapshot, RangeKey } from '@/types'
import type { ProviderAdapter, ProviderCtx } from '@/lib/market/registry'
import { RANGE_META } from '@/lib/market/registry'
import { toProviderSymbol } from '@/lib/market/symbols'
import { ProviderNoKeyError } from '@/lib/market/errors'
import { safeNumber } from '@/lib/format'
import { ensureKey, inferCurrency, toIsoDate } from './shared'

/** Alpaca 仅支持美股，且需要 Key ID + Secret Key 双密钥 */

const TIMEFRAME: Record<IntervalKey, string> = {
  '1m': '1Min',
  '5m': '5Min',
  '15m': '15Min',
  '1h': '1Hour',
  '4h': '4Hour',
  '1d': '1Day',
  '1w': '1Week',
  '1mo': '1Month',
}

function requireCreds(ctx: ProviderCtx): void {
  ensureKey(ctx, 'Alpaca')
  if (!ctx.secretKey.trim()) throw new ProviderNoKeyError('未配置 Alpaca Secret Key')
}

function authHeaders(ctx: ProviderCtx): Record<string, string> {
  return {
    'APCA-API-KEY-ID': ctx.apiKey,
    'APCA-API-SECRET-KEY': ctx.secretKey,
  }
}

const optionalNumber = (value: number | null | undefined): number | undefined =>
  value === null || value === undefined ? undefined : safeNumber(value)

function toMs(value: string | number | undefined): number {
  if (typeof value === 'number') return value
  if (!value) return 0
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

async function fetchQuote(symbol: string, ctx: ProviderCtx): Promise<QuoteSnapshot> {
  requireCreds(ctx)
  const sym = toProviderSymbol(symbol, 'alpaca')
  const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(sym)}/snapshot?feed=iex`
  const data = await ctx.json<{
    latestTrade?: { p?: number }
    prevDailyBar?: { c?: number }
    dailyBar?: { o?: number; h?: number; l?: number; v?: number }
  }>(url, { headers: authHeaders(ctx) })
  return {
    price: safeNumber(data.latestTrade?.p),
    previousClose: safeNumber(data.prevDailyBar?.c),
    open: optionalNumber(data.dailyBar?.o),
    dayHigh: optionalNumber(data.dailyBar?.h),
    dayLow: optionalNumber(data.dailyBar?.l),
    volume: optionalNumber(data.dailyBar?.v),
    currency: inferCurrency(symbol),
  }
}

async function fetchCandles(
  symbol: string,
  range: RangeKey,
  interval: IntervalKey,
  ctx: ProviderCtx,
): Promise<Candle[]> {
  requireCreds(ctx)
  const sym = toProviderSymbol(symbol, 'alpaca')
  const timeframe = TIMEFRAME[interval]
  const now = Date.now()
  const days = RANGE_META[range].days
  const startMs = days > 0 ? now - days * 86_400_000 : 0
  const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(sym)}/bars?timeframe=${timeframe}&start=${toIsoDate(startMs)}&end=${toIsoDate(now)}&limit=10000&adjustment=split&feed=iex&sort=asc`
  const data = await ctx.json<{
    bars?: Array<{ t?: string | number; o?: number; h?: number; l?: number; c?: number; v?: number }>
  }>(url, { headers: authHeaders(ctx) })
  const bars = data.bars ?? []
  return bars.map((bar) => ({
    t: toMs(bar.t),
    o: safeNumber(bar.o),
    h: safeNumber(bar.h),
    l: safeNumber(bar.l),
    c: safeNumber(bar.c),
    v: safeNumber(bar.v),
  }))
}

export const alpacaAdapter: ProviderAdapter = {
  id: 'alpaca',
  quote: fetchQuote,
  candles: fetchCandles,
}

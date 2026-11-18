import type { Candle, IntervalKey, QuoteSnapshot, RangeKey } from '@/types'
import type { ProviderAdapter, ProviderCtx } from '@/lib/market/registry'
import { binanceSymbol, toProviderSymbol } from '@/lib/market/symbols'
import { safeNumber } from '@/lib/format'
import { barCount } from './shared'

/** Binance 公共接口：免 Key，数字资产现货 */

const INTERVAL_MAP: Record<IntervalKey, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1w': '1w',
  '1mo': '1M',
}

const optionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const n = safeNumber(value, Number.NaN)
  return Number.isFinite(n) ? n : undefined
}

async function fetchQuote(symbol: string, ctx: ProviderCtx): Promise<QuoteSnapshot> {
  const sym = binanceSymbol(symbol)
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(sym)}`
  const data = await ctx.json<{
    lastPrice?: string
    prevClosePrice?: string
    openPrice?: string
    highPrice?: string
    lowPrice?: string
    quoteVolume?: string
    closeTime?: number
  }>(url)
  const closeTime = data.closeTime
  return {
    price: safeNumber(data.lastPrice),
    previousClose: safeNumber(data.prevClosePrice),
    open: optionalNumber(data.openPrice),
    dayHigh: optionalNumber(data.highPrice),
    dayLow: optionalNumber(data.lowPrice),
    volume: optionalNumber(data.quoteVolume),
    currency: 'USD',
    updatedAt: closeTime ? new Date(closeTime).toISOString() : undefined,
  }
}

async function fetchCandles(
  symbol: string,
  range: RangeKey,
  interval: IntervalKey,
  ctx: ProviderCtx,
): Promise<Candle[]> {
  const sym = toProviderSymbol(symbol, 'binance')
  const iv = INTERVAL_MAP[interval]
  const limit = Math.min(1000, barCount(range, interval))
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=${iv}&limit=${limit}`
  const rows = await ctx.json<Array<Array<number | string>>>(url)
  return rows.map((row) => ({
    t: safeNumber(row[0]),
    o: safeNumber(row[1]),
    h: safeNumber(row[2]),
    l: safeNumber(row[3]),
    c: safeNumber(row[4]),
    v: safeNumber(row[5]),
  }))
}

export const binanceAdapter: ProviderAdapter = {
  id: 'binance',
  quote: fetchQuote,
  candles: fetchCandles,
}

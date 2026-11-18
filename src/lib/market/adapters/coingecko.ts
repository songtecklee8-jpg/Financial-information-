import type { Candle, IntervalKey, QuoteSnapshot, RangeKey } from '@/types'
import type { ProviderAdapter, ProviderCtx } from '@/lib/market/registry'
import { coingeckoId } from '@/lib/market/symbols'
import { safeNumber } from '@/lib/format'

/** CoinGecko 公共接口：数字资产专用，可选 Demo Key */

const DAYS: Record<RangeKey, number | 'max'> = {
  '1d': 1,
  '5d': 7,
  '1mo': 30,
  '3mo': 90,
  '6mo': 180,
  '1y': 365,
  '2y': 730,
  '5y': 1825,
  '10y': 'max',
  max: 'max',
}

const optionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const n = safeNumber(value, Number.NaN)
  return Number.isFinite(n) ? n : undefined
}

function requireId(symbol: string): string {
  const id = coingeckoId(symbol)
  if (!id) throw new Error('CoinGecko 仅支持数字资产')
  return id
}

function headers(ctx: ProviderCtx): Record<string, string> | undefined {
  return ctx.apiKey.trim() ? { 'x-cg-demo-api-key': ctx.apiKey } : undefined
}

async function fetchQuote(symbol: string, ctx: ProviderCtx): Promise<QuoteSnapshot> {
  const id = requireId(symbol)
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`
  const data = await ctx.json<{
    market_data?: {
      current_price?: Record<string, number>
      price_change_percentage_24h?: number
      market_cap?: Record<string, number>
      total_volume?: Record<string, number>
      ath?: Record<string, number>
      atl?: Record<string, number>
    }
  }>(url, { headers: headers(ctx) })
  const market = data.market_data ?? {}
  const price = safeNumber(market.current_price?.['usd'])
  const changePct = optionalNumber(market.price_change_percentage_24h)
  const previousClose =
    changePct !== undefined && Number.isFinite(changePct) && changePct !== -100
      ? price / (1 + changePct / 100)
      : price
  return {
    price,
    previousClose,
    fiftyTwoWeekHigh: optionalNumber(market.ath?.['usd']),
    fiftyTwoWeekLow: optionalNumber(market.atl?.['usd']),
    marketCap: optionalNumber(market.market_cap?.['usd']),
    volume: optionalNumber(market.total_volume?.['usd']),
    currency: 'USD',
  }
}

async function fetchCandles(
  symbol: string,
  range: RangeKey,
  _interval: IntervalKey,
  ctx: ProviderCtx,
): Promise<Candle[]> {
  const id = requireId(symbol)
  const days = DAYS[range]
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${days}`
  const rows = await ctx.json<Array<[number, number, number, number, number]>>(url, { headers: headers(ctx) })
  return rows.map((row) => ({
    t: safeNumber(row[0]),
    o: safeNumber(row[1]),
    h: safeNumber(row[2]),
    l: safeNumber(row[3]),
    c: safeNumber(row[4]),
    v: 0,
  }))
}

export const coingeckoAdapter: ProviderAdapter = {
  id: 'coingecko',
  quote: fetchQuote,
  candles: fetchCandles,
}

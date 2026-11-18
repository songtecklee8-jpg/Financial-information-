import type { Candle, FundamentalsPatch, IntervalKey, QuoteSnapshot, RangeKey } from '@/types'
import type { ProviderAdapter, ProviderCtx } from '@/lib/market/registry'
import { rangeStartMs } from '@/lib/market/registry'
import { toProviderSymbol } from '@/lib/market/symbols'
import { safeNumber } from '@/lib/format'
import { ensureKey, inferCurrency } from './shared'

/** FMP 日内历史图表的周期写法 */
const INTRADAY: Partial<Record<IntervalKey, string>> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '1hour',
  '4h': '4hour',
}

interface FmpBar {
  date?: string
  open?: number
  high?: number
  low?: number
  close?: number
  volume?: number
}

const optionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const n = safeNumber(value, Number.NaN)
  return Number.isFinite(n) ? n : undefined
}

/** FMP 时间字符串（"2024-01-02" 或 "2024-01-02 09:30:00"）→ 毫秒 */
function parseTime(value: string | undefined): number {
  if (!value) return 0
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const iso = /Z$|[+-]\d\d:?\d\d$/.test(normalized) ? normalized : `${normalized}Z`
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function toCandle(bar: FmpBar): Candle {
  return {
    t: parseTime(bar.date),
    o: safeNumber(bar.open),
    h: safeNumber(bar.high),
    l: safeNumber(bar.low),
    c: safeNumber(bar.close),
    v: safeNumber(bar.volume),
  }
}

async function fetchQuote(symbol: string, ctx: ProviderCtx): Promise<QuoteSnapshot> {
  const key = ensureKey(ctx, 'FMP')
  const sym = toProviderSymbol(symbol, 'fmp')
  const url = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(sym)}?apikey=${encodeURIComponent(key)}`
  const rows = await ctx.json<
    Array<{
      price?: number
      previousClose?: number
      open?: number
      dayHigh?: number
      dayLow?: number
      volume?: number
      yearHigh?: number
      yearLow?: number
      marketCap?: number
    }>
  >(url)
  const row = rows[0]
  if (!row) throw new Error('该标的无报价')
  return {
    price: safeNumber(row.price),
    previousClose: safeNumber(row.previousClose),
    open: optionalNumber(row.open),
    dayHigh: optionalNumber(row.dayHigh),
    dayLow: optionalNumber(row.dayLow),
    volume: optionalNumber(row.volume),
    fiftyTwoWeekHigh: optionalNumber(row.yearHigh),
    fiftyTwoWeekLow: optionalNumber(row.yearLow),
    marketCap: optionalNumber(row.marketCap),
    currency: inferCurrency(symbol),
  }
}

async function fetchCandles(
  symbol: string,
  range: RangeKey,
  interval: IntervalKey,
  ctx: ProviderCtx,
): Promise<Candle[]> {
  const key = ensureKey(ctx, 'FMP')
  const sym = toProviderSymbol(symbol, 'fmp')
  const intraday = INTRADAY[interval]
  let rows: FmpBar[]
  if (intraday) {
    rows = await ctx.json<FmpBar[]>(
      `https://financialmodelingprep.com/api/v3/historical-chart/${intraday}/${encodeURIComponent(sym)}?apikey=${encodeURIComponent(key)}`,
    )
  } else {
    const payload = await ctx.json<{ historical?: FmpBar[] }>(
      `https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(sym)}?apikey=${encodeURIComponent(key)}`,
    )
    rows = payload.historical ?? []
  }
  const start = rangeStartMs(range)
  return rows
    .map(toCandle)
    .filter((candle) => candle.t > 0 && candle.t >= start)
    .sort((a, b) => a.t - b.t)
}

async function fetchFundamentals(symbol: string, ctx: ProviderCtx): Promise<FundamentalsPatch> {
  const key = ensureKey(ctx, 'FMP')
  const sym = toProviderSymbol(symbol, 'fmp')
  const base = `https://financialmodelingprep.com/api/v3`
  const query = `?apikey=${encodeURIComponent(key)}`
  const [metrics, ratios, profiles] = await Promise.all([
    ctx.json<Array<Record<string, unknown>>>(`${base}/key-metrics-ttm/${encodeURIComponent(sym)}${query}`),
    ctx.json<Array<Record<string, unknown>>>(`${base}/ratios-ttm/${encodeURIComponent(sym)}${query}`),
    ctx.json<Array<Record<string, unknown>>>(`${base}/profile/${encodeURIComponent(sym)}${query}`),
  ])
  const km = metrics[0] ?? {}
  const ratio = ratios[0] ?? {}
  const profile = profiles[0] ?? {}
  const patch: FundamentalsPatch = {}
  const assign = (field: keyof FundamentalsPatch, value: number | undefined): void => {
    if (value !== undefined) patch[field] = value
  }
  assign('peTTM', optionalNumber(km['peRatioTTM']) ?? optionalNumber(ratio['priceToEarningsRatioTTM']))
  assign('pb', optionalNumber(km['pbRatioTTM']) ?? optionalNumber(ratio['priceToBookRatioTTM']))
  assign('roe', optionalNumber(km['returnOnEquityTTM']))
  assign('grossMargin', optionalNumber(ratio['grossProfitMarginTTM']))
  assign('netMargin', optionalNumber(km['netProfitMarginTTM']) ?? optionalNumber(ratio['netProfitMarginTTM']))
  assign('dividendYield', optionalNumber(ratio['dividendYieldTTM']))
  assign('dividendPerShare', optionalNumber(ratio['dividendPerShareTTM']))
  assign('payoutRatio', optionalNumber(ratio['payoutRatioTTM']))
  assign('currentRatio', optionalNumber(km['currentRatioTTM']) ?? optionalNumber(ratio['currentRatioTTM']))
  assign(
    'debtToEquity',
    optionalNumber(km['debtToEquityTTM']) ?? optionalNumber(ratio['debtToEquityRatioTTM']),
  )
  assign('eps', optionalNumber(km['netIncomePerShareTTM']))
  assign('bookValuePerShare', optionalNumber(km['bookValuePerShareTTM']))
  assign('fcfYield', optionalNumber(km['freeCashFlowYieldTTM']))
  assign('sharesOutstanding', optionalNumber(profile['sharesOutstanding']))
  return patch
}

export const fmpAdapter: ProviderAdapter = {
  id: 'fmp',
  quote: fetchQuote,
  candles: fetchCandles,
  fundamentals: fetchFundamentals,
}

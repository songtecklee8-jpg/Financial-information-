import type { Candle, FundamentalsPatch, IntervalKey, QuoteSnapshot, RangeKey } from '@/types'
import type { ProviderAdapter, ProviderCtx } from '@/lib/market/registry'
import { rangeStartMs } from '@/lib/market/registry'
import { alphaVantageCryptoSymbol, toProviderSymbol } from '@/lib/market/symbols'
import { ProviderRateLimitError } from '@/lib/market/errors'
import { safeNumber } from '@/lib/format'
import { ensureKey, inferCurrency } from './shared'

const BASE = 'https://www.alphavantage.co/query'

const INTRADAY: Partial<Record<IntervalKey, string>> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '60min',
}

const optionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const n = safeNumber(value, Number.NaN)
  return Number.isFinite(n) ? n : undefined
}

/** AV 用 Note / Information 字段表达限流或配额耗尽 */
function guardRateLimit(payload: Record<string, unknown>, url: string): void {
  const note = payload['Note'] ?? payload['Information']
  if (typeof note === 'string' && note.length > 0) throw new ProviderRateLimitError(url, note)
}

function parseTime(value: string): number {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const iso = /Z$|[+-]\d\d:?\d\d$/.test(normalized) ? normalized : `${normalized}Z`
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/** 数字资产接口的字段名带币种后缀（如 "1a. open (USD)"），按前缀读取 */
function digField(row: Record<string, unknown>, prefix: string): number | undefined {
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith(prefix)) {
      const n = optionalNumber(value)
      if (n !== undefined) return n
    }
  }
  return undefined
}

function parseSeries(
  entries: Record<string, Record<string, unknown>>,
  start: number,
): Candle[] {
  const out: Candle[] = []
  for (const [stamp, row] of Object.entries(entries)) {
    const t = parseTime(stamp)
    if (t <= 0 || t < start) continue
    const o = digField(row, '1')
    const h = digField(row, '2')
    const l = digField(row, '3')
    const c = digField(row, '4')
    if (o === undefined || h === undefined || l === undefined || c === undefined) continue
    out.push({ t, o, h, l, c, v: digField(row, '5') ?? 0 })
  }
  return out.sort((a, b) => a.t - b.t)
}

async function fetchQuote(symbol: string, ctx: ProviderCtx): Promise<QuoteSnapshot> {
  const key = ensureKey(ctx, 'Alpha Vantage')
  const crypto = alphaVantageCryptoSymbol(symbol)
  if (crypto) {
    const url = `${BASE}?function=DIGITAL_CURRENCY_DAILY&symbol=${encodeURIComponent(crypto.symbol)}&market=${crypto.market}&apikey=${encodeURIComponent(key)}`
    const data = await ctx.json<Record<string, unknown>>(url)
    guardRateLimit(data, url)
    const series = (data['Time Series (Digital Currency Daily)'] ?? {}) as Record<string, Record<string, unknown>>
    const stamps = Object.keys(series).sort().reverse()
    const latestKey = stamps[0]
    const prevKey = stamps[1]
    const latest = latestKey ? series[latestKey] : undefined
    const prev = prevKey ? series[prevKey] : undefined
    const price = latest ? digField(latest, '4') ?? 0 : 0
    const previousClose = prev ? digField(prev, '4') ?? price : price
    return { price, previousClose, currency: 'USD' }
  }
  const sym = toProviderSymbol(symbol, 'alphavantage')
  const url = `${BASE}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(key)}`
  const data = await ctx.json<Record<string, unknown>>(url)
  guardRateLimit(data, url)
  const quote = (data['Global Quote'] ?? {}) as Record<string, unknown>
  return {
    price: safeNumber(quote['05. price']),
    previousClose: safeNumber(quote['08. previous close']),
    open: optionalNumber(quote['02. open']),
    dayHigh: optionalNumber(quote['03. high']),
    dayLow: optionalNumber(quote['04. low']),
    volume: optionalNumber(quote['06. volume']),
    currency: inferCurrency(symbol),
  }
}

async function fetchCandles(
  symbol: string,
  range: RangeKey,
  interval: IntervalKey,
  ctx: ProviderCtx,
): Promise<Candle[]> {
  const key = ensureKey(ctx, 'Alpha Vantage')
  const start = rangeStartMs(range)
  const crypto = alphaVantageCryptoSymbol(symbol)
  if (crypto) {
    const fn =
      interval === '1w'
        ? 'DIGITAL_CURRENCY_WEEKLY'
        : interval === '1mo'
          ? 'DIGITAL_CURRENCY_MONTHLY'
          : 'DIGITAL_CURRENCY_DAILY'
    const url = `${BASE}?function=${fn}&symbol=${encodeURIComponent(crypto.symbol)}&market=${crypto.market}&apikey=${encodeURIComponent(key)}`
    const data = await ctx.json<Record<string, unknown>>(url)
    guardRateLimit(data, url)
    const label = fn === 'DIGITAL_CURRENCY_WEEKLY' ? 'Weekly' : fn === 'DIGITAL_CURRENCY_MONTHLY' ? 'Monthly' : 'Daily'
    const series = (data[`Time Series (Digital Currency ${label})`] ?? {}) as Record<string, Record<string, unknown>>
    return parseSeries(series, start)
  }
  const sym = toProviderSymbol(symbol, 'alphavantage')
  const intraday = INTRADAY[interval]
  let url: string
  let seriesKey: string
  if (intraday) {
    url = `${BASE}?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(sym)}&interval=${intraday}&outputsize=full&apikey=${encodeURIComponent(key)}`
    seriesKey = `Time Series (${intraday})`
  } else if (interval === '1w') {
    url = `${BASE}?function=TIME_SERIES_WEEKLY&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(key)}`
    seriesKey = 'Weekly Time Series'
  } else if (interval === '1mo') {
    url = `${BASE}?function=TIME_SERIES_MONTHLY&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(key)}`
    seriesKey = 'Monthly Time Series'
  } else {
    url = `${BASE}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(sym)}&outputsize=full&apikey=${encodeURIComponent(key)}`
    seriesKey = 'Time Series (Daily)'
  }
  const data = await ctx.json<Record<string, unknown>>(url)
  guardRateLimit(data, url)
  const series = (data[seriesKey] ?? {}) as Record<string, Record<string, unknown>>
  return parseSeries(series, start)
}

async function fetchFundamentals(symbol: string, ctx: ProviderCtx): Promise<FundamentalsPatch> {
  const key = ensureKey(ctx, 'Alpha Vantage')
  const sym = toProviderSymbol(symbol, 'alphavantage')
  const url = `${BASE}?function=OVERVIEW&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(key)}`
  const data = await ctx.json<Record<string, unknown>>(url)
  guardRateLimit(data, url)
  const patch: FundamentalsPatch = {}
  const assign = (field: keyof FundamentalsPatch, source: string): void => {
    const value = optionalNumber(data[source])
    if (value !== undefined) patch[field] = value
  }
  assign('peTTM', 'PERatio')
  assign('pb', 'PriceToBookRatio')
  assign('peg', 'PEGRatio')
  assign('evEbitda', 'EVToEBITDA')
  assign('dividendYield', 'DividendYield')
  assign('dividendPerShare', 'DividendPerShare')
  assign('eps', 'EPS')
  assign('bookValuePerShare', 'BookValue')
  assign('ebitda', 'EBITDA')
  assign('revenueTTM', 'RevenueTTM')
  assign('freeCashFlow', 'FreeCashFlow')
  assign('netMargin', 'ProfitMargin')
  assign('sharesOutstanding', 'SharesOutstanding')
  assign('currentRatio', 'CurrentRatio')
  assign('debtToEquity', 'DebtToEquity')
  assign('roe', 'ReturnOnEquityTTM')
  return patch
}

export const alphavantageAdapter: ProviderAdapter = {
  id: 'alphavantage',
  quote: fetchQuote,
  candles: fetchCandles,
  fundamentals: fetchFundamentals,
}

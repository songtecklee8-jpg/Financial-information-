import type { Candle, FundamentalsPatch, IntervalKey, QuoteSnapshot, RangeKey } from '@/types'
import type { ProviderAdapter, ProviderCtx } from '@/lib/market/registry'
import { toProviderSymbol } from '@/lib/market/symbols'
import { ProviderRateLimitError } from '@/lib/market/errors'
import { safeNumber } from '@/lib/format'
import { barCount, ensureKey, inferCurrency } from './shared'

const BASE = 'https://api.twelvedata.com'

const INTERVAL_MAP: Record<IntervalKey, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '1h',
  '4h': '4h',
  '1d': '1day',
  '1w': '1week',
  '1mo': '1month',
}

const optionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const n = safeNumber(value, Number.NaN)
  return Number.isFinite(n) ? n : undefined
}

/** Twelve Data 出错时返回 {code, message, status:'error'}；429 视作限流 */
function guardError(payload: { code?: number | string; message?: string; status?: string }, url: string): void {
  if (payload.status !== 'error') return
  const code = typeof payload.code === 'string' ? Number.parseInt(payload.code, 10) : payload.code
  if (code === 429) throw new ProviderRateLimitError(url, payload.message)
  throw new Error(payload.message ?? 'Twelve Data 请求失败')
}

function pick(source: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  if (!source) return undefined
  for (const key of keys) {
    const value = optionalNumber(source[key])
    if (value !== undefined) return value
  }
  return undefined
}

async function fetchQuote(symbol: string, ctx: ProviderCtx): Promise<QuoteSnapshot> {
  const key = ensureKey(ctx, 'Twelve Data')
  const sym = toProviderSymbol(symbol, 'twelvedata')
  const url = `${BASE}/quote?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(key)}`
  const data = await ctx.json<{
    code?: number | string
    message?: string
    status?: string
    price?: string
    previous_close?: string
    open?: string
    high?: string
    low?: string
    volume?: string
    fifty_two_week?: { high?: string; low?: string }
  }>(url)
  guardError(data, url)
  return {
    price: safeNumber(data.price),
    previousClose: safeNumber(data.previous_close),
    open: optionalNumber(data.open),
    dayHigh: optionalNumber(data.high),
    dayLow: optionalNumber(data.low),
    volume: optionalNumber(data.volume),
    fiftyTwoWeekHigh: optionalNumber(data.fifty_two_week?.high),
    fiftyTwoWeekLow: optionalNumber(data.fifty_two_week?.low),
    currency: inferCurrency(symbol),
  }
}

async function fetchCandles(
  symbol: string,
  range: RangeKey,
  interval: IntervalKey,
  ctx: ProviderCtx,
): Promise<Candle[]> {
  const key = ensureKey(ctx, 'Twelve Data')
  const sym = toProviderSymbol(symbol, 'twelvedata')
  const iv = INTERVAL_MAP[interval]
  const outputsize = barCount(range, interval)
  const url = `${BASE}/time_series?symbol=${encodeURIComponent(sym)}&interval=${iv}&outputsize=${outputsize}&apikey=${encodeURIComponent(key)}&format=JSON`
  const data = await ctx.json<{
    code?: number | string
    message?: string
    status?: string
    values?: Array<{
      datetime?: string
      open?: string
      high?: string
      low?: string
      close?: string
      volume?: string
    }>
  }>(url)
  guardError(data, url)
  const values = data.values ?? []
  return values
    .map((row) => {
      const raw = row.datetime ?? ''
      const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
      const iso = /Z$/.test(normalized) ? normalized : `${normalized}Z`
      return {
        t: new Date(iso).getTime(),
        o: safeNumber(row.open),
        h: safeNumber(row.high),
        l: safeNumber(row.low),
        c: safeNumber(row.close),
        v: safeNumber(row.volume),
      }
    })
    .filter((candle) => Number.isFinite(candle.t) && candle.t > 0)
    .sort((a, b) => a.t - b.t)
}

async function fetchFundamentals(symbol: string, ctx: ProviderCtx): Promise<FundamentalsPatch> {
  const key = ensureKey(ctx, 'Twelve Data')
  const sym = toProviderSymbol(symbol, 'twelvedata')
  const url = `${BASE}/statistics?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(key)}`
  const data = await ctx.json<{
    code?: number | string
    message?: string
    status?: string
    statistics?: {
      valuations_metrics?: Record<string, unknown>
      financials?: Record<string, unknown>
      stock_statistics?: Record<string, unknown>
      dividends_and_yields?: Record<string, unknown>
    }
  }>(url)
  guardError(data, url)
  const stats = data.statistics ?? {}
  const valuations = stats.valuations_metrics
  const financials = stats.financials
  const stockStats = stats.stock_statistics
  const dividends = stats.dividends_and_yields
  const patch: FundamentalsPatch = {}
  const assign = (field: keyof FundamentalsPatch, value: number | undefined): void => {
    if (value !== undefined) patch[field] = value
  }
  assign('peTTM', pick(valuations, 'trailing_pe'))
  assign('forwardEps', pick(valuations, 'forward_pe'))
  assign('peg', pick(valuations, 'peg_ratio'))
  assign('pb', pick(valuations, 'price_to_book_mrq'))
  assign('evEbitda', pick(valuations, 'enterprise_to_ebitda'))
  assign('sharesOutstanding', pick(stockStats, 'shares_outstanding'))
  assign('dividendYield', pick(dividends, 'forward_annual_dividend_yield'))
  assign('dividendPerShare', pick(dividends, 'forward_annual_dividend_rate'))
  assign('roe', pick(financials, 'return_on_equity_ttm', 'return_on_equity'))
  assign('grossMargin', pick(financials, 'gross_margin_ttm'))
  assign('netMargin', pick(financials, 'net_margin_ttm'))
  assign('currentRatio', pick(financials, 'current_ratio_mrq', 'current_ratio'))
  assign('debtToEquity', pick(financials, 'total_debt_to_equity_mrq', 'total_debt_to_equity'))
  assign('ebitda', pick(financials, 'ebitda'))
  assign('revenueTTM', pick(financials, 'revenue_ttm'))
  assign('eps', pick(financials, 'eps_ttm'))
  assign('bookValuePerShare', pick(financials, 'book_value_per_share_mrq'))
  return patch
}

export const twelvedataAdapter: ProviderAdapter = {
  id: 'twelvedata',
  quote: fetchQuote,
  candles: fetchCandles,
  fundamentals: fetchFundamentals,
}

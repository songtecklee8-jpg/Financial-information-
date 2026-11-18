import type { Candle, FundamentalsPatch, IntervalKey, QuoteSnapshot, RangeKey } from '@/types'
import type { ProviderAdapter, ProviderCtx } from '@/lib/market/registry'
import { RANGE_META } from '@/lib/market/registry'
import { toProviderSymbol } from '@/lib/market/symbols'
import { safeNumber } from '@/lib/format'
import { ensureKey, inferCurrency } from './shared'

const RESOLUTION: Partial<Record<IntervalKey, string>> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '1d': 'D',
  '1w': 'W',
  '1mo': 'M',
}

/** 存在即返回数字，缺失返回 undefined（用于「只写有值字段」） */
const optionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const n = safeNumber(value, Number.NaN)
  return Number.isFinite(n) ? n : undefined
}

async function fetchQuote(symbol: string, ctx: ProviderCtx): Promise<QuoteSnapshot> {
  const key = ensureKey(ctx, 'Finnhub')
  const sym = toProviderSymbol(symbol, 'finnhub')
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(key)}`
  const data = await ctx.json<{
    c?: number
    pc?: number
    o?: number
    h?: number
    l?: number
    t?: number
  }>(url)
  const ts = optionalNumber(data.t)
  return {
    price: safeNumber(data.c),
    previousClose: safeNumber(data.pc),
    open: optionalNumber(data.o),
    dayHigh: optionalNumber(data.h),
    dayLow: optionalNumber(data.l),
    currency: inferCurrency(symbol),
    updatedAt: ts !== undefined && ts > 0 ? new Date(ts * 1000).toISOString() : undefined,
  }
}

async function fetchCandles(
  symbol: string,
  range: RangeKey,
  interval: IntervalKey,
  ctx: ProviderCtx,
): Promise<Candle[]> {
  const key = ensureKey(ctx, 'Finnhub')
  const sym = toProviderSymbol(symbol, 'finnhub')
  const resolution = RESOLUTION[interval] ?? 'D'
  const toSec = Math.floor(Date.now() / 1000)
  const days = RANGE_META[range].days
  const fromSec = days > 0 ? toSec - days * 86_400 : 0
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(sym)}&resolution=${resolution}&from=${fromSec}&to=${toSec}&token=${encodeURIComponent(key)}`
  const data = await ctx.json<{
    s?: string
    t?: number[]
    o?: number[]
    h?: number[]
    l?: number[]
    c?: number[]
    v?: number[]
  }>(url)
  if (data.s !== 'ok') return []
  const t = data.t ?? []
  const o = data.o ?? []
  const h = data.h ?? []
  const l = data.l ?? []
  const c = data.c ?? []
  const v = data.v ?? []
  const out: Candle[] = []
  for (let i = 0; i < t.length; i += 1) {
    const stamp = t[i]
    if (stamp === undefined) continue
    out.push({
      t: stamp * 1000,
      o: safeNumber(o[i]),
      h: safeNumber(h[i]),
      l: safeNumber(l[i]),
      c: safeNumber(c[i]),
      v: safeNumber(v[i]),
    })
  }
  return out
}

async function fetchFundamentals(symbol: string, ctx: ProviderCtx): Promise<FundamentalsPatch> {
  const key = ensureKey(ctx, 'Finnhub')
  const sym = toProviderSymbol(symbol, 'finnhub')
  const [metricRes, profileRes] = await Promise.all([
    ctx.json<{ metric?: Record<string, unknown> }>(
      `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(sym)}&metric=all&token=${encodeURIComponent(key)}`,
    ),
    ctx.json<{ shareOutstanding?: number }>(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(key)}`,
    ),
  ])
  const metric = metricRes.metric ?? {}
  const patch: FundamentalsPatch = {}
  const assign = (field: keyof FundamentalsPatch, value: number | undefined): void => {
    if (value !== undefined) patch[field] = value
  }
  assign('peTTM', optionalNumber(metric['ttmPe']) ?? optionalNumber(metric['peTTM']))
  assign('pb', optionalNumber(metric['pbAnnual']))
  assign('roe', optionalNumber(metric['roeTTM']))
  assign('grossMargin', optionalNumber(metric['grossMarginTTM']))
  assign('netMargin', optionalNumber(metric['netProfitMarginTTM']))
  assign('dividendYield', optionalNumber(metric['dividendYieldIndicatedAnnual']))
  assign('epsGrowth5y', optionalNumber(metric['epsGrowth5Y']))
  assign('currentRatio', optionalNumber(metric['currentRatioAnnual']))
  assign('debtToEquity', optionalNumber(metric['totalDebt/totalEquityAnnual']))
  assign('sharesOutstanding', optionalNumber(profileRes.shareOutstanding))
  assign('dividendPerShare', optionalNumber(metric['dividendPerShareTTM']))
  return patch
}

export const finnhubAdapter: ProviderAdapter = {
  id: 'finnhub',
  quote: fetchQuote,
  candles: fetchCandles,
  fundamentals: fetchFundamentals,
}

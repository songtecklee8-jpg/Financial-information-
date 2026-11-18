import type { Candle, IntervalKey, QuoteSnapshot, RangeKey } from '@/types'
import type { ProviderAdapter, ProviderCtx } from '@/lib/market/registry'
import { RANGE_META } from '@/lib/market/registry'
import { toProviderSymbol } from '@/lib/market/symbols'
import { safeNumber } from '@/lib/format'
import { ensureKey, inferCurrency, toIsoDate } from './shared'

/**
 * Tiingo 仅提供 EOD（日线）历史。周线 / 月线按自然周 / 自然月在前端本地聚合。
 */

interface TiingoBar {
  date?: string
  open?: number
  high?: number
  low?: number
  close?: number
  volume?: number
}

function parseDate(value: string | undefined): number {
  if (!value) return 0
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

async function fetchDaily(
  symbol: string,
  startIso: string,
  endIso: string,
  ctx: ProviderCtx,
): Promise<Candle[]> {
  const key = ensureKey(ctx, 'Tiingo')
  const sym = toProviderSymbol(symbol, 'tiingo')
  const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(sym)}/prices?startDate=${startIso}&endDate=${endIso}&token=${encodeURIComponent(key)}`
  const rows = await ctx.json<TiingoBar[]>(url)
  const out: Candle[] = []
  for (const row of rows) {
    const t = parseDate(row.date)
    if (t <= 0) continue
    out.push({
      t,
      o: safeNumber(row.open),
      h: safeNumber(row.high),
      l: safeNumber(row.low),
      c: safeNumber(row.close),
      v: safeNumber(row.volume),
    })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** ISO 周键，用于按自然周归并 */
function isoWeekKey(t: number): string {
  const date = new Date(t)
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = (utc.getUTCDay() + 6) % 7
  utc.setUTCDate(utc.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(utc.getUTCFullYear(), 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)
  const week = 1 + Math.round((utc.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
  return `${utc.getUTCFullYear()}-W${week}`
}

function monthKey(t: number): string {
  const date = new Date(t)
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`
}

function aggregateBy(daily: Candle[], keyOf: (t: number) => string): Candle[] {
  const groups = new Map<string, Candle[]>()
  for (const candle of daily) {
    const key = keyOf(candle.t)
    const bucket = groups.get(key)
    if (bucket) bucket.push(candle)
    else groups.set(key, [candle])
  }
  const out: Candle[] = []
  for (const bucket of groups.values()) {
    const first = bucket[0]
    const last = bucket[bucket.length - 1]
    if (!first || !last) continue
    out.push({
      t: first.t,
      o: first.o,
      c: last.c,
      h: Math.max(...bucket.map((item) => item.h)),
      l: Math.min(...bucket.map((item) => item.l)),
      v: bucket.reduce((sum, item) => sum + item.v, 0),
    })
  }
  return out.sort((a, b) => a.t - b.t)
}

async function fetchCandles(
  symbol: string,
  range: RangeKey,
  interval: IntervalKey,
  ctx: ProviderCtx,
): Promise<Candle[]> {
  const now = Date.now()
  const endIso = toIsoDate(now)
  const days = RANGE_META[range].days
  const startIso = days > 0 ? toIsoDate(now - days * 86_400_000) : '1970-01-01'
  const daily = await fetchDaily(symbol, startIso, endIso, ctx)
  if (interval === '1w') return aggregateBy(daily, isoWeekKey)
  if (interval === '1mo') return aggregateBy(daily, monthKey)
  return daily
}

async function fetchQuote(symbol: string, ctx: ProviderCtx): Promise<QuoteSnapshot> {
  const now = Date.now()
  const rows = await fetchDaily(symbol, toIsoDate(now - 14 * 86_400_000), toIsoDate(now), ctx)
  const last = rows[rows.length - 1]
  const prev = rows[rows.length - 2]
  if (!last) throw new Error('该标的无报价')
  return {
    price: last.c,
    previousClose: prev ? prev.c : last.o,
    open: last.o,
    dayHigh: last.h,
    dayLow: last.l,
    volume: last.v,
    currency: inferCurrency(symbol),
  }
}

export const tiingoAdapter: ProviderAdapter = {
  id: 'tiingo',
  quote: fetchQuote,
  candles: fetchCandles,
}

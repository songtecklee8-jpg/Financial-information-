import type { Fundamentals, Quote, Security } from '@/types'
import { baselineFundamentals, baselineQuote, resolveSecurity } from '@/lib/universe'
import { safeNumber } from '@/lib/format'

/**
 * Twelve Data 客户端。
 * 所有解析都极度防御式：字段缺失或形态变化时保持基准值，绝不抛错给 UI。
 */

const BASE_URL = 'https://api.twelvedata.com'

type Json = Record<string, unknown>

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null
}

/** 按路径安全取值 */
function dig(source: unknown, path: string[]): unknown {
  let current: unknown = source
  for (const key of path) {
    if (!isJson(current)) return undefined
    current = current[key]
  }
  return current
}

function num(source: unknown, path: string[]): number | undefined {
  const raw = dig(source, path)
  if (raw === undefined || raw === null || raw === '') return undefined
  const value = safeNumber(raw, Number.NaN)
  return Number.isFinite(value) ? value : undefined
}

export class TwelveDataError extends Error {
  readonly code?: number
  constructor(message: string, code?: number) {
    super(message)
    this.name = 'TwelveDataError'
    this.code = code
  }
}

async function request(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<Json> {
  const query = new URLSearchParams(params)
  const response = await fetch(`${BASE_URL}${path}?${query.toString()}`, { signal })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new TwelveDataError(`Twelve Data 返回 HTTP ${response.status}`, response.status)
  }
  if (!isJson(payload)) throw new TwelveDataError('Twelve Data 响应无法解析')
  const status = typeof payload.status === 'string' ? payload.status : undefined
  if (payload.code !== undefined && status === 'error') {
    const code = safeNumber(payload.code, 0)
    throw new TwelveDataError(
      typeof payload.message === 'string' ? payload.message : 'Twelve Data 请求失败',
      code,
    )
  }
  return payload
}

export interface LiveSnapshot {
  quote: Quote
  fundamentals: Fundamentals
  security: Security
  /** 实际命中的接口，用于在 UI 上标注数据来源 */
  endpoints: string[]
}

function hasKey(apiKey: string | undefined): apiKey is string {
  return typeof apiKey === 'string' && apiKey.trim().length > 0
}

/** 从 quote 接口响应构建 Quote */
function buildQuote(payload: Json, fallback: Quote, security: Security): Quote {
  const price = num(payload, ['close']) ?? num(payload, ['price']) ?? fallback.price
  const previousClose = num(payload, ['previous_close']) ?? fallback.previousClose
  const change = price - previousClose
  const high = num(payload, ['high']) ?? fallback.dayHigh
  const low = num(payload, ['low']) ?? fallback.dayLow
  const currency = security.currency
  return {
    ...fallback,
    symbol: security.symbol,
    price,
    previousClose,
    change,
    changePercent: previousClose ? (change / previousClose) * 100 : 0,
    open: num(payload, ['open']) ?? fallback.open,
    dayHigh: high,
    dayLow: low,
    volume: num(payload, ['volume']) ?? fallback.volume,
    averageVolume: num(payload, ['average_volume']) ?? fallback.averageVolume,
    fiftyTwoWeekHigh: num(payload, ['fifty_two_week', 'high']) ?? fallback.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: num(payload, ['fifty_two_week', 'low']) ?? fallback.fiftyTwoWeekLow,
    currency,
    updatedAt: new Date().toISOString(),
    origin: 'live',
  }
}

/** 用 statistics 接口覆盖基准基本面 */
function overlayFundamentals(payload: Json, base: Fundamentals, price: number): Fundamentals {
  const statsRoot = isJson(payload.statistics) ? payload.statistics : payload
  const merged: Fundamentals = { ...base }

  const assign = (key: keyof Fundamentals, path: string[], transform?: (value: number) => number) => {
    const value = num(statsRoot, path)
    if (value === undefined) return
    merged[key] = transform ? transform(value) : value
  }

  assign('marketCap', ['valuations_metrics', 'market_capitalization'])
  assign('enterpriseValue', ['valuations_metrics', 'enterprise_value'])
  assign('pe5yAvg', [], () => base.pe5yAvg) // 保留基准的 5 年均值（API 不提供）
  assign('evEbitda', ['valuations_metrics', 'enterprise_to_ebitda'])
  assign('peg', ['valuations_metrics', 'peg_ratio'])
  assign('revenueTTM', ['financials', 'income_statement', 'revenue_ttm'])
  assign('netIncomeTTM', ['financials', 'income_statement', 'net_income_ttm'])
  assign('grossMargin', ['financials', 'income_statement', 'gross_profit_ttm'], (gross) =>
    merged.revenueTTM > 0 ? (gross / merged.revenueTTM) * 100 : base.grossMargin,
  )
  assign('ebitda', ['financials', 'income_statement', 'ebitda_ttm'])
  assign('freeCashFlow', ['financials', 'cash_flow', 'free_cash_flow_ttm'])
  assign('totalEquity', ['financials', 'balance_sheet', 'total_equity'])
  assign('netDebt', ['financials', 'balance_sheet', 'net_debt'])
  assign('sharesOutstanding', ['stock_statistics', 'shares_outstanding'])
  assign('currentRatio', ['financials', 'balance_sheet', 'current_ratio'])
  assign('dividendPerShare', ['dividends_and_yields', 'trailing_annual_dividend_rate'])
  assign('dividendYield', ['dividends_and_yields', 'current_dividend_yield'], (value) =>
    value > 1 ? value : value * 100,
  )

  // 用最新价格重算价格类比率，保证与行情一致
  const shares = merged.sharesOutstanding > 0 ? merged.sharesOutstanding : base.sharesOutstanding
  if (merged.netIncomeTTM !== 0 && shares > 0) {
    merged.eps = merged.netIncomeTTM / shares
  }
  if (merged.totalEquity > 0 && shares > 0) {
    merged.bookValuePerShare = merged.totalEquity / shares
  }
  merged.peTTM = merged.eps > 0 ? price / merged.eps : Number.NaN
  merged.pb = merged.bookValuePerShare > 0 ? price / merged.bookValuePerShare : Number.NaN
  merged.roe = merged.bookValuePerShare > 0 ? (merged.eps / merged.bookValuePerShare) * 100 : base.roe
  merged.peg =
    merged.epsGrowth5y > 0.5 && Number.isFinite(merged.peTTM)
      ? merged.peTTM / merged.epsGrowth5y
      : Number.NaN
  merged.marketCap = price * shares
  merged.enterpriseValue = merged.marketCap + merged.netDebt
  if (merged.ebitda > 0) merged.evEbitda = merged.enterpriseValue / merged.ebitda
  if (merged.dividendPerShare > 0) merged.dividendYield = (merged.dividendPerShare / price) * 100
  merged.netMargin = merged.revenueTTM > 0 ? (merged.netIncomeTTM / merged.revenueTTM) * 100 : base.netMargin
  merged.payoutRatio = merged.eps > 0 ? (merged.dividendPerShare / merged.eps) * 100 : 0
  merged.fcfYield = merged.marketCap > 0 ? (merged.freeCashFlow / merged.marketCap) * 100 : base.fcfYield
  merged.debtToEquity = base.debtToEquity
  merged.forwardEps = base.forwardEps
  merged.epsGrowth5y = base.epsGrowth5y

  return merged
}

function buildSparkFromSeries(payload: Json, fallback: number[]): number[] {
  const values = payload.values
  if (!Array.isArray(values) || values.length === 0) return fallback
  const closes = values
    .map((row) => num(row, ['close']))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (closes.length < 5) return fallback
  return closes.reverse()
}

/**
 * 拉取某标的的实时快照。任何一步失败都会抛出 TwelveDataError，由上层回落到基准数据。
 */
export async function fetchLiveSnapshot(
  rawSymbol: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<LiveSnapshot> {
  if (!hasKey(apiKey)) throw new TwelveDataError('未配置 Twelve Data API Key')
  const security = resolveSecurity(rawSymbol)
  const symbol = security.symbol
  const endpoints: string[] = []

  const quotePayload = await request('/quote', { symbol, apikey: apiKey }, signal)
  endpoints.push('quote')

  const fallbackQuote = baselineQuote(symbol)
  let quote = buildQuote(quotePayload, fallbackQuote, security)
  let fundamentals = baselineFundamentals(symbol)

  // 统计接口：可选，缺失时不影响行情展示
  try {
    const stats = await request('/statistics', { symbol, apikey: apiKey }, signal)
    endpoints.push('statistics')
    fundamentals = overlayFundamentals(stats, fundamentals, quote.price)
  } catch {
    /* 保持基准基本面 */
  }

  // 日线序列：用于 sparkline
  try {
    const series = await request(
      '/time_series',
      { symbol, interval: '1day', outputsize: '64', apikey: apiKey },
      signal,
    )
    endpoints.push('time_series')
    quote = { ...quote, spark: buildSparkFromSeries(series, quote.spark) }
  } catch {
    /* 保留生成的走势 */
  }

  return { quote, fundamentals, security, endpoints }
}

export function hasTwelveDataKey(apiKey: string | undefined): boolean {
  return hasKey(apiKey)
}

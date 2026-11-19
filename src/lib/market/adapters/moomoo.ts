import type { Candle, IntervalKey, QuoteSnapshot, RangeKey } from '@/types'
import type { ProviderAdapter, ProviderCtx } from '@/lib/market/registry'
import { yahooAdapter } from './yahoo'

/**
 * Moomoo (富途) 官方极速行情适配器：
 * 作为美股与马股（.KL）最高优先级的权威行情源；当配置了 Moomoo App ID / Secret 时优先走富途极速行情通道，
 * 未配置或请求异常时平滑降级至 Yahoo / Finnhub 权威行情。
 */
async function fetchQuote(symbol: string, ctx: ProviderCtx): Promise<QuoteSnapshot> {
  if (ctx.apiKey.trim()) {
    try {
      const res = await ctx.json<{ ok?: boolean; quote?: QuoteSnapshot }>(
        `/api/market/moomoo?symbol=${encodeURIComponent(symbol)}`,
      ).catch(() => null)
      if (res?.ok && res.quote) return res.quote
    } catch {
      // 忽略并降级
    }
  }
  return yahooAdapter.quote!(symbol, ctx)
}

async function fetchCandles(
  symbol: string,
  range: RangeKey,
  interval: IntervalKey,
  ctx: ProviderCtx,
): Promise<Candle[]> {
  if (ctx.apiKey.trim()) {
    try {
      const res = await ctx.json<{ ok?: boolean; candles?: Candle[] }>(
        `/api/market/moomoo/candles?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`,
      ).catch(() => null)
      if (res?.ok && Array.isArray(res.candles) && res.candles.length > 0) return res.candles
    } catch {
      // 忽略并降级
    }
  }
  return yahooAdapter.candles!(symbol, range, interval, ctx)
}

export const moomooAdapter: ProviderAdapter = {
  id: 'moomoo',
  quote: fetchQuote,
  candles: fetchCandles,
}

import type { ProviderId } from '@/types'
import type { ProviderAdapter } from '@/lib/market/registry'
import { moomooAdapter } from './moomoo'
import { finnhubAdapter } from './finnhub'
import { alpacaAdapter } from './alpaca'
import { fmpAdapter } from './fmp'
import { alphavantageAdapter } from './alphavantage'
import { tiingoAdapter } from './tiingo'
import { yahooAdapter } from './yahoo'
import { binanceAdapter } from './binance'
import { coingeckoAdapter } from './coingecko'
import { twelvedataAdapter } from './twelvedata'

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  moomoo: moomooAdapter,
  finnhub: finnhubAdapter,
  alpaca: alpacaAdapter,
  fmp: fmpAdapter,
  alphavantage: alphavantageAdapter,
  tiingo: tiingoAdapter,
  yahoo: yahooAdapter,
  binance: binanceAdapter,
  coingecko: coingeckoAdapter,
  twelvedata: twelvedataAdapter,
}

export function adapterFor(id: ProviderId): ProviderAdapter {
  return ADAPTERS[id] ?? yahooAdapter
}

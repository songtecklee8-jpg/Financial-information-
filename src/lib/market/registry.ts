import type {
  Candle,
  FundamentalsPatch,
  IntervalKey,
  ProviderId,
  QuoteSnapshot,
  RangeKey,
} from '@/types'

/**
 * 多引擎行情系统的契约层。
 *
 * 设计要点：
 * 1. 适配器（adapter）只负责「拼 URL + 取字段」，网络与 CORS 代理统一由 ctx 注入；
 * 2. 引擎（failover）负责顺序、熔断与降级，因此任何适配器抛错都不会中断终端；
 * 3. 每个引擎的能力（支持的周期、市场、资产类别）在此集中声明，引擎据此跳过不适用者。
 */

// ---------------------------------------------------------------------------
// 适配器契约
// ---------------------------------------------------------------------------

export interface ProviderCtx {
  apiKey: string
  secretKey: string
  signal: AbortSignal
  /** 自动走 CORS 代理链的 JSON 请求；4xx/5xx 与超时都会抛出 */
  json: <T>(url: string, init?: RequestInit) => Promise<T>
  /** 自动走 CORS 代理链的文本请求（用于 RSS / CSV） */
  text: (url: string, init?: RequestInit) => Promise<string>
}

export type QuoteFetcher = (symbol: string, ctx: ProviderCtx) => Promise<QuoteSnapshot>
export type CandleFetcher = (
  symbol: string,
  range: RangeKey,
  interval: IntervalKey,
  ctx: ProviderCtx,
) => Promise<Candle[]>
export type FundamentalsFetcher = (symbol: string, ctx: ProviderCtx) => Promise<FundamentalsPatch>

export interface ProviderAdapter {
  id: ProviderId
  quote?: QuoteFetcher
  candles?: CandleFetcher
  fundamentals?: FundamentalsFetcher
}

// ---------------------------------------------------------------------------
// 引擎元数据
// ---------------------------------------------------------------------------

export interface ProviderCapabilities {
  quote: boolean
  candles: boolean
  fundamentals: boolean
  news: boolean
  /** 支持的 K 线周期；空数组表示不做 K 线 */
  intervals: IntervalKey[]
  /** 日线以上的历史深度（年），用于 MAX / 10Y 判断 */
  historyYears: number
  bursa: boolean
  us: boolean
  crypto: boolean
  /** 是否需要浏览器端 CORS 代理 */
  needsProxy: boolean
}

export interface ProviderMeta {
  id: ProviderId
  label: string
  vendor: string
  requiresKey: boolean
  requiresSecret: boolean
  keyLabel: string
  secretLabel: string
  keyUrl: string
  /** 状态灯与徽章的 tailwind 色类 */
  accent: string
  dot: string
  note: string
  caps: ProviderCapabilities
}

const caps = (patch: Partial<ProviderCapabilities>): ProviderCapabilities => ({
  quote: true,
  candles: false,
  fundamentals: false,
  news: false,
  intervals: [],
  historyYears: 0,
  bursa: false,
  us: false,
  crypto: false,
  needsProxy: false,
  ...patch,
})

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  moomoo: {
    id: 'moomoo',
    label: 'Moomoo (富途)',
    vendor: 'Moomoo OpenAPI / Futu',
    requiresKey: true,
    requiresSecret: true,
    keyLabel: 'App ID / Key',
    secretLabel: 'Secret Token',
    keyUrl: 'https://openapi.moomoo.com/',
    accent: 'text-bull',
    dot: 'bg-bull',
    note: '富途 Moomoo 官方极速实时行情与盘口，美股与马股（.KL）最高优先级权威源',
    caps: caps({
      candles: true,
      fundamentals: true,
      intervals: ['1m', '5m', '15m', '1h', '1d', '1w', '1mo'],
      historyYears: 30,
      us: true,
      bursa: true,
    }),
  },
  finnhub: {
    id: 'finnhub',
    label: 'Finnhub',
    vendor: 'Finnhub.io',
    requiresKey: true,
    requiresSecret: false,
    keyLabel: 'API Key',
    secretLabel: '',
    keyUrl: 'https://finnhub.io/register',
    accent: 'text-ice',
    dot: 'bg-ice',
    note: '美股报价 + 分钟级 K 线 + 公司新闻，免费额度 60 次/分钟',
    caps: caps({
      candles: true,
      fundamentals: true,
      news: true,
      intervals: ['1m', '5m', '15m', '1h', '1d'],
      historyYears: 20,
      us: true,
      bursa: true,
    }),
  },
  alpaca: {
    id: 'alpaca',
    label: 'Alpaca',
    vendor: 'Alpaca Markets',
    requiresKey: true,
    requiresSecret: true,
    keyLabel: 'Key ID',
    secretLabel: 'Secret Key',
    keyUrl: 'https://app.alpaca.markets/paper/dashboard/overview',
    accent: 'text-gold',
    dot: 'bg-gold',
    note: 'IEX 实时 + SIP 历史 K 线，支持 1Min~1Month 全周期',
    caps: caps({
      candles: true,
      intervals: ['1m', '5m', '15m', '1h', '1d', '1w', '1mo'],
      historyYears: 20,
      us: true,
    }),
  },
  fmp: {
    id: 'fmp',
    label: 'FMP',
    vendor: 'Financial Modeling Prep',
    requiresKey: true,
    requiresSecret: false,
    keyLabel: 'API Key',
    secretLabel: '',
    keyUrl: 'https://site.financialmodelingprep.com/developer/docs',
    accent: 'text-iris',
    dot: 'bg-iris',
    note: '基本面 + 财报 + K 线，支持马股 .KL 与美股',
    caps: caps({
      candles: true,
      fundamentals: true,
      intervals: ['1m', '5m', '15m', '1h', '1d'],
      historyYears: 30,
      us: true,
      bursa: true,
    }),
  },
  alphavantage: {
    id: 'alphavantage',
    label: 'Alpha Vantage',
    vendor: 'Alpha Vantage',
    requiresKey: true,
    requiresSecret: false,
    keyLabel: 'API Key',
    secretLabel: '',
    keyUrl: 'https://www.alphavantage.co/support/#api-key',
    accent: 'text-bull',
    dot: 'bg-bull',
    note: '全周期 K 线 + 公司概览 + 带情绪评分的新闻',
    caps: caps({
      candles: true,
      fundamentals: true,
      news: true,
      intervals: ['1m', '5m', '15m', '1h', '1d', '1w', '1mo'],
      historyYears: 20,
      us: true,
      crypto: true,
    }),
  },
  tiingo: {
    id: 'tiingo',
    label: 'Tiingo',
    vendor: 'Tiingo',
    requiresKey: true,
    requiresSecret: false,
    keyLabel: 'API Token',
    secretLabel: '',
    keyUrl: 'https://www.tiingo.com/account/api/token',
    accent: 'text-dim',
    dot: 'bg-line-2',
    note: '日线以上长历史（EOD）+ 复权价格，适合 10Y / MAX',
    caps: caps({
      candles: true,
      intervals: ['1d', '1w', '1mo'],
      historyYears: 40,
      us: true,
    }),
  },
  yahoo: {
    id: 'yahoo',
    label: 'Yahoo Finance',
    vendor: 'Yahoo（非官方接口）',
    requiresKey: false,
    requiresSecret: false,
    keyLabel: '',
    secretLabel: '',
    keyUrl: 'https://finance.yahoo.com/',
    accent: 'text-ice',
    dot: 'bg-ice',
    note: '免 Key 全市场兜底，马股 .KL 覆盖最佳（经 CORS 代理路由）',
    caps: caps({
      candles: true,
      intervals: ['1m', '5m', '15m', '1h', '1d', '1w', '1mo'],
      historyYears: 60,
      us: true,
      bursa: true,
      crypto: true,
      needsProxy: true,
    }),
  },
  binance: {
    id: 'binance',
    label: 'Binance',
    vendor: 'Binance Public API',
    requiresKey: false,
    requiresSecret: false,
    keyLabel: '',
    secretLabel: '',
    keyUrl: 'https://binance-docs.github.io/apidocs/spot/en/',
    accent: 'text-gold',
    dot: 'bg-gold',
    note: '免 Key 数字资产现货报价与 K 线，毫秒级延迟',
    caps: caps({
      candles: true,
      intervals: ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1mo'],
      historyYears: 12,
      crypto: true,
    }),
  },
  coingecko: {
    id: 'coingecko',
    label: 'CoinGecko',
    vendor: 'CoinGecko Public API',
    requiresKey: false,
    requiresSecret: false,
    keyLabel: 'Demo Key（可选）',
    secretLabel: '',
    keyUrl: 'https://www.coingecko.com/en/api',
    accent: 'text-bull',
    dot: 'bg-bull',
    note: '数字资产市值与长历史走势，免 Key 可用（限速较严）',
    caps: caps({
      candles: true,
      intervals: ['1h', '1d'],
      historyYears: 12,
      crypto: true,
    }),
  },
  twelvedata: {
    id: 'twelvedata',
    label: 'Twelve Data',
    vendor: 'Twelve Data',
    requiresKey: true,
    requiresSecret: false,
    keyLabel: 'API Key',
    secretLabel: '',
    keyUrl: 'https://twelvedata.com/pricing',
    accent: 'text-ice',
    dot: 'bg-ice',
    note: '全球多市场报价 / 财务统计 / 时间序列，支持马股',
    caps: caps({
      candles: true,
      fundamentals: true,
      intervals: ['1m', '5m', '15m', '1h', '1d', '1w', '1mo'],
      historyYears: 25,
      us: true,
      bursa: true,
      crypto: true,
    }),
  },
}

export const PROVIDER_IDS = Object.keys(PROVIDER_META) as ProviderId[]

export function providerMeta(id: ProviderId): ProviderMeta {
  return PROVIDER_META[id]
}

export function providerLabel(id: ProviderId | null): string {
  if (!id) return '基准数据'
  return PROVIDER_META[id]?.label ?? id
}

// ---------------------------------------------------------------------------
// 周期与区间
// ---------------------------------------------------------------------------

export interface IntervalMeta {
  key: IntervalKey
  label: string
  /** 毫秒 */
  ms: number
  /** 属于日内周期（需要实时刷新） */
  intraday: boolean
}

export const INTERVAL_META: Record<IntervalKey, IntervalMeta> = {
  '1m': { key: '1m', label: '1分', ms: 60_000, intraday: true },
  '5m': { key: '5m', label: '5分', ms: 300_000, intraday: true },
  '15m': { key: '15m', label: '15分', ms: 900_000, intraday: true },
  '1h': { key: '1h', label: '1时', ms: 3_600_000, intraday: true },
  '4h': { key: '4h', label: '4时', ms: 14_400_000, intraday: true },
  '1d': { key: '1d', label: '日线', ms: 86_400_000, intraday: false },
  '1w': { key: '1w', label: '周线', ms: 604_800_000, intraday: false },
  '1mo': { key: '1mo', label: '月线', ms: 2_592_000_000, intraday: false },
}

export const INTERVAL_ORDER: IntervalKey[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1mo']

export interface RangeMeta {
  key: RangeKey
  label: string
  /** 天数，MAX 用 0 表示不限 */
  days: number
  defaultInterval: IntervalKey
}

export const RANGE_META: Record<RangeKey, RangeMeta> = {
  '1d': { key: '1d', label: '1D', days: 1, defaultInterval: '5m' },
  '5d': { key: '5d', label: '5D', days: 5, defaultInterval: '15m' },
  '1mo': { key: '1mo', label: '1M', days: 30, defaultInterval: '1h' },
  '3mo': { key: '3mo', label: '3M', days: 91, defaultInterval: '1d' },
  '6mo': { key: '6mo', label: '6M', days: 182, defaultInterval: '1d' },
  '1y': { key: '1y', label: '1Y', days: 365, defaultInterval: '1d' },
  '2y': { key: '2y', label: '2Y', days: 730, defaultInterval: '1w' },
  '5y': { key: '5y', label: '5Y', days: 1825, defaultInterval: '1w' },
  '10y': { key: '10y', label: '10Y', days: 3650, defaultInterval: '1mo' },
  max: { key: 'max', label: 'MAX', days: 0, defaultInterval: '1mo' },
}

export const RANGE_ORDER: RangeKey[] = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max']

export function rangeStartMs(range: RangeKey, now = Date.now()): number {
  const meta = RANGE_META[range]
  if (!meta || meta.days === 0) return 0
  return now - meta.days * 86_400_000
}

/** 周期聚合：把细粒度 K 线合成为粗粒度（如 1h → 4h、1d → 1w） */
export function aggregateCandles(candles: Candle[], factor: number): Candle[] {
  if (factor <= 1) return candles
  const out: Candle[] = []
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor)
    if (chunk.length === 0) continue
    const first = chunk[0]!
    const last = chunk[chunk.length - 1]!
    out.push({
      t: first.t,
      o: first.o,
      c: last.c,
      h: Math.max(...chunk.map((item) => item.h)),
      l: Math.min(...chunk.map((item) => item.l)),
      v: chunk.reduce((sum, item) => sum + item.v, 0),
    })
  }
  return out
}

/** 目标周期需要从哪个源周期聚合而来 */
export function aggregationFactor(source: IntervalKey, target: IntervalKey): number {
  const s = INTERVAL_META[source].ms
  const t = INTERVAL_META[target].ms
  if (t <= s) return 1
  return Math.max(1, Math.round(t / s))
}

/** 在引擎支持的周期里挑一个能覆盖目标周期的最佳源周期 */
export function pickSourceInterval(
  supported: IntervalKey[],
  target: IntervalKey,
): { source: IntervalKey; factor: number } | null {
  if (supported.length === 0) return null
  if (supported.includes(target)) return { source: target, factor: 1 }
  const targetMs = INTERVAL_META[target].ms
  const finer = supported
    .filter((key) => INTERVAL_META[key].ms <= targetMs)
    .sort((a, b) => INTERVAL_META[b].ms - INTERVAL_META[a].ms)
  if (finer.length > 0) {
    const source = finer[0]!
    return { source, factor: aggregationFactor(source, target) }
  }
  return null
}

// ---------------------------------------------------------------------------
// 故障转移链（按资产类别 / 市场决定顺序）
// ---------------------------------------------------------------------------

/** 美股：报价与 K 线链路 */
export const US_CHAIN: ProviderId[] = [
  'moomoo',
  'finnhub',
  'alpaca',
  'fmp',
  'alphavantage',
  'tiingo',
  'yahoo',
  'twelvedata',
]

/** 马股（Bursa .KL）与全球：Moomoo 优先，其后为 Yahoo、FMP 等 */
export const BURSA_CHAIN: ProviderId[] = ['moomoo', 'yahoo', 'fmp', 'twelvedata', 'alphavantage', 'finnhub']

/** 数字资产：Binance 优先，CoinGecko 兜底，Yahoo 最后 */
export const CRYPTO_CHAIN: ProviderId[] = ['binance', 'coingecko', 'yahoo']

/** 长历史（10Y / MAX）优先链路：这些引擎一次请求即可给出全历史 */
export const LONG_HISTORY_CHAIN: ProviderId[] = ['moomoo', 'tiingo', 'yahoo', 'fmp', 'twelvedata', 'alphavantage']

export function chainFor(opts: {
  assetClass: 'equity' | 'crypto'
  market: 'US' | 'BURSA' | 'CRYPTO'
}): ProviderId[] {
  if (opts.assetClass === 'crypto') return CRYPTO_CHAIN
  return opts.market === 'BURSA' ? BURSA_CHAIN : US_CHAIN
}

/** 引擎在该链路下是否可用（无 Key 且必须 Key 的直接跳过） */
export function isProviderConfigured(id: ProviderId, apiKey: string, secretKey: string): boolean {
  const meta = PROVIDER_META[id]
  if (!meta) return false
  if (!meta.requiresKey) return true
  if (!apiKey.trim()) return false
  if (meta.requiresSecret && !secretKey.trim()) return false
  return true
}

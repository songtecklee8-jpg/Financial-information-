/**
 * APEX Terminal — 服务端数据契约类型。
 *
 * 与前端 `src/types/index.ts` 中对应的结构保持一致（云端快照 / 新闻详情）。
 */

// ---------------------------------------------------------------------------
// 行情快照
// ---------------------------------------------------------------------------

export interface ServerQuote {
  symbol: string
  name: string
  price: number
  previousClose: number
  change: number
  changePercent: number
  open: number
  dayHigh: number
  dayLow: number
  volume: number
  currency: 'USD' | 'MYR'
  market: 'US' | 'BURSA' | 'CRYPTO'
  provider: string
  updatedAt: string
  origin: 'live' | 'baseline'
}

export interface QuotesPayload {
  quotes: Record<string, ServerQuote>
  updatedAt: string
  /** 命中实时数据的标的数量 */
  liveCount: number
}

// ---------------------------------------------------------------------------
// 新闻
// ---------------------------------------------------------------------------

export type NewsSourceId =
  | 'wsj'
  | 'wallstreetcn'
  | 'cnbc'
  | 'yahoo'
  | 'finnhub'
  | 'newsdata'
  | 'alphavantage'
  | 'gdelt'
  | 'bernama'
  | 'thestar'
  | 'nst'
  | 'theedgemalaysia'
  | 'bursa'

export type NewsRegion = 'global' | 'malaysia'

export type NewsCategory = 'macro' | 'equities' | 'rates' | 'energy' | 'tech' | 'crypto' | 'corporate'

export interface ServerArticle {
  id: string
  title: string
  titleZh?: string
  summary: string
  summaryZh?: string
  sourceId: NewsSourceId
  sourceName: string
  url: string
  publishedAt: string
  region: NewsRegion
  lang: 'en' | 'zh'
  tickers: string[]
  sentiment: 'bullish' | 'bearish' | 'neutral'
  sentimentScore?: number
  categories: NewsCategory[]
  origin: 'live' | 'baseline'
  translation: 'none' | 'pending' | 'done' | 'failed'
}

/** 标准化新闻数据结构（存入 Redis Sorted Set `news:global_feed`） */
export interface NewsItem {
  id: string
  title: string
  translatedTitle?: string
  summary?: string
  url: string
  source: string
  publishedAt: string
  sentiment?: 'bullish' | 'bearish' | 'neutral'
}

export interface NewsPayload {
  articles: ServerArticle[]
  updatedAt: string
  /** 后台预翻译实际命中的模型 id */
  model?: string
  /** 已完成华文翻译的条数 */
  translatedCount: number
}

// ---------------------------------------------------------------------------
// 单篇新闻详情（AI 摘要 + 全文 + 跨市场推演）
// ---------------------------------------------------------------------------

export type AssetKey = 'equities' | 'bonds' | 'realEstate' | 'gold' | 'volatility'
export type ImpactDirection = 'bullish' | 'bearish' | 'neutral'

export interface AssetImpact {
  asset: AssetKey
  label: string
  up: number
  down: number
  direction: ImpactDirection
  driver: string
  detail: string
}

export interface NewsImpact {
  articleId: string
  headline: string
  eventBreakdown: string
  transmission: string
  liquidity: string
  rateExpectation: string
  sectorImpact: string
  assets: AssetImpact[]
  watchlist: string[]
  confidence: number
  generatedAt: string
  model: string
  degraded?: boolean
}

export interface NewsDetail {
  id: string
  url: string
  title: string
  titleZh?: string
  sourceName: string
  publishedAt: string
  /** AI 核心摘要：3–5 条结构化华文要点 */
  summaryPoints: string[]
  /** 抓取清洗后的完整原文（英文 / 原始语言） */
  fullText: string
  /** 完整全文的华文翻译 */
  fullTextZh: string
  impact: NewsImpact
  /** 实际执行摘要 / 推演的模型 id */
  model: string
  /** 全文抓取状态 */
  extraction: 'readability' | 'fallback' | 'unavailable'
  cachedAt: string
}

/** 后台同步元信息 */
export interface SyncMeta {
  lastSyncAt: string
  lastSyncDurationMs: number
  trigger: 'cron' | 'external' | 'manual'
  quotes: { total: number; live: number }
  news: { total: number; translated: number }
  errors: string[]
  usingUpstash: boolean
}

// ---------------------------------------------------------------------------
// 财报日历（美股 7 天 + 马股 .KL 季度财报公告）
// ---------------------------------------------------------------------------

export interface UsEarningsEvent {
  id: string
  symbol: string
  company: string
  date: string
  hour: 'bmo' | 'amc' | 'dmh' | 'unknown'
  quarter?: number
  year?: number
  epsEstimate: number | null
  epsActual: number | null
  revenueEstimate: number | null
  revenueActual: number | null
  provider: 'finnhub' | 'fmp' | 'baseline'
  origin: 'live' | 'baseline'
}

export interface BursaAnnouncement {
  id: string
  symbol: string
  company: string
  title: string
  quarterLabel: string
  publishedAt: string
  periodEnd: string
  revenueMyr: string
  revenueYoY: string
  netProfitMyr: string
  netProfitYoY: string
  epsSen: string
  dividendSen?: string
  pdfUrl: string
  sourceUrl: string
  summaryPoints: string[]
  origin: 'live' | 'baseline'
}

export interface BursaEarningsDetail {
  id: string
  symbol: string
  company: string
  quarterLabel: string
  publishedAt: string
  revenueMyr: string
  revenueYoY: string
  netProfitMyr: string
  netProfitYoY: string
  epsSen: string
  dividendSen?: string
  summaryPoints: string[]
  highlights: string
  outlook: string
  risks: string
  pdfUrl: string
  model: string
  degraded?: boolean
  generatedAt: string
}

export interface EarningsPayload {
  us: UsEarningsEvent[]
  bursa: BursaAnnouncement[]
  usOrigin: 'live' | 'baseline'
  bursaOrigin: 'live' | 'baseline'
  usProvider: string
  bursaProvider: string
  updatedAt: string
  model?: string
}

// ---------------------------------------------------------------------------
// 马来西亚政府债券（MGS / MGII Tracker）
// ---------------------------------------------------------------------------

export type BondInstrument = 'MGS' | 'MGII'

export interface BondAuctionItem {
  id: string
  instrument: BondInstrument
  series: string
  issueCode: string
  tenorYears: number
  reopening: boolean
  auctionDate: string
  issueDate: string
  maturityDate: string
  estimatedSizeMyrB: number
  privatePlacementMyrB?: number
  couponRate?: number
  yieldAvg?: number
  bidToCover?: number
  status: 'upcoming' | 'announced' | 'completed'
  source: string
  origin: 'live' | 'baseline'
}

export interface BondMarketBenchmark {
  opr: number
  oprDate: string
  interbankOvernight: number
  mgs3y: number
  mgs5y: number
  mgs10y: number
  mgs15y: number
  mgs30y: number
  us10y: number
  spread10y: number
  usdMyr: number
  bnmOrigin: 'live' | 'baseline'
}

export interface BondAuctionAnalysis {
  headline: string
  demandOutlook: string
  yieldImpact: string
  fxAndEquityImpact: string
  keyWatchPoints: string[]
  model: string
  degraded?: boolean
  generatedAt: string
}

export interface BondsPayload {
  benchmarks: BondMarketBenchmark
  auctions: BondAuctionItem[]
  origin: 'live' | 'baseline'
  sourceLabel: string
  updatedAt: string
  model?: string
}


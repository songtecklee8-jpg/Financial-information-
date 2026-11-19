/**
 * APEX Terminal — 领域模型类型定义
 */

export type Market = 'US' | 'BURSA' | 'CRYPTO'

/** 资产大类：股票 / 数字资产 */
export type AssetClass = 'equity' | 'crypto'

export type Currency = 'USD' | 'MYR'

export type DataOrigin = 'live' | 'baseline'

/** 可交易标的（证券主数据） */
export interface Security {
  symbol: string
  name: string
  /** 交易所代码，如 NASDAQ / NYSE / Bursa Malaysia */
  exchange: string
  market: Market
  currency: Currency
  sector: string
  /** 行业平均市盈率，用于量化引擎做相对估值 */
  industryPE: number
}

/** 实时行情快照 */
export interface Quote {
  symbol: string
  price: number
  previousClose: number
  change: number
  changePercent: number
  open: number
  dayHigh: number
  dayLow: number
  volume: number
  averageVolume: number
  fiftyTwoWeekHigh: number
  fiftyTwoWeekLow: number
  marketCap: number
  currency: Currency
  updatedAt: string
  origin: DataOrigin
  /** 60 点归一化走势序列，供 sparkline 渲染 */
  spark: number[]
}

/** 财务基本面（TTM 口径） */
export interface Fundamentals {
  eps: number
  bookValuePerShare: number
  peTTM: number
  /** 5 年历史平均市盈率 */
  pe5yAvg: number
  pb: number
  peg: number
  evEbitda: number
  /** 净资产收益率 (%) */
  roe: number
  /** 毛利率 (%) */
  grossMargin: number
  /** 净利率 (%) */
  netMargin: number
  dividendPerShare: number
  /** 股息率 (%) */
  dividendYield: number
  /** 派息率 (%) */
  payoutRatio: number
  /** 近 5 年 EPS 复合增速 (%)，用于 PEG 与增长模型 */
  epsGrowth5y: number
  /** 远期每股收益一致预期 */
  forwardEps: number
  /** 自由现金流收益率 (%) */
  fcfYield: number
  marketCap: number
  enterpriseValue: number
  netDebt: number
  ebitda: number
  totalEquity: number
  sharesOutstanding: number
  revenueTTM: number
  netIncomeTTM: number
  freeCashFlow: number
  currentRatio: number
  debtToEquity: number
}

/** 宏观利率环境 */
export interface MacroRates {
  us2y: number
  us10y: number
  us30y: number
  mgs3y: number
  mgs5y: number
  mgs10y: number
  /** 马来西亚隔夜政策利率 */
  opr: number
  /** 美国 10Y - 马来西亚 10Y（大马相对美债利差） */
  spread10y: number
  updatedAt: string
  origin: DataOrigin
}

export type NewsSource = 'WSJ' | '华尔街见闻' | 'The Star Business'

export interface NewsItem {
  id: string
  title: string
  source: NewsSource
  publishedAt: string
  summary: string
  url: string
  tickers: string[]
  sentiment: 'bullish' | 'bearish' | 'neutral'
  origin: DataOrigin
}

export type Verdict = 'UNDERVALUED' | 'FAIRLY VALUED' | 'OVERVALUED'

/** 打分因子 — 用于解释综合评分构成 */
export interface ScoreFactor {
  key: string
  label: string
  /** 格式化后的展示值 */
  display: string
  /** 0-100 分项得分 */
  score: number
  weight: number
  comment: string
}

/** 量化估值引擎输出 */
export interface ValuationResult {
  currentPrice: number
  currency: Currency
  currentPE: number
  avgPE5y: number
  /** 相对 5 年均值的溢价/折价 (%)，负数=折价 */
  pePremiumPct: number
  pb: number
  peg: number
  evEbitda: number
  roe: number
  grossMargin: number
  dividendYield: number
  /** 格雷厄姆数字 sqrt(22.5 × EPS × BVPS) */
  grahamNumber: number
  /** 基于 5 年均值 PE 回归的内在价值 */
  meanReversionValue: number
  /** 基于行业平均 PE 的相对内在价值 */
  industryRelativeValue: number
  fairValueLow: number
  fairValueHigh: number
  fairValueMid: number
  /** 安全边际 (%)：正数表示价格低于内在价值 */
  marginOfSafetyPct: number
  /** 综合性价比评分 0-100（越高越具价值） */
  score: number
  verdict: Verdict
  factors: ScoreFactor[]
  /** 估值假设与风险提示 */
  notes: string[]
}

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: string
  /** 是否为本地降级回复 */
  degraded?: boolean
}

/**
 * AI 模型路由模式。
 * - auto：智能三级自动分配（Lite 批量翻译 / Flash 即时研判 / Pro 深度复盘）
 * - pro / flash / lite：手动锁定，全部任务强制使用该层级模型
 */
export type AiRoutingMode = 'auto' | 'pro' | 'flash' | 'lite'

export interface ApiSettings {
  geminiKey: string
  /** 高级：自定义模型覆盖（留空则由三级路由自动决定） */
  geminiModel: string
  /** AI 模型路由模式 */
  aiRouting: AiRoutingMode
  /** 各行情引擎的密钥配置（Key + Secret） */
  providers: Record<ProviderId, ProviderConfig>
}

// ---------------------------------------------------------------------------
// 多引擎行情（Provider）
// ---------------------------------------------------------------------------

/** 已接入的行情 / 新闻数据引擎 */
export type ProviderId =
  | 'finnhub'
  | 'alpaca'
  | 'fmp'
  | 'alphavantage'
  | 'tiingo'
  | 'yahoo'
  | 'binance'
  | 'coingecko'
  | 'twelvedata'

export interface ProviderConfig {
  apiKey: string
  /** 部分引擎（如 Alpaca）需要第二把密钥 */
  secretKey: string
}

/** 指示灯状态 */
export type ProviderHealth =
  | 'unknown'
  | 'no-key'
  | 'ready'
  | 'ok'
  | 'error'
  | 'rate-limited'
  | 'cooldown'
  | 'testing'

export interface ProviderStatus {
  id: ProviderId
  health: ProviderHealth
  message?: string
  latencyMs?: number
  checkedAt?: string
  /** 连续失败次数 */
  failures: number
  /** 熔断解除时间戳 */
  cooldownUntil?: number
  /** 最近一次成功命中的请求量 */
  requests: number
}

// ---------------------------------------------------------------------------
// K 线与走势
// ---------------------------------------------------------------------------

export type IntervalKey = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w' | '1mo'

export type RangeKey = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | '10y' | 'max'

/** 单根 K 线（时间戳为毫秒 UTC） */
export interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface CandleSeries {
  symbol: string
  interval: IntervalKey
  candles: Candle[]
  origin: DataOrigin
  /** 命中的引擎 */
  provider: ProviderId | null
  fetchedAt: string
}

/** 行情快照（引擎无关的中间结构） */
export interface QuoteSnapshot {
  price: number
  previousClose: number
  open?: number
  dayHigh?: number
  dayLow?: number
  volume?: number
  fiftyTwoWeekHigh?: number
  fiftyTwoWeekLow?: number
  marketCap?: number
  currency?: Currency
  updatedAt?: string
}

/** 基本面补丁（引擎返回的字段覆盖基准值） */
export type FundamentalsPatch = Partial<Omit<Fundamentals, 'marketCap' | 'enterpriseValue'>>

// ---------------------------------------------------------------------------
// 新闻中心
// ---------------------------------------------------------------------------

export type NewsSourceId =
  | 'wsj'
  | 'wallstreetcn'
  | 'cnbc'
  | 'yahoo'
  | 'finnhub'
  | 'alphavantage'
  | 'gdelt'
  | 'bernama'
  | 'thestar'
  | 'nst'
  | 'theedgemalaysia'
  | 'bursa'

export type NewsRegion = 'global' | 'malaysia'

export type NewsCategory = 'macro' | 'equities' | 'rates' | 'energy' | 'tech' | 'crypto' | 'corporate'

export interface NewsArticle {
  id: string
  title: string
  /** Gemini 翻译后的华文标题 */
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
  /** -1 ~ 1 的多空情绪分（Alpha Vantage News & Sentiment 提供） */
  sentimentScore?: number
  categories: NewsCategory[]
  origin: DataOrigin
  /** 翻译状态 */
  translation: 'none' | 'pending' | 'done' | 'failed'
}

/** 五大核心资产类别 */
export type AssetKey = 'equities' | 'bonds' | 'realEstate' | 'gold' | 'volatility'

export type ImpactDirection = 'bullish' | 'bearish' | 'neutral'

export interface AssetImpact {
  asset: AssetKey
  label: string
  /** 上涨概率 0-100 */
  up: number
  /** 下跌概率 0-100（up + down = 100） */
  down: number
  direction: ImpactDirection
  /** 一句话核心驱动逻辑 */
  driver: string
  /** 细分说明（如美股大盘 / 科技股 / 马股板块） */
  detail: string
}

/** 新闻 → 跨市场冲击推演结果 */
export interface NewsImpact {
  articleId: string
  headline: string
  /** 核心事件拆解 */
  eventBreakdown: string
  /** 传导逻辑 */
  transmission: string
  /** 对宏观流动性的影响 */
  liquidity: string
  /** 对利率预期的影响 */
  rateExpectation: string
  /** 行业基本面影响 */
  sectorImpact: string
  assets: AssetImpact[]
  /** 值得关注的标的 / 指标 */
  watchlist: string[]
  /** AI 置信度 0-100 */
  confidence: number
  generatedAt: string
  model: string
  /** 是否为本地启发式兜底（未配置 Gemini Key） */
  degraded?: boolean
}

// ---------------------------------------------------------------------------
// 云端后台（Vercel Serverless + Upstash Redis）
// ---------------------------------------------------------------------------

/** 云端后台同步的单条行情快照 */
export interface CloudQuote {
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
  currency: Currency
  market: Market
  provider: string
  updatedAt: string
  origin: DataOrigin
}

export interface CloudQuotes {
  quotes: Record<string, CloudQuote>
  updatedAt: string
  liveCount: number
}

export interface CloudNews {
  articles: NewsArticle[]
  updatedAt: string
  model?: string
  translatedCount: number
}

export interface CloudSyncMeta {
  lastSyncAt: string
  lastSyncDurationMs: number
  trigger: 'cron' | 'external' | 'manual'
  quotes: { total: number; live: number }
  news: { total: number; translated: number }
  errors: string[]
  usingUpstash: boolean
}

/** GET /api/snapshot 的返回结构 */
export interface CloudSnapshotResponse {
  ok: boolean
  ready: boolean
  quotes: CloudQuotes | null
  news: CloudNews | null
  meta: CloudSyncMeta | null
}

/** 新闻详情页的阅读语言模式 */
export type ReaderMode = 'zh' | 'en' | 'both'

/** 单篇新闻的云端深度详情（摘要 + 全文 + 推演） */
export interface NewsDetail {
  id: string
  url: string
  title: string
  titleZh?: string
  sourceName: string
  publishedAt: string
  /** AI 核心摘要：3–5 条结构化华文要点 */
  summaryPoints: string[]
  /** 抓取清洗后的完整原文 */
  fullText: string
  /** 完整全文的华文翻译 */
  fullTextZh: string
  impact: NewsImpact
  model: string
  extraction: 'readability' | 'fallback' | 'unavailable'
  cachedAt: string
}

export interface AiVerdict {
  verdict: Verdict
  score: number
  headline: string
  thesis: string
  bullish: string[]
  bearish: string[]
  catalyst: string
  risks: string
  generatedAt: string
  model: string
}

// ---------------------------------------------------------------------------
// 模拟交易（Paper Trading & 多 Profile）
// ---------------------------------------------------------------------------

export type OrderSide = 'buy' | 'sell'
export type OrderType = 'market' | 'limit'
export type OrderStatus = 'filled' | 'open' | 'cancelled' | 'rejected'

/** 持仓（数量与成本均以标的自身计价货币记账） */
export interface Position {
  symbol: string
  name: string
  market: Market
  currency: Currency
  quantity: number
  /** 持仓均价 */
  avgCost: number
  openedAt: string
  updatedAt: string
}

/** 成交记录 */
export interface TradeRecord {
  id: string
  profileId: string
  symbol: string
  name: string
  market: Market
  currency: Currency
  side: OrderSide
  type: OrderType
  quantity: number
  /** 成交价（标的计价货币） */
  price: number
  /** 成交额 = price × quantity（标的计价货币） */
  notional: number
  /** 已实现盈亏（账户基准货币，仅减仓 / 平仓时有意义） */
  realizedPnl: number
  createdAt: string
}

/** 挂单（未触发的限价单） */
export interface PendingOrder {
  id: string
  profileId: string
  symbol: string
  name: string
  market: Market
  currency: Currency
  side: OrderSide
  quantity: number
  limitPrice: number
  createdAt: string
}

/** 交易账户档案（Profile） */
export interface PaperProfile {
  id: string
  name: string
  /** 账户账本货币 */
  currency: Currency
  /** 初始本金（账本货币） */
  initialCapital: number
  /** 可用现金（账本货币） */
  cash: number
  /** USD → MYR 汇率，用于跨币种换算 */
  fxRate: number
  positions: Position[]
  trades: TradeRecord[]
  pending: PendingOrder[]
  createdAt: string
  updatedAt: string
}

/** 账户绩效统计（全部折算为账本货币） */
export interface ProfileStats {
  currency: Currency
  cash: number
  positionsValue: number
  totalValue: number
  unrealizedPnl: number
  realizedPnl: number
  totalPnl: number
  totalPnlPct: number
  /** 胜率 (%) */
  winRate: number
  wins: number
  losses: number
  /** 盈亏比 = 累计盈利 / 累计亏损绝对值 */
  profitFactor: number
  /** 最大回撤 (%) */
  maxDrawdownPct: number
  tradeCount: number
  closedTrades: number
  /** 第一大持仓市值占比 (%) */
  concentrationPct: number
}

/** 下单请求 */
export interface OrderRequest {
  symbol: string
  name: string
  market: Market
  currency: Currency
  side: OrderSide
  type: OrderType
  quantity: number
  /** 限价单委托价（标的计价货币） */
  limitPrice?: number
  /** 撮合参考的最新价（标的计价货币） */
  marketPrice: number
}

/** 下单结果 */
export interface OrderResult {
  ok: boolean
  status: OrderStatus
  reason?: string
  trade?: TradeRecord
  pending?: PendingOrder
}

/** AI 交易复盘结果 */
export interface TradeReview {
  profileId: string
  headline: string
  /** 做得好的地方 */
  strengths: string[]
  /** 需要改善的地方 */
  improvements: string[]
  /** 具体可落地的仓位调整与风控方案 */
  riskPlan: string
  /** 交易纪律评分 0-100 */
  disciplineScore: number
  generatedAt: string
  model: string
  degraded?: boolean
}

/** 深度跨市场宏观周期推演（Pro 层级手动触发） */
export interface MacroCycleAnalysis {
  cyclePhase: string
  headline: string
  transmission: string
  historicalAnalogy: string
  allocations: Array<{
    asset: string
    bias: ImpactDirection
    rationale: string
  }>
  riskNote: string
  generatedAt: string
  model: string
  degraded?: boolean
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


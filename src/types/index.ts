/**
 * APEX Terminal — 领域模型类型定义
 */

export type Market = 'US' | 'BURSA'

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

export interface ApiSettings {
  twelveDataKey: string
  geminiKey: string
  geminiModel: string
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

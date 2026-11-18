import type {
  Currency,
  Fundamentals,
  Quote,
  Security,
} from '@/types'
import { safeNumber } from '@/lib/format'
import { hashString, mulberry32 } from '@/lib/prng'

/**
 * 证券主数据 + 高仿真基准数据。
 * 当未配置任何行情引擎 Key（或请求受限）时，终端将无缝降级使用本模块的数据，
 * 保证任何查询都有可展示的结构化结果。
 */

const CRYPTO = { market: 'CRYPTO' as const, currency: 'USD' as const }

/** 常见数字资产：代码 → 名称、CoinGecko id、基准价、24h 量、流通量 */
export const CRYPTO_ASSETS: Record<
  string,
  { name: string; cgId: string; price: number; vol: number; supply: number }
> = {
  BTC: { name: 'Bitcoin', cgId: 'bitcoin', price: 96500, vol: 2.1e10, supply: 19.8e6 },
  ETH: { name: 'Ethereum', cgId: 'ethereum', price: 3380, vol: 1.4e10, supply: 120e6 },
  SOL: { name: 'Solana', cgId: 'solana', price: 212, vol: 4.2e9, supply: 480e6 },
  BNB: { name: 'BNB', cgId: 'binancecoin', price: 685, vol: 1.8e9, supply: 145e6 },
  XRP: { name: 'XRP', cgId: 'ripple', price: 2.28, vol: 5.6e9, supply: 57e9 },
  ADA: { name: 'Cardano', cgId: 'cardano', price: 0.92, vol: 1.1e9, supply: 35e9 },
  DOGE: { name: 'Dogecoin', cgId: 'dogecoin', price: 0.34, vol: 2.4e9, supply: 147e9 },
  AVAX: { name: 'Avalanche', cgId: 'avalanche-2', price: 38.5, vol: 6.1e8, supply: 410e6 },
  LINK: { name: 'Chainlink', cgId: 'chainlink', price: 22.6, vol: 7.2e8, supply: 640e6 },
  MATIC: { name: 'Polygon', cgId: 'matic-network', price: 0.52, vol: 3.4e8, supply: 10e9 },
  DOT: { name: 'Polkadot', cgId: 'polkadot', price: 7.1, vol: 3.8e8, supply: 1.5e9 },
  LTC: { name: 'Litecoin', cgId: 'litecoin', price: 108, vol: 5.5e8, supply: 75e6 },
  TON: { name: 'Toncoin', cgId: 'the-open-network', price: 5.4, vol: 2.9e8, supply: 2.5e9 },
  SUI: { name: 'Sui', cgId: 'sui', price: 4.25, vol: 1.6e9, supply: 3.1e9 },
  ARB: { name: 'Arbitrum', cgId: 'arbitrum', price: 0.82, vol: 3.1e8, supply: 4.3e9 },
  OP: { name: 'Optimism', cgId: 'optimism', price: 1.78, vol: 2.6e8, supply: 1.3e9 },
}

export interface SecuritySeed {
  symbol: string
  name: string
  exchange: string
  market: Security['market']
  currency: Currency
  sector: string
  industryPE: number
  price: number
  sharesOutstanding: number
  eps: number
  bookValuePerShare: number
  netDebt: number
  ebitda: number
  revenueTTM: number
  freeCashFlow: number
  dividendPerShare: number
  /** 近 5 年 EPS 复合增速 (%) */
  epsGrowth5y: number
  forwardEps: number
  grossMargin: number
  currentRatio: number
  debtToEquity: number
  /** 5 年历史平均市盈率 */
  pe5yAvg: number
  averageVolume: number
}

const US = { market: 'US' as const, currency: 'USD' as const }
const MY = { market: 'BURSA' as const, currency: 'MYR' as const }

const SEEDS: SecuritySeed[] = [
  // ------------------------------------------------ 美股
  {
    ...US, symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', sector: 'Technology', industryPE: 30,
    price: 232.5, sharesOutstanding: 1.51e10, eps: 6.57, bookValuePerShare: 4.9, netDebt: 5.2e10,
    ebitda: 1.34e11, revenueTTM: 3.91e11, freeCashFlow: 1.09e11, dividendPerShare: 0.98,
    epsGrowth5y: 11, forwardEps: 7.35, grossMargin: 46.2, currentRatio: 0.87, debtToEquity: 1.87,
    pe5yAvg: 29.5, averageVolume: 5.4e7,
  },
  {
    ...US, symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', sector: 'Technology', industryPE: 32,
    price: 428, sharesOutstanding: 7.44e9, eps: 12.2, bookValuePerShare: 38.5, netDebt: 2.1e10,
    ebitda: 1.36e11, revenueTTM: 2.62e11, freeCashFlow: 7.4e10, dividendPerShare: 3.0,
    epsGrowth5y: 15, forwardEps: 14.1, grossMargin: 69.4, currentRatio: 1.27, debtToEquity: 0.35,
    pe5yAvg: 33, averageVolume: 2.0e7,
  },
  {
    ...US, symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', sector: 'Technology', industryPE: 30,
    price: 138.2, sharesOutstanding: 2.45e10, eps: 2.53, bookValuePerShare: 2.42, netDebt: -3.4e10,
    ebitda: 8.6e10, revenueTTM: 1.3e11, freeCashFlow: 5.6e10, dividendPerShare: 0.04,
    epsGrowth5y: 45, forwardEps: 4.05, grossMargin: 75, currentRatio: 4.1, debtToEquity: 0.16,
    pe5yAvg: 58, averageVolume: 2.3e8,
  },
  {
    ...US, symbol: 'GOOGL', name: 'Alphabet Inc. Class A', exchange: 'NASDAQ', sector: 'Communication Services', industryPE: 24,
    price: 172, sharesOutstanding: 1.22e10, eps: 7.54, bookValuePerShare: 22.1, netDebt: -9.0e10,
    ebitda: 1.3e11, revenueTTM: 3.48e11, freeCashFlow: 7.3e10, dividendPerShare: 0.8,
    epsGrowth5y: 16, forwardEps: 8.6, grossMargin: 58.2, currentRatio: 1.95, debtToEquity: 0.12,
    pe5yAvg: 26.5, averageVolume: 2.6e7,
  },
  {
    ...US, symbol: 'AMZN', name: 'Amazon.com, Inc.', exchange: 'NASDAQ', sector: 'Consumer Discretionary', industryPE: 28,
    price: 205, sharesOutstanding: 1.05e10, eps: 5.2, bookValuePerShare: 24.6, netDebt: 4.5e10,
    ebitda: 1.3e11, revenueTTM: 6.5e11, freeCashFlow: 3.8e10, dividendPerShare: 0,
    epsGrowth5y: 22, forwardEps: 6.35, grossMargin: 49, currentRatio: 1.06, debtToEquity: 0.55,
    pe5yAvg: 52, averageVolume: 4.0e7,
  },
  {
    ...US, symbol: 'META', name: 'Meta Platforms, Inc.', exchange: 'NASDAQ', sector: 'Communication Services', industryPE: 24,
    price: 585, sharesOutstanding: 2.53e9, eps: 21.6, bookValuePerShare: 78.5, netDebt: 1.5e10,
    ebitda: 9.1e10, revenueTTM: 1.68e11, freeCashFlow: 5.2e10, dividendPerShare: 2.0,
    epsGrowth5y: 18, forwardEps: 25.2, grossMargin: 81.5, currentRatio: 2.7, debtToEquity: 0.28,
    pe5yAvg: 24, averageVolume: 1.3e7,
  },
  {
    ...US, symbol: 'TSLA', name: 'Tesla, Inc.', exchange: 'NASDAQ', sector: 'Consumer Discretionary', industryPE: 28,
    price: 345, sharesOutstanding: 3.21e9, eps: 3.65, bookValuePerShare: 23.1, netDebt: -1.2e10,
    ebitda: 1.55e10, revenueTTM: 9.9e10, freeCashFlow: 3.6e9, dividendPerShare: 0,
    epsGrowth5y: 14, forwardEps: 3.3, grossMargin: 17.8, currentRatio: 2.05, debtToEquity: 0.18,
    pe5yAvg: 92, averageVolume: 9.0e7,
  },
  {
    ...US, symbol: 'JPM', name: 'JPMorgan Chase & Co.', exchange: 'NYSE', sector: 'Financials', industryPE: 13,
    price: 245, sharesOutstanding: 2.85e9, eps: 19.1, bookValuePerShare: 118, netDebt: 0,
    ebitda: 0, revenueTTM: 1.78e11, freeCashFlow: 4.5e10, dividendPerShare: 5.0,
    epsGrowth5y: 8, forwardEps: 18.2, grossMargin: 0, currentRatio: 0, debtToEquity: 1.28,
    pe5yAvg: 11.8, averageVolume: 9.0e6,
  },
  {
    ...US, symbol: 'V', name: 'Visa Inc. Class A', exchange: 'NYSE', sector: 'Financials', industryPE: 28,
    price: 310, sharesOutstanding: 1.95e9, eps: 9.75, bookValuePerShare: 17.6, netDebt: 1.2e10,
    ebitda: 2.5e10, revenueTTM: 3.6e10, freeCashFlow: 1.9e10, dividendPerShare: 2.36,
    epsGrowth5y: 13, forwardEps: 11.1, grossMargin: 0, currentRatio: 1.1, debtToEquity: 1.6,
    pe5yAvg: 30, averageVolume: 6.5e6,
  },
  {
    ...US, symbol: 'XOM', name: 'Exxon Mobil Corporation', exchange: 'NYSE', sector: 'Energy', industryPE: 14,
    price: 118, sharesOutstanding: 4.4e9, eps: 8.1, bookValuePerShare: 62.5, netDebt: 3.2e10,
    ebitda: 6.4e10, revenueTTM: 3.44e11, freeCashFlow: 3.2e10, dividendPerShare: 3.8,
    epsGrowth5y: 5, forwardEps: 7.6, grossMargin: 23.5, currentRatio: 1.35, debtToEquity: 0.21,
    pe5yAvg: 13, averageVolume: 1.6e7,
  },
  {
    ...US, symbol: 'KO', name: 'The Coca-Cola Company', exchange: 'NYSE', sector: 'Consumer Staples', industryPE: 24,
    price: 62.5, sharesOutstanding: 4.31e9, eps: 2.47, bookValuePerShare: 6.3, netDebt: 3.0e10,
    ebitda: 1.55e10, revenueTTM: 4.7e10, freeCashFlow: 9.5e9, dividendPerShare: 1.94,
    epsGrowth5y: 6.5, forwardEps: 2.85, grossMargin: 60.5, currentRatio: 1.05, debtToEquity: 1.63,
    pe5yAvg: 25.5, averageVolume: 1.4e7,
  },
  {
    ...US, symbol: 'JNJ', name: 'Johnson & Johnson', exchange: 'NYSE', sector: 'Healthcare', industryPE: 20,
    price: 155, sharesOutstanding: 2.41e9, eps: 6.1, bookValuePerShare: 29.5, netDebt: 1.1e10,
    ebitda: 3.1e10, revenueTTM: 8.9e10, freeCashFlow: 1.9e10, dividendPerShare: 4.96,
    epsGrowth5y: 7, forwardEps: 10.2, grossMargin: 68.5, currentRatio: 1.1, debtToEquity: 0.55,
    pe5yAvg: 22, averageVolume: 7.0e6,
  },
  {
    ...US, symbol: 'WMT', name: 'Walmart Inc.', exchange: 'NYSE', sector: 'Consumer Staples', industryPE: 26,
    price: 88, sharesOutstanding: 8.05e9, eps: 2.42, bookValuePerShare: 11.2, netDebt: 3.8e10,
    ebitda: 3.9e10, revenueTTM: 6.8e11, freeCashFlow: 1.5e10, dividendPerShare: 0.83,
    epsGrowth5y: 10, forwardEps: 2.6, grossMargin: 24.8, currentRatio: 0.83, debtToEquity: 0.75,
    pe5yAvg: 28, averageVolume: 1.7e7,
  },
  {
    ...US, symbol: 'AMD', name: 'Advanced Micro Devices, Inc.', exchange: 'NASDAQ', sector: 'Technology', industryPE: 30,
    price: 138, sharesOutstanding: 1.62e9, eps: 1.3, bookValuePerShare: 33.8, netDebt: 1.5e9,
    ebitda: 5.5e9, revenueTTM: 2.57e10, freeCashFlow: 3.2e9, dividendPerShare: 0,
    epsGrowth5y: 20, forwardEps: 2.45, grossMargin: 51, currentRatio: 2.6, debtToEquity: 0.05,
    pe5yAvg: 45, averageVolume: 4.5e7,
  },

  // ------------------------------------------------ 马股 Bursa Malaysia
  {
    ...MY, symbol: '1155.KL', name: 'Malayan Banking Bhd (Maybank)', exchange: 'Bursa Malaysia', sector: 'Financials', industryPE: 10.5,
    price: 10.2, sharesOutstanding: 1.206e10, eps: 0.865, bookValuePerShare: 7.6, netDebt: 0,
    ebitda: 0, revenueTTM: 2.75e10, freeCashFlow: 2.2e10, dividendPerShare: 0.61,
    epsGrowth5y: 5.5, forwardEps: 0.9, grossMargin: 0, currentRatio: 0, debtToEquity: 0.9,
    pe5yAvg: 10.4, averageVolume: 9.5e6,
  },
  {
    ...MY, symbol: '1295.KL', name: 'Public Bank Bhd', exchange: 'Bursa Malaysia', sector: 'Financials', industryPE: 12.5,
    price: 4.45, sharesOutstanding: 1.941e10, eps: 0.352, bookValuePerShare: 2.32, netDebt: 0,
    ebitda: 0, revenueTTM: 1.35e10, freeCashFlow: 8.0e9, dividendPerShare: 0.195,
    epsGrowth5y: 4.5, forwardEps: 0.37, grossMargin: 0, currentRatio: 0, debtToEquity: 0.75,
    pe5yAvg: 12.6, averageVolume: 1.3e7,
  },
  {
    ...MY, symbol: '1023.KL', name: 'CIMB Group Holdings Bhd', exchange: 'Bursa Malaysia', sector: 'Financials', industryPE: 10,
    price: 8.1, sharesOutstanding: 1.07e10, eps: 0.72, bookValuePerShare: 5.6, netDebt: 0,
    ebitda: 0, revenueTTM: 2.1e10, freeCashFlow: 1.4e10, dividendPerShare: 0.375,
    epsGrowth5y: 9, forwardEps: 0.76, grossMargin: 0, currentRatio: 0, debtToEquity: 0.95,
    pe5yAvg: 9.8, averageVolume: 1.1e7,
  },
  {
    ...MY, symbol: '1066.KL', name: 'RHB Bank Bhd', exchange: 'Bursa Malaysia', sector: 'Financials', industryPE: 10.5,
    price: 6.35, sharesOutstanding: 4.29e9, eps: 0.7, bookValuePerShare: 6.1, netDebt: 0,
    ebitda: 0, revenueTTM: 1.05e10, freeCashFlow: 7.0e9, dividendPerShare: 0.35,
    epsGrowth5y: 5, forwardEps: 0.73, grossMargin: 0, currentRatio: 0, debtToEquity: 0.88,
    pe5yAvg: 10.2, averageVolume: 4.5e6,
  },
  {
    ...MY, symbol: '5819.KL', name: 'Hong Leong Bank Bhd', exchange: 'Bursa Malaysia', sector: 'Financials', industryPE: 12.5,
    price: 20.5, sharesOutstanding: 2.05e9, eps: 2.05, bookValuePerShare: 14.0, netDebt: 0,
    ebitda: 0, revenueTTM: 1.0e10, freeCashFlow: 5.5e9, dividendPerShare: 0.83,
    epsGrowth5y: 6, forwardEps: 2.15, grossMargin: 0, currentRatio: 0, debtToEquity: 0.82,
    pe5yAvg: 12.4, averageVolume: 1.5e6,
  },
  {
    ...MY, symbol: '5347.KL', name: 'Tenaga Nasional Bhd', exchange: 'Bursa Malaysia', sector: 'Utilities', industryPE: 15,
    price: 14.4, sharesOutstanding: 5.78e9, eps: 0.98, bookValuePerShare: 10.3, netDebt: 5.2e10,
    ebitda: 1.85e10, revenueTTM: 5.75e10, freeCashFlow: 5.0e9, dividendPerShare: 0.46,
    epsGrowth5y: 6.5, forwardEps: 1.02, grossMargin: 22, currentRatio: 1.1, debtToEquity: 0.55,
    pe5yAvg: 16.5, averageVolume: 6.0e6,
  },
  {
    ...MY, symbol: '6033.KL', name: 'Petronas Gas Bhd', exchange: 'Bursa Malaysia', sector: 'Utilities', industryPE: 15,
    price: 17.5, sharesOutstanding: 1.978e9, eps: 1.05, bookValuePerShare: 7.0, netDebt: 1.5e9,
    ebitda: 3.6e9, revenueTTM: 6.6e9, freeCashFlow: 2.4e9, dividendPerShare: 0.72,
    epsGrowth5y: 3, forwardEps: 1.08, grossMargin: 35, currentRatio: 2.2, debtToEquity: 0.25,
    pe5yAvg: 18.5, averageVolume: 1.8e6,
  },
  {
    ...MY, symbol: '5183.KL', name: 'Petronas Chemicals Group Bhd', exchange: 'Bursa Malaysia', sector: 'Materials', industryPE: 13,
    price: 3.62, sharesOutstanding: 8.0e9, eps: 0.22, bookValuePerShare: 3.4, netDebt: 1.2e9,
    ebitda: 3.6e9, revenueTTM: 3.05e10, freeCashFlow: 2.0e9, dividendPerShare: 0.16,
    epsGrowth5y: -3.5, forwardEps: 0.24, grossMargin: 20, currentRatio: 2.4, debtToEquity: 0.12,
    pe5yAvg: 14, averageVolume: 4.5e6,
  },
  {
    ...MY, symbol: '3816.KL', name: 'MISC Bhd', exchange: 'Bursa Malaysia', sector: 'Energy', industryPE: 14,
    price: 7.4, sharesOutstanding: 4.465e9, eps: 0.62, bookValuePerShare: 4.9, netDebt: 2.6e10,
    ebitda: 8.5e9, revenueTTM: 1.38e10, freeCashFlow: 4.2e9, dividendPerShare: 0.36,
    epsGrowth5y: 7, forwardEps: 0.66, grossMargin: 30, currentRatio: 1.35, debtToEquity: 0.65,
    pe5yAvg: 14, averageVolume: 3.0e6,
  },
  {
    ...MY, symbol: '4863.KL', name: 'Telekom Malaysia Bhd', exchange: 'Bursa Malaysia', sector: 'Communication Services', industryPE: 22,
    price: 6.95, sharesOutstanding: 3.838e9, eps: 0.48, bookValuePerShare: 3.1, netDebt: 6.0e9,
    ebitda: 4.6e9, revenueTTM: 1.22e10, freeCashFlow: 2.8e9, dividendPerShare: 0.25,
    epsGrowth5y: 8, forwardEps: 0.52, grossMargin: 48, currentRatio: 1.05, debtToEquity: 0.6,
    pe5yAvg: 14.5, averageVolume: 3.5e6,
  },
  {
    ...MY, symbol: '6012.KL', name: 'Maxis Bhd', exchange: 'Bursa Malaysia', sector: 'Communication Services', industryPE: 22,
    price: 3.72, sharesOutstanding: 7.83e9, eps: 0.17, bookValuePerShare: 1.0, netDebt: 9.5e9,
    ebitda: 4.2e9, revenueTTM: 1.06e10, freeCashFlow: 2.6e9, dividendPerShare: 0.16,
    epsGrowth5y: 1.5, forwardEps: 0.18, grossMargin: 55, currentRatio: 0.75, debtToEquity: 1.25,
    pe5yAvg: 32, averageVolume: 7.0e6,
  },
  {
    ...MY, symbol: '6947.KL', name: 'Axiata Group Bhd', exchange: 'Bursa Malaysia', sector: 'Communication Services', industryPE: 22,
    price: 2.35, sharesOutstanding: 9.18e9, eps: 0.09, bookValuePerShare: 2.6, netDebt: 3.4e10,
    ebitda: 1.15e10, revenueTTM: 2.2e10, freeCashFlow: 3.5e9, dividendPerShare: 0.1,
    epsGrowth5y: 2, forwardEps: 0.11, grossMargin: 45, currentRatio: 0.85, debtToEquity: 1.15,
    pe5yAvg: 28, averageVolume: 8.0e6,
  },
  {
    ...MY, symbol: '5225.KL', name: 'IHH Healthcare Bhd', exchange: 'Bursa Malaysia', sector: 'Healthcare', industryPE: 28,
    price: 7.25, sharesOutstanding: 8.81e9, eps: 0.285, bookValuePerShare: 3.5, netDebt: 1.35e10,
    ebitda: 5.7e9, revenueTTM: 2.4e10, freeCashFlow: 2.4e9, dividendPerShare: 0.055,
    epsGrowth5y: 12, forwardEps: 0.31, grossMargin: 32, currentRatio: 1.2, debtToEquity: 0.42,
    pe5yAvg: 32, averageVolume: 5.5e6,
  },
  {
    ...MY, symbol: '5296.KL', name: 'MR D.I.Y. Group (M) Bhd', exchange: 'Bursa Malaysia', sector: 'Consumer Discretionary', industryPE: 22,
    price: 1.62, sharesOutstanding: 6.29e9, eps: 0.055, bookValuePerShare: 0.19, netDebt: -1.2e9,
    ebitda: 9.5e8, revenueTTM: 4.6e9, freeCashFlow: 6.5e8, dividendPerShare: 0.03,
    epsGrowth5y: 12, forwardEps: 0.062, grossMargin: 45, currentRatio: 2.5, debtToEquity: 0.08,
    pe5yAvg: 26, averageVolume: 1.2e7,
  },
  {
    ...MY, symbol: '1961.KL', name: 'IOI Corporation Bhd', exchange: 'Bursa Malaysia', sector: 'Consumer Staples', industryPE: 20,
    price: 3.95, sharesOutstanding: 6.2e9, eps: 0.17, bookValuePerShare: 1.9, netDebt: 5.5e9,
    ebitda: 4.0e9, revenueTTM: 1.15e10, freeCashFlow: 1.8e9, dividendPerShare: 0.1,
    epsGrowth5y: 4, forwardEps: 0.19, grossMargin: 25, currentRatio: 1.4, debtToEquity: 0.45,
    pe5yAvg: 22, averageVolume: 5.0e6,
  },
  {
    ...MY, symbol: '4707.KL', name: 'Nestlé (Malaysia) Bhd', exchange: 'Bursa Malaysia', sector: 'Consumer Staples', industryPE: 22,
    price: 98, sharesOutstanding: 2.345e8, eps: 2.65, bookValuePerShare: 4.3, netDebt: 2.0e9,
    ebitda: 1.15e9, revenueTTM: 7.0e9, freeCashFlow: 6.0e8, dividendPerShare: 2.9,
    epsGrowth5y: 5, forwardEps: 2.8, grossMargin: 38, currentRatio: 0.95, debtToEquity: 1.95,
    pe5yAvg: 44, averageVolume: 2.0e6,
  },
  {
    ...MY, symbol: '7113.KL', name: 'Top Glove Corporation Bhd', exchange: 'Bursa Malaysia', sector: 'Healthcare', industryPE: 28,
    price: 0.85, sharesOutstanding: 8.2e9, eps: -0.005, bookValuePerShare: 0.55, netDebt: 4.0e8,
    ebitda: 6.0e7, revenueTTM: 5.4e9, freeCashFlow: -3.0e7, dividendPerShare: 0,
    epsGrowth5y: -15, forwardEps: 0.012, grossMargin: 12, currentRatio: 1.3, debtToEquity: 0.25,
    pe5yAvg: 18, averageVolume: 2.5e7,
  },
]

// ---------------------------------------------------------------------------
// 确定性伪随机：同一 symbol 永远得到同一套数据，避免刷新后数值乱跳
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 派生计算
// ---------------------------------------------------------------------------

const SECTOR_CYCLE = [
  'Technology',
  'Financials',
  'Healthcare',
  'Consumer Staples',
  'Industrials',
  'Energy',
  'Utilities',
  'Materials',
  'Communication Services',
  'Consumer Discretionary',
  'Real Estate',
]

function derivedMetrics(seed: SecuritySeed) {
  const marketCap = seed.price * seed.sharesOutstanding
  const totalEquity = Math.max(seed.bookValuePerShare * seed.sharesOutstanding, 1)
  const netIncome = seed.eps * seed.sharesOutstanding
  const netMargin = seed.revenueTTM > 0 ? (netIncome / seed.revenueTTM) * 100 : 0
  const roe = seed.bookValuePerShare !== 0 ? (seed.eps / seed.bookValuePerShare) * 100 : 0
  const peTTM = seed.eps !== 0 ? seed.price / seed.eps : Number.NaN
  const pb = seed.bookValuePerShare !== 0 ? seed.price / seed.bookValuePerShare : Number.NaN
  const peg = seed.epsGrowth5y > 0.5 && Number.isFinite(peTTM) ? peTTM / seed.epsGrowth5y : Number.NaN
  const enterpriseValue = marketCap + seed.netDebt
  const evEbitda = seed.ebitda > 0 ? enterpriseValue / seed.ebitda : Number.NaN
  const dividendYield = seed.dividendPerShare > 0 ? (seed.dividendPerShare / seed.price) * 100 : 0
  const payoutRatio = seed.eps > 0 ? (seed.dividendPerShare / seed.eps) * 100 : 0
  const fcfYield = marketCap > 0 ? (seed.freeCashFlow / marketCap) * 100 : 0
  return {
    marketCap,
    totalEquity,
    netIncome,
    netMargin,
    roe,
    peTTM,
    pb,
    peg,
    enterpriseValue,
    evEbitda,
    dividendYield,
    payoutRatio,
    fcfYield,
  }
}

function buildSpark(seed: SecuritySeed, previousClose: number): number[] {
  const rand = mulberry32(hashString(`${seed.symbol}:spark`))
  const points = 64
  const drift = (seed.price - previousClose) / points
  const out: number[] = []
  let value = previousClose
  for (let i = 0; i < points; i += 1) {
    const noise = (rand() - 0.5) * seed.price * 0.011
    value = Math.max(value + drift + noise, seed.price * 0.5)
    out.push(value)
  }
  out[points - 1] = seed.price
  return out
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/** 归一化代码：大写、去空格；纯数字 4 位自动补 .KL（Bursa 惯例） */
export function normalizeSymbol(input: string): string {
  const raw = input.trim().toUpperCase().replace(/\s+/g, '')
  if (!raw) return ''
  if (/^\d{4}$/.test(raw)) return `${raw}.KL`
  return raw
}

function seedToSecurity(seed: SecuritySeed): Security {
  return {
    symbol: seed.symbol,
    name: seed.name,
    exchange: seed.exchange,
    market: seed.market,
    currency: seed.currency,
    sector: seed.sector,
    industryPE: seed.industryPE,
  }
}

/** 未知代码的确定性合成主数据——保证任意搜索都有结果，不会白屏 */
function synthesizeSeed(symbol: string): SecuritySeed {
  const rand = mulberry32(hashString(`${symbol}:seed`))
  const isBursa = symbol.endsWith('.KL')
  const base = isBursa ? 1 + rand() * 12 : 20 + rand() * 380
  const shares = (isBursa ? 0.5 + rand() * 12 : 0.3 + rand() * 12) * 1e9
  const epsMargin = 0.03 + rand() * 0.09
  const bookRatio = 1.4 + rand() * 6
  const sector = SECTOR_CYCLE[Math.floor(rand() * SECTOR_CYCLE.length)] ?? 'Technology'
  const growth = -4 + rand() * 26
  return {
    market: isBursa ? 'BURSA' : 'US',
    currency: isBursa ? 'MYR' : 'USD',
    symbol,
    name: `${symbol.replace(/\.KL$/, '')} ${isBursa ? '(Bursa Malaysia)' : 'Corporation'}`,
    exchange: isBursa ? 'Bursa Malaysia' : 'US Composite',
    sector,
    industryPE: 12 + rand() * 20,
    price: base,
    sharesOutstanding: shares,
    eps: base * epsMargin,
    bookValuePerShare: base / bookRatio,
    netDebt: (rand() - 0.35) * base * shares * 0.25,
    ebitda: base * epsMargin * shares * (1.2 + rand()),
    revenueTTM: base * shares * (0.25 + rand() * 1.1),
    freeCashFlow: base * epsMargin * shares * (0.4 + rand() * 1.1),
    dividendPerShare: rand() > 0.35 ? base * (0.005 + rand() * 0.045) : 0,
    epsGrowth5y: growth,
    forwardEps: base * epsMargin * (0.85 + rand() * 0.5),
    grossMargin: 15 + rand() * 55,
    currentRatio: 0.7 + rand() * 2.6,
    debtToEquity: rand() * 1.8,
    pe5yAvg: 11 + rand() * 26,
    averageVolume: (isBursa ? 1 + rand() * 20 : 2 + rand() * 60) * 1e6,
  }
}

const SEED_MAP: Map<string, SecuritySeed> = new Map(
  SEEDS.map((seed) => [seed.symbol, seed]),
)

const CRYPTO_QUOTES = ['USDT', 'USDC', 'BUSD', 'USD'] as const

/**
 * 识别数字资产代码：支持 `BTC`、`BTCUSD`、`BTC-USD`、`BTCUSDT`、`BTC/USDT`。
 * 带 `.KL` 的一律视为马股；裸代码需在数字资产表中且不在证券主数据表内。
 */
export function detectCrypto(input: string): { key: string; cgId: string } | null {
  const compact = input.trim().toUpperCase().replace(/[\s/_-]/g, '')
  if (!compact || compact.endsWith('.KL')) return null
  for (const suffix of CRYPTO_QUOTES) {
    if (compact.length > suffix.length && compact.endsWith(suffix)) {
      const base = compact.slice(0, -suffix.length)
      const meta = CRYPTO_ASSETS[base]
      if (meta && !SEED_MAP.has(base)) return { key: base, cgId: meta.cgId }
    }
  }
  const meta = CRYPTO_ASSETS[compact]
  if (meta && compact.length >= 3 && !SEED_MAP.has(compact)) return { key: compact, cgId: meta.cgId }
  return null
}

export function isCryptoAsset(symbol: string): boolean {
  return detectCrypto(symbol) !== null
}

/** 数字资产的基准主数据（基本面不适用，仅用于行情与图表） */
function cryptoSeed(symbol: string, key: string): SecuritySeed {
  const meta = CRYPTO_ASSETS[key]!
  const rand = mulberry32(hashString(`${key}:crypto`))
  const price = meta.price * (0.985 + rand() * 0.03)
  const supply = meta.supply
  return {
    ...CRYPTO,
    symbol,
    name: `${meta.name} / USDT`,
    exchange: 'Binance · CoinGecko',
    sector: 'Digital Assets',
    industryPE: 0,
    price,
    sharesOutstanding: supply,
    eps: 0,
    bookValuePerShare: 0,
    netDebt: 0,
    ebitda: 0,
    revenueTTM: 0,
    freeCashFlow: 0,
    dividendPerShare: 0,
    epsGrowth5y: 0,
    forwardEps: 0,
    grossMargin: 0,
    currentRatio: 0,
    debtToEquity: 0,
    pe5yAvg: 0,
    averageVolume: meta.vol,
  }
}

export function getSeed(symbol: string): SecuritySeed {
  const normalized = normalizeSymbol(symbol)
  const seeded = SEED_MAP.get(normalized)
  if (seeded) return seeded
  const crypto = detectCrypto(normalized)
  if (crypto) return cryptoSeed(normalized, crypto.key)
  return synthesizeSeed(normalized)
}

export const ALL_SECURITIES: Security[] = SEEDS.map(seedToSecurity)

/** 数字资产主数据（用于搜索与行情墙） */
export const CRYPTO_SECURITIES: Security[] = Object.entries(CRYPTO_ASSETS).map(([key]) =>
  seedToSecurity(cryptoSeed(`${key}USDT`, key)),
)

export const ALL_INSTRUMENTS: Security[] = [...ALL_SECURITIES, ...CRYPTO_SECURITIES]

function matchScore(security: Security, query: string): number {
  const symbol = security.symbol
  const name = security.name.toUpperCase()
  if (symbol === query) return 120
  if (symbol.startsWith(query)) return 90
  if (symbol.replace('.KL', '').startsWith(query)) return 80
  if (symbol.includes(query)) return 60
  if (name.includes(query)) return 45
  if (security.sector.toUpperCase().includes(query)) return 20
  return 0
}

/** 本地检索：支持代码、名称与行业关键词（含数字资产） */
export function searchSecurities(query: string, limit = 8): Security[] {
  const q = query.trim().toUpperCase()
  if (!q) return []
  return ALL_INSTRUMENTS.map((security) => ({ security, score: matchScore(security, q) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.security)
}

/** 热门标的，用于搜索栏快捷入口与行情墙 */
export const FEATURED_SYMBOLS = [
  'AAPL',
  'NVDA',
  'TSLA',
  'BTCUSDT',
  '1155.KL',
  '1295.KL',
  '1023.KL',
  '5347.KL',
] as const


export function isKnownSymbol(symbol: string): boolean {
  return SEED_MAP.has(normalizeSymbol(symbol))
}

/** 主数据解析：命中基准表则返回真实条目，否则确定性合成 */
export function resolveSecurity(input: string): Security {
  return seedToSecurity(getSeed(input))
}

/** 基准行情快照 */
export function baselineQuote(symbol: string): Quote {
  const seed = getSeed(symbol)
  const normalized = normalizeSymbol(symbol)
  const rand = mulberry32(hashString(`${normalized}:quote`))
  const previousClose = seed.price * (1 - (rand() - 0.5) * 0.03)
  const change = seed.price - previousClose
  const spark = buildSpark({ ...seed, symbol: normalized }, previousClose)
  const high = Math.max(...spark)
  const low = Math.min(...spark)
  return {
    symbol: normalized,
    price: seed.price,
    previousClose,
    change,
    changePercent: previousClose !== 0 ? (change / previousClose) * 100 : 0,
    open: previousClose * (1 + (rand() - 0.5) * 0.006),
    dayHigh: high,
    dayLow: low,
    volume: seed.averageVolume * (0.55 + rand() * 1.05),
    averageVolume: seed.averageVolume,
    fiftyTwoWeekHigh: seed.price * (1.12 + rand() * 0.4),
    fiftyTwoWeekLow: seed.price * (1 - (0.14 + rand() * 0.3)),
    marketCap: seed.price * seed.sharesOutstanding,
    currency: seed.currency,
    updatedAt: new Date().toISOString(),
    origin: 'baseline',
    spark,
  }
}

/** 基准基本面 */
export function baselineFundamentals(symbol: string): Fundamentals {
  const seed = getSeed(symbol)
  const d = derivedMetrics(seed)
  return {
    eps: seed.eps,
    bookValuePerShare: seed.bookValuePerShare,
    peTTM: d.peTTM,
    pe5yAvg: seed.pe5yAvg,
    pb: d.pb,
    peg: d.peg,
    evEbitda: d.evEbitda,
    roe: d.roe,
    grossMargin: seed.grossMargin,
    netMargin: d.netMargin,
    dividendPerShare: seed.dividendPerShare,
    dividendYield: d.dividendYield,
    payoutRatio: d.payoutRatio,
    epsGrowth5y: seed.epsGrowth5y,
    forwardEps: seed.forwardEps,
    fcfYield: d.fcfYield,
    marketCap: d.marketCap,
    enterpriseValue: d.enterpriseValue,
    netDebt: seed.netDebt,
    ebitda: seed.ebitda,
    totalEquity: d.totalEquity,
    sharesOutstanding: seed.sharesOutstanding,
    revenueTTM: seed.revenueTTM,
    netIncomeTTM: d.netIncome,
    freeCashFlow: seed.freeCashFlow,
    currentRatio: seed.currentRatio,
    debtToEquity: seed.debtToEquity,
  }
}

export function securitySectorOf(symbol: string): string {
  return getSeed(symbol).sector
}

export function securityIndustryPE(symbol: string): number {
  return getSeed(symbol).industryPE
}

/** 把外部（Twelve Data）数值覆盖到基准值之上的工具 */
export function mergeNumber(primary: unknown, fallback: number): number {
  const value = safeNumber(primary, Number.NaN)
  return Number.isFinite(value) ? value : fallback
}

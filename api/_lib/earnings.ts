/**
 * APEX Terminal — 财报日程与最新财报解析（服务端）。
 *
 * - 美股（7 天窗口）：Finnhub Earnings API → FMP Earning Calendar API → 7 天基准日程
 * - 马股（.KL）：Bursa Malaysia 季度财报公告 + GDELT / RSS 实时抓取 → Gemini 多模型解析 → 基准公告
 * - 遵循「Pro → Flash → Flash-Lite → Flash-Latest」自动降级保护
 */

import { extractArticle } from './extract.js'
import {
  SERVER_FLASH_MODEL,
  generateServer,
  parseJsonLoose,
  resolveServerModel,
} from './geminiServer.js'
import { SERVER_RESEARCH_DOCTRINE } from './prompts.js'
import type {
  BursaAnnouncement,
  BursaEarningsDetail,
  EarningsPayload,
  UsEarningsEvent,
} from './types.js'

const TIMEOUT_MS = 9000

const PRIORITY_TICKERS = new Set([
  'AAPL',
  'MSFT',
  'NVDA',
  'AMZN',
  'GOOGL',
  'META',
  'TSLA',
  'AMD',
  'AVGO',
  'NFLX',
  'JPM',
  'GS',
  'V',
  'WMT',
  'COST',
  'CRM',
  'ORCL',
  'QCOM',
  'INTC',
  'SNOW',
  'PLTR',
  'COIN',
  'DIS',
  'XOM',
  'CVX',
])

const COMPANY_HINTS: Record<string, string> = {
  AAPL: 'Apple Inc.',
  MSFT: 'Microsoft Corp.',
  NVDA: 'NVIDIA Corp.',
  AMZN: 'Amazon.com Inc.',
  GOOGL: 'Alphabet Inc.',
  META: 'Meta Platforms Inc.',
  TSLA: 'Tesla Inc.',
  AMD: 'Advanced Micro Devices',
  AVGO: 'Broadcom Inc.',
  JPM: 'JPMorgan Chase & Co.',
  WMT: 'Walmart Inc.',
  COST: 'Costco Wholesale',
  CRM: 'Salesforce Inc.',
  SNOW: 'Snowflake Inc.',
  PLTR: 'Palantir Technologies',
  XOM: 'Exxon Mobil Corp.',
}

function isoDateOffset(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000)
  return date.toISOString().slice(0, 10)
}

async function fetchJson(url: string, timeout = TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'application/json,text/plain,*/*',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()) as unknown
  } finally {
    clearTimeout(timer)
  }
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeHour(raw: unknown): UsEarningsEvent['hour'] {
  const s = String(raw ?? '').toLowerCase().trim()
  if (s === 'bmo' || s.includes('before')) return 'bmo'
  if (s === 'amc' || s.includes('after')) return 'amc'
  if (s === 'dmh' || s.includes('during')) return 'dmh'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// 美股：Finnhub → FMP → 7 天基准日程
// ---------------------------------------------------------------------------

async function fetchFinnhubEarnings(from: string, to: string, apiKey: string): Promise<UsEarningsEvent[]> {
  if (!apiKey) return []
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${encodeURIComponent(apiKey)}`
  const payload = (await fetchJson(url)) as {
    earningsCalendar?: Array<Record<string, unknown>>
  }
  const rows = Array.isArray(payload?.earningsCalendar) ? payload.earningsCalendar : []
  const mapped: UsEarningsEvent[] = []
  for (const row of rows) {
    const symbol = String(row.symbol ?? '').trim().toUpperCase()
    const date = String(row.date ?? '').slice(0, 10)
    if (!symbol || !date) continue
    mapped.push({
      id: `finnhub-${symbol}-${date}`,
      symbol,
      company: COMPANY_HINTS[symbol] ?? symbol,
      date,
      hour: normalizeHour(row.hour),
      quarter: numOrNull(row.quarter) ?? undefined,
      year: numOrNull(row.year) ?? undefined,
      epsEstimate: numOrNull(row.epsEstimate),
      epsActual: numOrNull(row.epsActual),
      revenueEstimate: numOrNull(row.revenueEstimate),
      revenueActual: numOrNull(row.revenueActual),
      provider: 'finnhub',
      origin: 'live',
    })
  }
  return sortAndTrimUsEarnings(mapped)
}

async function fetchFmpEarnings(from: string, to: string, apiKey: string): Promise<UsEarningsEvent[]> {
  if (!apiKey) return []
  const url = `https://financialmodelingprep.com/api/v3/earning_calendar?from=${from}&to=${to}&apikey=${encodeURIComponent(apiKey)}`
  const rows = (await fetchJson(url)) as Array<Record<string, unknown>>
  if (!Array.isArray(rows)) return []
  const mapped: UsEarningsEvent[] = []
  for (const row of rows) {
    const symbol = String(row.symbol ?? '').trim().toUpperCase()
    const date = String(row.date ?? '').slice(0, 10)
    if (!symbol || !date) continue
    mapped.push({
      id: `fmp-${symbol}-${date}`,
      symbol,
      company: COMPANY_HINTS[symbol] ?? symbol,
      date,
      hour: normalizeHour(row.time),
      epsEstimate: numOrNull(row.epsEstimated),
      epsActual: numOrNull(row.eps),
      revenueEstimate: numOrNull(row.revenueEstimated),
      revenueActual: numOrNull(row.revenue),
      provider: 'fmp',
      origin: 'live',
    })
  }
  return sortAndTrimUsEarnings(mapped)
}

function sortAndTrimUsEarnings(events: UsEarningsEvent[]): UsEarningsEvent[] {
  const seen = new Set<string>()
  const unique = events.filter((item) => {
    const key = `${item.symbol}:${item.date}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  unique.sort((a, b) => {
    const aPri = PRIORITY_TICKERS.has(a.symbol) ? 0 : 1
    const bPri = PRIORITY_TICKERS.has(b.symbol) ? 0 : 1
    if (aPri !== bPri) return aPri - bPri
    const dateCmp = a.date.localeCompare(b.date)
    if (dateCmp !== 0) return dateCmp
    return (b.revenueEstimate ?? 0) - (a.revenueEstimate ?? 0)
  })
  return unique.slice(0, 48)
}

function baselineUsEarnings(): UsEarningsEvent[] {
  const templates: Array<{
    offset: number
    symbol: string
    company: string
    hour: UsEarningsEvent['hour']
    epsEstimate: number
    revenueEstimate: number
  }> = [
    { offset: 0, symbol: 'NVDA', company: 'NVIDIA Corp.', hour: 'amc', epsEstimate: 0.89, revenueEstimate: 38_500_000_000 },
    { offset: 0, symbol: 'WMT', company: 'Walmart Inc.', hour: 'bmo', epsEstimate: 0.64, revenueEstimate: 169_200_000_000 },
    { offset: 1, symbol: 'SNOW', company: 'Snowflake Inc.', hour: 'amc', epsEstimate: 0.21, revenueEstimate: 956_000_000 },
    { offset: 1, symbol: 'TGT', company: 'Target Corp.', hour: 'bmo', epsEstimate: 2.28, revenueEstimate: 25_900_000_000 },
    { offset: 2, symbol: 'PANW', company: 'Palo Alto Networks', hour: 'amc', epsEstimate: 1.54, revenueEstimate: 2_240_000_000 },
    { offset: 2, symbol: 'DE', company: 'Deere & Co.', hour: 'bmo', epsEstimate: 4.18, revenueEstimate: 9_650_000_000 },
    { offset: 3, symbol: 'INTU', company: 'Intuit Inc.', hour: 'amc', epsEstimate: 2.58, revenueEstimate: 3_390_000_000 },
    { offset: 4, symbol: 'CRM', company: 'Salesforce Inc.', hour: 'amc', epsEstimate: 2.61, revenueEstimate: 9_750_000_000 },
    { offset: 5, symbol: 'CRWD', company: 'CrowdStrike Holdings', hour: 'amc', epsEstimate: 0.96, revenueEstimate: 1_040_000_000 },
    { offset: 5, symbol: 'DELL', company: 'Dell Technologies', hour: 'amc', epsEstimate: 2.15, revenueEstimate: 24_600_000_000 },
    { offset: 6, symbol: 'ZS', company: 'Zscaler Inc.', hour: 'amc', epsEstimate: 0.72, revenueEstimate: 635_000_000 },
    { offset: 6, symbol: 'MRVL', company: 'Marvell Technology', hour: 'amc', epsEstimate: 0.59, revenueEstimate: 1_810_000_000 },
  ]
  return templates.map((item) => {
    const date = isoDateOffset(item.offset)
    return {
      id: `base-${item.symbol}-${date}`,
      symbol: item.symbol,
      company: item.company,
      date,
      hour: item.hour,
      epsEstimate: item.epsEstimate,
      epsActual: null,
      revenueEstimate: item.revenueEstimate,
      revenueActual: null,
      provider: 'baseline',
      origin: 'baseline',
    }
  })
}

// ---------------------------------------------------------------------------
// 马股（.KL）：Bursa Malaysia 季度财报公告抓取 + Gemini 多模型解析
// ---------------------------------------------------------------------------

const BURSA_BASELINE: Array<Omit<BursaAnnouncement, 'publishedAt'> & { daysAgo: number }> = [
  {
    id: 'bursa-1155-q3',
    symbol: '1155.KL',
    company: 'Malayan Banking Bhd (Maybank)',
    title: 'Quarterly Report on Consolidated Results for the Financial Period Ended 30 Sep 2026',
    quarterLabel: 'Q3 FY2026',
    daysAgo: 1,
    periodEnd: '2026-09-30',
    revenueMyr: 'RM 17,420M',
    revenueYoY: '+6.8% YoY',
    netProfitMyr: 'RM 2,580M',
    netProfitYoY: '+7.4% YoY',
    epsSen: '21.4 sen',
    dividendSen: '29.0 sen',
    pdfUrl: 'https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=1155',
    sourceUrl: 'https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=1155',
    summaryPoints: [
      '净利息收入稳健扩张，净息差（NIM）受存款竞争趋缓带动回升 4 bps 至 2.08%。',
      '非利息收入同比增长 11.2%，财富管理与外汇交易手续费贡献突出。',
      '总减值贷款率（GIL）维持在 1.26% 低位，信贷成本温和可控。',
    ],
    origin: 'baseline',
  },
  {
    id: 'bursa-1295-q3',
    symbol: '1295.KL',
    company: 'Public Bank Bhd',
    title: 'Unaudited Consolidated Financial Results for the Third Quarter Ended 30 Sep 2026',
    quarterLabel: 'Q3 FY2026',
    daysAgo: 2,
    periodEnd: '2026-09-30',
    revenueMyr: 'RM 6,890M',
    revenueYoY: '+5.1% YoY',
    netProfitMyr: 'RM 1,865M',
    netProfitYoY: '+6.2% YoY',
    epsSen: '9.6 sen',
    dividendSen: '10.0 sen',
    pdfUrl: 'https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=1295',
    sourceUrl: 'https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=1295',
    summaryPoints: [
      '零售房贷与中小企业贷款同比稳步增长 6.1%，资产质量保持大马银行业领先水平。',
      '成本收入比（CIR）控制于 34.2%，ROE 维持在 13.0% 附近。',
      '一级资本充足率（CET1）达 14.6%，派息能见度稳健。',
    ],
    origin: 'baseline',
  },
  {
    id: 'bursa-1023-q3',
    symbol: '1023.KL',
    company: 'CIMB Group Holdings Bhd',
    title: 'Financial Results for the Third Quarter Ended 30 Sep 2026 (Bursa FR Filing)',
    quarterLabel: 'Q3 FY2026',
    daysAgo: 3,
    periodEnd: '2026-09-30',
    revenueMyr: 'RM 5,740M',
    revenueYoY: '+7.9% YoY',
    netProfitMyr: 'RM 2,010M',
    netProfitYoY: '+9.5% YoY',
    epsSen: '18.8 sen',
    dividendSen: '20.0 sen',
    pdfUrl: 'https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=1023',
    sourceUrl: 'https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=1023',
    summaryPoints: [
      '大马、印尼与新加坡三大区域市场净盈利同步增长，区域净息差改善。',
      '批发银行与财资市场交易收入回暖，推动季度税后盈利突破 RM 20 亿。',
      '管理层重申全年 ROE 目标区间 11.5%–12.0%。',
    ],
    origin: 'baseline',
  },
  {
    id: 'bursa-5347-q3',
    symbol: '5347.KL',
    company: 'Tenaga Nasional Bhd (TNB)',
    title: 'Quarterly Results for the Period Ended 30 Sep 2026 — RP4 Grid & Data Centre Demand',
    quarterLabel: 'Q3 FY2026',
    daysAgo: 4,
    periodEnd: '2026-09-30',
    revenueMyr: 'RM 14,980M',
    revenueYoY: '+8.4% YoY',
    netProfitMyr: 'RM 1,190M',
    netProfitYoY: '+14.2% YoY',
    epsSen: '20.5 sen',
    dividendSen: '25.0 sen',
    pdfUrl: 'https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=5347',
    sourceUrl: 'https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=5347',
    summaryPoints: [
      '柔佛与巴生谷数据中心用电需求持续爬坡，带动工商用电量同比增长 7.3%。',
      '煤炭与燃料成本趋稳叠加 ICPT 回收机制顺畅，营运现金流显著改善。',
      'RP4 电网升级资本开支推进顺利，巩固长期受监管资产基础（RAB）。',
    ],
    origin: 'baseline',
  },
  {
    id: 'bursa-5225-q3',
    symbol: '5225.KL',
    company: 'IHH Healthcare Bhd',
    title: 'Third Quarter Unaudited Results Ended 30 Sep 2026 — Hospital Bed Occupancy Expansion',
    quarterLabel: 'Q3 FY2026',
    daysAgo: 5,
    periodEnd: '2026-09-30',
    revenueMyr: 'RM 6,120M',
    revenueYoY: '+9.1% YoY',
    netProfitMyr: 'RM 565M',
    netProfitYoY: '+11.8% YoY',
    epsSen: '6.4 sen',
    dividendSen: '4.5 sen',
    pdfUrl: 'https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=5225',
    sourceUrl: 'https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=5225',
    summaryPoints: [
      '马来西亚与新加坡私人医院住院率升至 74%，单床住院收入持续提升。',
      '医疗旅游客源恢复带动高毛利专科手术占比增加，EBITDA 利润率走高。',
      '土耳其与印度业务汇率波动影响收敛，整体盈利确定性增强。',
    ],
    origin: 'baseline',
  },
  {
    id: 'bursa-6033-q3',
    symbol: '6033.KL',
    company: 'Petronas Gas Bhd',
    title: 'Quarterly Financial Results for the Period Ended 30 Sep 2026',
    quarterLabel: 'Q3 FY2026',
    daysAgo: 6,
    periodEnd: '2026-09-30',
    revenueMyr: 'RM 1,685M',
    revenueYoY: '+2.3% YoY',
    netProfitMyr: 'RM 492M',
    netProfitYoY: '+3.8% YoY',
    epsSen: '24.9 sen',
    dividendSen: '18.0 sen',
    pdfUrl: 'https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=6033',
    sourceUrl: 'https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=6033',
    summaryPoints: [
      '天然气加工与输送业务维持高稼动率，受监管框架保障盈利高度稳定。',
      '内部燃气采购成本下降改善公用事业分部毛利率。',
      '宣布派发第三次中期股息每股 18 仙，高股息防御属性突出。',
    ],
    origin: 'baseline',
  },
]

function baselineBursaAnnouncements(): BursaAnnouncement[] {
  return BURSA_BASELINE.map(({ daysAgo, ...rest }) => ({
    ...rest,
    publishedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  }))
}

async function fetchLiveBursaRaw(): Promise<
  Array<{ id: string; symbol: string; company: string; title: string; publishedAt: string; url: string; pdfUrl: string }>
> {
  // 1) 尝试 Bursa Malaysia 官方公告接口（筛选 Financial Results / Quarterly Report）
  try {
    const data = await fetchJson('https://www.bursamalaysia.com/api/v1/announcements?per_page=40', 6000)
    const list = Array.isArray(data)
      ? data
      : Object.values((data && typeof data === 'object' ? (data as Record<string, unknown>).data : {}) as Record<string, unknown>).find(
          Array.isArray,
        ) ?? []
    if (Array.isArray(list) && list.length > 0) {
      const results = list
        .filter((entry) => {
          const row = entry as Record<string, unknown>
          const text = `${row.title ?? ''} ${row.subject ?? ''} ${row.category ?? ''}`.toLowerCase()
          return /(financial result|quarterly|interim|unaudited|audited)/i.test(text)
        })
        .slice(0, 15)
        .map((entry, idx) => {
          const row = entry as Record<string, unknown>
          const code = String(row.stock_code ?? row.code ?? '').trim()
          const symbol = code ? (code.endsWith('.KL') ? code : `${code}.KL`) : 'BURSA.KL'
          const url = String(row.url ?? row.link ?? 'https://www.bursamalaysia.com')
          return {
            id: `bursa-live-${code || idx}-${Date.now()}`,
            symbol,
            company: String(row.company_name ?? row.company ?? symbol),
            title: String(row.title ?? row.subject ?? 'Quarterly Financial Results'),
            publishedAt: String(row.date ?? row.created_at ?? new Date().toISOString()),
            url,
            pdfUrl: String(row.pdf_url ?? url),
          }
        })
      if (results.length > 0) return results
    }
  } catch {
    // 尝试下一源
  }

  // 2) 备选：GDELT 搜索马来西亚上市公司最新季度财报公告
  try {
    const gdeltUrl =
      'https://api.gdeltproject.org/api/v2/doc/doc?query=(%22Bursa%20Malaysia%22%20OR%20Maybank%20OR%20Tenaga%20OR%20CIMB%20OR%20%22Public%20Bank%22)%20(%22net%20profit%22%20OR%20%22quarterly%20results%22%20OR%20%223Q%22%20OR%20%222Q%22)%20sourcelang:english&mode=artlist&format=json&maxrecords=15&sort=datedesc'
    const gdelt = (await fetchJson(gdeltUrl, 6000)) as { articles?: Array<Record<string, unknown>> }
    const rows = Array.isArray(gdelt?.articles) ? gdelt.articles : []
    if (rows.length > 0) {
      return rows.slice(0, 10).map((row, idx) => {
        const title = String(row.title ?? '')
        const matchCode =
          /maybank/i.test(title)
            ? '1155.KL'
            : /public bank/i.test(title)
              ? '1295.KL'
              : /cimb/i.test(title)
                ? '1023.KL'
                : /tenaga/i.test(title)
                  ? '5347.KL'
                  : /ihh/i.test(title)
                    ? '5225.KL'
                    : /petronas/i.test(title)
                      ? '6033.KL'
                      : `KLSE-${idx + 1}.KL`
        const url = String(row.url ?? '#')
        return {
          id: `bursa-gdelt-${idx}-${Math.abs(title.length * 31)}`,
          symbol: matchCode,
          company: title.split(/[:\-–|]/)[0]?.trim() || matchCode,
          title,
          publishedAt: new Date().toISOString(),
          url,
          pdfUrl: url,
        }
      })
    }
  } catch {
    // 回退基准
  }

  return []
}

const BURSA_PARSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          quarterLabel: { type: 'STRING' },
          revenueMyr: { type: 'STRING' },
          revenueYoY: { type: 'STRING' },
          netProfitMyr: { type: 'STRING' },
          netProfitYoY: { type: 'STRING' },
          epsSen: { type: 'STRING' },
          dividendSen: { type: 'STRING' },
          summaryPoints: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['id', 'quarterLabel', 'revenueMyr', 'netProfitMyr', 'summaryPoints'],
      },
    },
  },
  required: ['items'],
} as const

// ---------------------------------------------------------------------------
// 对外接口：获取美股 + 马股财报日程
// ---------------------------------------------------------------------------

export async function fetchEarningsCalendar(options: {
  finnhubKey?: string
  fmpKey?: string
  geminiKey?: string
  aiRouting?: string
  geminiModel?: string
}): Promise<EarningsPayload> {
  const from = isoDateOffset(0)
  const to = isoDateOffset(7)

  // 1) 美股 7 天财报：Finnhub → FMP → Baseline
  let us: UsEarningsEvent[] = []
  let usOrigin: 'live' | 'baseline' = 'baseline'
  let usProvider = 'baseline'

  if (options.finnhubKey) {
    try {
      const rows = await fetchFinnhubEarnings(from, to, options.finnhubKey)
      if (rows.length > 0) {
        us = rows
        usOrigin = 'live'
        usProvider = 'Finnhub'
      }
    } catch {
      // 故障转移至 FMP
    }
  }

  if (us.length === 0 && options.fmpKey) {
    try {
      const rows = await fetchFmpEarnings(from, to, options.fmpKey)
      if (rows.length > 0) {
        us = rows
        usOrigin = 'live'
        usProvider = 'FMP'
      }
    } catch {
      // 降级基准
    }
  }

  if (us.length === 0) {
    us = baselineUsEarnings()
    usOrigin = 'baseline'
    usProvider = '终端 7 日基准日程'
  }

  // 2) 马股 (.KL) 最新季度财报公告：Bursa API / GDELT → Gemini 解析 → Baseline
  let bursa: BursaAnnouncement[] = []
  let bursaOrigin: 'live' | 'baseline' = 'baseline'
  let bursaProvider = 'Bursa 基准季度公告'
  let usedModel: string | undefined

  const rawBursa = await fetchLiveBursaRaw()
  if (rawBursa.length > 0) {
    bursaOrigin = 'live'
    bursaProvider = 'Bursa / MY Corporate Feed'
    bursa = rawBursa.map((item) => ({
      id: item.id,
      symbol: item.symbol,
      company: item.company,
      title: item.title,
      quarterLabel: '最新季报',
      publishedAt: item.publishedAt,
      periodEnd: isoDateOffset(-30),
      revenueMyr: '点击 AI 解析正文',
      revenueYoY: '—',
      netProfitMyr: '点击 AI 解析正文',
      netProfitYoY: '—',
      epsSen: '—',
      pdfUrl: item.pdfUrl,
      sourceUrl: item.url,
      summaryPoints: [item.title],
      origin: 'live',
    }))

    if (options.geminiKey) {
      try {
        const targetModel = resolveServerModel('flash', options.aiRouting, options.geminiModel)
        const res = await generateServer({
          apiKey: options.geminiKey,
          model: targetModel,
          system:
            '你是马来西亚 Bursa Malaysia 财报解析专家。根据以下公告标题提取或合理归纳结构化字段（找不到数字则填 "见原公告"），全部用简体中文，只输出 JSON。',
          prompt: JSON.stringify(rawBursa.map((r) => ({ id: r.id, symbol: r.symbol, company: r.company, title: r.title }))),
          temperature: 0.2,
          maxOutputTokens: 2048,
          responseSchema: BURSA_PARSE_SCHEMA,
        })
        usedModel = res.model
        const parsed = parseJsonLoose<{
          items?: Array<{
            id: string
            quarterLabel?: string
            revenueMyr?: string
            revenueYoY?: string
            netProfitMyr?: string
            netProfitYoY?: string
            epsSen?: string
            dividendSen?: string
            summaryPoints?: string[]
          }>
        }>(res.text)
        const byId = new Map((parsed?.items ?? []).map((row) => [row.id, row]))
        bursa = bursa.map((item) => {
          const hit = byId.get(item.id)
          if (!hit) return item
          return {
            ...item,
            quarterLabel: hit.quarterLabel || item.quarterLabel,
            revenueMyr: hit.revenueMyr || item.revenueMyr,
            revenueYoY: hit.revenueYoY || item.revenueYoY,
            netProfitMyr: hit.netProfitMyr || item.netProfitMyr,
            netProfitYoY: hit.netProfitYoY || item.netProfitYoY,
            epsSen: hit.epsSen || item.epsSen,
            dividendSen: hit.dividendSen || undefined,
            summaryPoints: hit.summaryPoints?.length ? hit.summaryPoints.slice(0, 3) : item.summaryPoints,
          }
        })
      } catch {
        // 保留原始公告标题
      }
    }
  } else {
    bursa = baselineBursaAnnouncements()
  }

  return {
    us,
    bursa,
    usOrigin,
    bursaOrigin,
    usProvider,
    bursaProvider,
    updatedAt: new Date().toISOString(),
    model: usedModel,
  }
}

// ---------------------------------------------------------------------------
// 单份马股财报公告 / PDF 深度摘要（多模型降级）
// ---------------------------------------------------------------------------

const BURSA_DETAIL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    revenueMyr: { type: 'STRING' },
    revenueYoY: { type: 'STRING' },
    netProfitMyr: { type: 'STRING' },
    netProfitYoY: { type: 'STRING' },
    epsSen: { type: 'STRING' },
    dividendSen: { type: 'STRING' },
    summaryPoints: { type: 'ARRAY', items: { type: 'STRING' } },
    highlights: { type: 'STRING' },
    outlook: { type: 'STRING' },
    risks: { type: 'STRING' },
  },
  required: ['revenueMyr', 'netProfitMyr', 'summaryPoints', 'highlights', 'outlook', 'risks'],
} as const

export async function buildBursaEarningsDetail(
  item: BursaAnnouncement,
  options: { geminiKey?: string; aiRouting?: string; geminiModel?: string },
): Promise<BursaEarningsDetail> {
  const now = new Date().toISOString()

  let extractedText = ''
  if (item.sourceUrl && item.sourceUrl.startsWith('http') && !item.sourceUrl.includes('bursamalaysia.com/market_information')) {
    const extracted = await extractArticle(item.sourceUrl).catch(() => ({ text: '', mode: 'unavailable' as const }))
    extractedText = extracted.text
  }

  const fallback: BursaEarningsDetail = {
    id: item.id,
    symbol: item.symbol,
    company: item.company,
    quarterLabel: item.quarterLabel,
    publishedAt: item.publishedAt,
    revenueMyr: item.revenueMyr,
    revenueYoY: item.revenueYoY,
    netProfitMyr: item.netProfitMyr,
    netProfitYoY: item.netProfitYoY,
    epsSen: item.epsSen,
    dividendSen: item.dividendSen,
    summaryPoints: item.summaryPoints.length > 0 ? item.summaryPoints : [item.title],
    highlights: `${item.company} 于 ${item.quarterLabel} 录得营收 ${item.revenueMyr}（${item.revenueYoY}）、净利润 ${item.netProfitMyr}（${item.netProfitYoY}），每股盈利 ${item.epsSen}。`,
    outlook: '关注下季度指引、BNM 利率环境及令吉汇率对营业利润率的边际影响。',
    risks: '需留意原材料成本波动、行业竞争加剧与外资资金流向变化。',
    pdfUrl: item.pdfUrl,
    model: 'local',
    degraded: true,
    generatedAt: now,
  }

  if (!options.geminiKey) return fallback

  const targetModel = resolveServerModel('pro', options.aiRouting, options.geminiModel)
  try {
    const res = await generateServer({
      apiKey: options.geminiKey,
      model: targetModel || SERVER_FLASH_MODEL,
      system: `${SERVER_RESEARCH_DOCTRINE}

你是资深马来西亚 Bursa 股票研究分析师。请针对以下大马上市公司季度财报公告与正文摘要，提取并生成结构化华文财报解读（包括营收、净利润、EPS、股息、3–5 条核心 PDF 摘要要点、经营亮点、前景展望与主要风险）。严格返回 JSON。`,
      prompt: [
        `股票代码：${item.symbol}`,
        `公司名称：${item.company}`,
        `财报季度：${item.quarterLabel}`,
        `公告标题：${item.title}`,
        `已知摘要指标：营收 ${item.revenueMyr} (${item.revenueYoY}) | 净利润 ${item.netProfitMyr} (${item.netProfitYoY}) | EPS ${item.epsSen} | 股息 ${item.dividendSen ?? '未披露'}`,
        `已有要点：${item.summaryPoints.join('；')}`,
        extractedText ? `\n抓取正文：\n${extractedText.slice(0, 10_000)}` : '',
      ].join('\n'),
      temperature: 0.3,
      maxOutputTokens: 2560,
      responseSchema: BURSA_DETAIL_SCHEMA,
    })

    const parsed =
      parseJsonLoose<Partial<BursaEarningsDetail>>(res.text) ?? {}

    return {
      ...fallback,
      revenueMyr: parsed.revenueMyr || fallback.revenueMyr,
      revenueYoY: parsed.revenueYoY || fallback.revenueYoY,
      netProfitMyr: parsed.netProfitMyr || fallback.netProfitMyr,
      netProfitYoY: parsed.netProfitYoY || fallback.netProfitYoY,
      epsSen: parsed.epsSen || fallback.epsSen,
      dividendSen: parsed.dividendSen || fallback.dividendSen,
      summaryPoints: Array.isArray(parsed.summaryPoints) && parsed.summaryPoints.length > 0
        ? parsed.summaryPoints.slice(0, 5)
        : fallback.summaryPoints,
      highlights: parsed.highlights || fallback.highlights,
      outlook: parsed.outlook || fallback.outlook,
      risks: parsed.risks || fallback.risks,
      model: res.model,
      degraded: false,
      generatedAt: now,
    }
  } catch {
    return fallback
  }
}

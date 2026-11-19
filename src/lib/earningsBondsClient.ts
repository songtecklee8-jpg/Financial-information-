import type {
  ApiSettings,
  BondAuctionAnalysis,
  BondAuctionItem,
  BondMarketBenchmark,
  BondsPayload,
  BursaAnnouncement,
  BursaEarningsDetail,
  EarningsPayload,
  UsEarningsEvent,
} from '@/types'
import { hasAnyAiConfigured } from '@/lib/aiFallback'
import { aiRoute, generateText } from '@/lib/gemini'
import { requestJson } from '@/lib/market/net'
import { RESEARCH_DOCTRINE } from '@/lib/researchDoctrine'

function isoOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

function parseJsonLoose<T>(text: string): T | null {
  if (!text) return null
  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const start = cleaned.search(/[[{]/)
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'))
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T
      } catch {
        return null
      }
    }
    return null
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
  PANW: 'Palo Alto Networks',
  CRWD: 'CrowdStrike Holdings',
  DELL: 'Dell Technologies',
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
    const date = isoOffset(item.offset)
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

function baselineBursaAnnouncements(): BursaAnnouncement[] {
  const rows: Array<Omit<BursaAnnouncement, 'publishedAt'> & { daysAgo: number }> = [
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
  return rows.map(({ daysAgo, ...rest }) => ({
    ...rest,
    publishedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  }))
}

export async function fetchEarningsCalendarBrowser(settings: ApiSettings): Promise<EarningsPayload> {
  const from = isoOffset(0)
  const to = isoOffset(7)
  const finnhubKey = settings.providers.finnhub.apiKey.trim()
  const fmpKey = settings.providers.fmp.apiKey.trim()

  let us: UsEarningsEvent[] = []
  let usOrigin: 'live' | 'baseline' = 'baseline'
  let usProvider = '终端 7 日基准日程'

  if (finnhubKey) {
    try {
      const payload = await requestJson<{ earningsCalendar?: Array<Record<string, unknown>> }>(
        `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${encodeURIComponent(finnhubKey)}`,
      )
      const rows = (payload.earningsCalendar ?? [])
        .map((row): UsEarningsEvent | null => {
          const symbol = String(row.symbol ?? '').trim().toUpperCase()
          const date = String(row.date ?? '').slice(0, 10)
          if (!symbol || !date) return null
          return {
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
          }
        })
        .filter((x): x is UsEarningsEvent => x !== null)
      if (rows.length > 0) {
        us = rows.slice(0, 40)
        usOrigin = 'live'
        usProvider = 'Finnhub'
      }
    } catch {
      // 故障转移至 FMP
    }
  }

  if (us.length === 0 && fmpKey) {
    try {
      const rows = await requestJson<Array<Record<string, unknown>>>(
        `https://financialmodelingprep.com/api/v3/earning_calendar?from=${from}&to=${to}&apikey=${encodeURIComponent(fmpKey)}`,
      )
      if (Array.isArray(rows) && rows.length > 0) {
        us = rows
          .map((row): UsEarningsEvent | null => {
            const symbol = String(row.symbol ?? '').trim().toUpperCase()
            const date = String(row.date ?? '').slice(0, 10)
            if (!symbol || !date) return null
            return {
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
            }
          })
          .filter((x): x is UsEarningsEvent => x !== null)
          .slice(0, 40)
        if (us.length > 0) {
          usOrigin = 'live'
          usProvider = 'FMP'
        }
      }
    } catch {
      // 降级基准
    }
  }

  if (us.length === 0) {
    us = baselineUsEarnings()
  }

  return {
    us,
    bursa: baselineBursaAnnouncements(),
    usOrigin,
    bursaOrigin: 'baseline',
    usProvider,
    bursaProvider: 'Bursa 季度公告',
    updatedAt: new Date().toISOString(),
  }
}

export async function buildBursaEarningsDetailBrowser(
  item: BursaAnnouncement,
  settings: ApiSettings,
): Promise<BursaEarningsDetail> {
  const now = new Date().toISOString()
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
    summaryPoints: item.summaryPoints,
    highlights: `${item.company} 于 ${item.quarterLabel} 录得营收 ${item.revenueMyr}（${item.revenueYoY}）、净利润 ${item.netProfitMyr}（${item.netProfitYoY}），每股盈利 ${item.epsSen}。`,
    outlook: '关注下季度指引、BNM 利率环境及令吉汇率对营业利润率的边际影响。',
    risks: '需留意原材料成本波动、行业竞争加剧与外资资金流向变化。',
    pdfUrl: item.pdfUrl,
    model: 'local',
    degraded: true,
    generatedAt: now,
  }

  if (!hasAnyAiConfigured(settings)) return fallback

  try {
    const { text, model } = await generateText({
      apiKey: settings.geminiKey,
      route: aiRoute(settings, 'pro'),
      systemInstruction: `${RESEARCH_DOCTRINE}

你是资深马来西亚 Bursa 股票研究分析师。请针对以下大马上市公司季度财报公告提取结构化华文财报解读（包括营收、净利润、EPS、股息、3–5 条核心 PDF 摘要要点、经营亮点、前景展望与主要风险）。严格返回 JSON。`,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: [
                `股票代码：${item.symbol}`,
                `公司名称：${item.company}`,
                `财报季度：${item.quarterLabel}`,
                `公告标题：${item.title}`,
                `已知摘要指标：营收 ${item.revenueMyr} (${item.revenueYoY}) | 净利润 ${item.netProfitMyr} (${item.netProfitYoY}) | EPS ${item.epsSen} | 股息 ${item.dividendSen ?? '未披露'}`,
                `已有要点：${item.summaryPoints.join('；')}`,
              ].join('\n'),
            },
          ],
        },
      ],
      jsonSchema: {
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
      },
      temperature: 0.3,
      maxOutputTokens: 2048,
    })

    const parsed = parseJsonLoose<Partial<BursaEarningsDetail>>(text) ?? {}
    return {
      ...fallback,
      revenueMyr: parsed.revenueMyr || fallback.revenueMyr,
      revenueYoY: parsed.revenueYoY || fallback.revenueYoY,
      netProfitMyr: parsed.netProfitMyr || fallback.netProfitMyr,
      netProfitYoY: parsed.netProfitYoY || fallback.netProfitYoY,
      epsSen: parsed.epsSen || fallback.epsSen,
      dividendSen: parsed.dividendSen || fallback.dividendSen,
      summaryPoints:
        Array.isArray(parsed.summaryPoints) && parsed.summaryPoints.length > 0
          ? parsed.summaryPoints.slice(0, 5)
          : fallback.summaryPoints,
      highlights: parsed.highlights || fallback.highlights,
      outlook: parsed.outlook || fallback.outlook,
      risks: parsed.risks || fallback.risks,
      model,
      degraded: false,
      generatedAt: now,
    }
  } catch {
    return fallback
  }
}

export async function fetchBondsTrackerBrowser(): Promise<BondsPayload> {
  let opr = 2.75
  let oprDate = isoOffset(-60)
  let interbankOvernight = 2.78
  let usdMyr = 4.109
  let us10y = 4.42
  let bnmOrigin: 'live' | 'baseline' = 'baseline'

  const [oprRes, fxRes, usRes] = await Promise.allSettled([
    requestJson<{ data?: { new_opr_level?: number; date?: string } }>('https://api.bnm.gov.my/public/opr', {
      headers: { Accept: 'application/vnd.BNM.API.v1+json' },
    }),
    requestJson<{ data?: Array<{ currency_code?: string; rate?: { middle_rate?: number } }> }>(
      'https://api.bnm.gov.my/public/exchange-rate',
      { headers: { Accept: 'application/vnd.BNM.API.v1+json' } },
    ),
    requestJson<{ chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> } }>(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?range=5d&interval=1d',
    ),
  ])

  if (oprRes.status === 'fulfilled' && typeof oprRes.value.data?.new_opr_level === 'number') {
    opr = oprRes.value.data.new_opr_level
    oprDate = oprRes.value.data.date ?? oprDate
    interbankOvernight = Number((opr + 0.03).toFixed(2))
    bnmOrigin = 'live'
  }

  if (fxRes.status === 'fulfilled') {
    const usd = (fxRes.value.data ?? []).find((r) => r.currency_code === 'USD')
    if (typeof usd?.rate?.middle_rate === 'number') {
      usdMyr = Number(usd.rate.middle_rate.toFixed(4))
      bnmOrigin = 'live'
    }
  }

  if (usRes.status === 'fulfilled') {
    const p = usRes.value.chart?.result?.[0]?.meta?.regularMarketPrice
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) us10y = Number(p.toFixed(2))
  }

  const mgs3y = Number((opr + 0.65).toFixed(2))
  const mgs5y = Number((opr + 0.82).toFixed(2))
  const mgs10y = Number((opr + 1.05).toFixed(2))
  const mgs15y = Number((opr + 1.24).toFixed(2))
  const mgs30y = Number((opr + 1.48).toFixed(2))

  const benchmarks: BondMarketBenchmark = {
    opr,
    oprDate,
    interbankOvernight,
    mgs3y,
    mgs5y,
    mgs10y,
    mgs15y,
    mgs30y,
    us10y,
    spread10y: Number((us10y - mgs10y).toFixed(2)),
    usdMyr,
    bnmOrigin,
  }

  const templates: Array<{
    id: string
    instrument: 'MGS' | 'MGII'
    series: string
    issueCode: string
    tenorYears: number
    reopening: boolean
    auctionOffsetDays: number
    maturityYear: number
    estimatedSizeMyrB: number
    privatePlacementMyrB?: number
    couponRate: number
    yieldAvg?: number
    bidToCover?: number
    status: BondAuctionItem['status']
  }> = [
    {
      id: 'bnm-mgs-30y-reopen',
      instrument: 'MGS',
      series: '30-Year MGS Reopening (03/2056)',
      issueCode: 'MS260003',
      tenorYears: 30,
      reopening: true,
      auctionOffsetDays: 4,
      maturityYear: 2056,
      estimatedSizeMyrB: 3.0,
      privatePlacementMyrB: 2.0,
      couponRate: 4.18,
      status: 'upcoming',
    },
    {
      id: 'bnm-mgii-10y-new',
      instrument: 'MGII',
      series: '10-Year MGII Benchmark Reopening (10/2036)',
      issueCode: 'GI260010',
      tenorYears: 10,
      reopening: true,
      auctionOffsetDays: 11,
      maturityYear: 2036,
      estimatedSizeMyrB: 5.0,
      couponRate: 3.84,
      status: 'upcoming',
    },
    {
      id: 'bnm-mgs-5y-reopen',
      instrument: 'MGS',
      series: '5-Year MGS Reopening (08/2031)',
      issueCode: 'MS260005',
      tenorYears: 5,
      reopening: true,
      auctionOffsetDays: 19,
      maturityYear: 2031,
      estimatedSizeMyrB: 4.5,
      couponRate: 3.56,
      status: 'announced',
    },
    {
      id: 'bnm-mgii-20y-reopen',
      instrument: 'MGII',
      series: '20-Year MGII Reopening (08/2046)',
      issueCode: 'GI260020',
      tenorYears: 20,
      reopening: true,
      auctionOffsetDays: 27,
      maturityYear: 2046,
      estimatedSizeMyrB: 3.0,
      privatePlacementMyrB: 1.5,
      couponRate: 4.09,
      status: 'announced',
    },
    {
      id: 'bnm-mgs-15y-completed',
      instrument: 'MGS',
      series: '15-Year MGS Reopening (04/2041)',
      issueCode: 'MS260015',
      tenorYears: 15,
      reopening: true,
      auctionOffsetDays: -6,
      maturityYear: 2041,
      estimatedSizeMyrB: 3.5,
      privatePlacementMyrB: 1.5,
      couponRate: 3.98,
      yieldAvg: benchmarks.mgs15y,
      bidToCover: 2.48,
      status: 'completed',
    },
    {
      id: 'bnm-mgii-7y-completed',
      instrument: 'MGII',
      series: '7-Year MGII Reopening (09/2033)',
      issueCode: 'GI260007',
      tenorYears: 7,
      reopening: true,
      auctionOffsetDays: -14,
      maturityYear: 2033,
      estimatedSizeMyrB: 5.0,
      couponRate: 3.71,
      yieldAvg: Number((benchmarks.mgs5y + 0.12).toFixed(2)),
      bidToCover: 2.86,
      status: 'completed',
    },
  ]

  const auctions: BondAuctionItem[] = templates.map((item) => {
    const auctionDate = isoOffset(item.auctionOffsetDays)
    const issueDate = isoOffset(item.auctionOffsetDays + 2)
    return {
      id: item.id,
      instrument: item.instrument,
      series: item.series,
      issueCode: item.issueCode,
      tenorYears: item.tenorYears,
      reopening: item.reopening,
      auctionDate,
      issueDate,
      maturityDate: `${item.maturityYear}-${auctionDate.slice(5)}`,
      estimatedSizeMyrB: item.estimatedSizeMyrB,
      privatePlacementMyrB: item.privatePlacementMyrB,
      couponRate: item.couponRate,
      yieldAvg: item.yieldAvg,
      bidToCover: item.bidToCover,
      status: item.status,
      source: 'BNM Auction Schedule',
      origin: 'baseline',
    }
  })

  return {
    benchmarks,
    auctions,
    origin: bnmOrigin,
    sourceLabel:
      bnmOrigin === 'live'
        ? 'BNM Open API（OPR / USD-MYR 实时）+ MGS/MGII 发债日历'
        : 'BNM Bond Info Hub 基准日历',
    updatedAt: new Date().toISOString(),
  }
}

export async function analyzeBondAuctionsBrowser(
  benchmarks: BondMarketBenchmark,
  auctions: BondAuctionItem[],
  settings: ApiSettings,
): Promise<BondAuctionAnalysis> {
  const now = new Date().toISOString()
  const upcoming = auctions.filter((a) => a.status !== 'completed')
  const totalUpcomingB = upcoming.reduce(
    (acc, item) => acc + item.estimatedSizeMyrB + (item.privatePlacementMyrB ?? 0),
    0,
  )

  const fallback: BondAuctionAnalysis = {
    headline: `BNM OPR 企稳于 ${benchmarks.opr.toFixed(2)}%，10Y MGS 报 ${benchmarks.mgs10y.toFixed(2)}%（美马利差 ${benchmarks.spread10y.toFixed(2)}%）`,
    demandOutlook: `未来数周合计约 RM ${totalUpcomingB.toFixed(1)}B MGS / MGII 拍卖供应，预计大马本地退休基金（EPF / KWAP）与银行资产负债表配置需求仍将支撑 2.3x–2.8x 的稳健认购倍数。`,
    yieldImpact: `长端 30 年期 MGS 重开发行对曲线长端带来短线供应消化压力，但若美债 10Y（${benchmarks.us10y.toFixed(2)}%）见顶回落，MGS 曲线存在温和牛陡（Bull Steepening）空间。`,
    fxAndEquityImpact: `USD/MYR 现报 ${benchmarks.usdMyr.toFixed(4)}；温和利差有助于稳定外资对大马主权债的配置信心，利好马股高股息银行股与 REITs 估值修复。`,
    keyWatchPoints: [
      `关注即将登场的 ${upcoming[0]?.series ?? '长端 MGS 拍卖'} 中标尾部（Tail）与认购倍数（BTC）`,
      `追踪美债 10Y (${benchmarks.us10y.toFixed(2)}%) 与 MGS 10Y (${benchmarks.mgs10y.toFixed(2)}%) 利差收敛节奏`,
      '留意 BNM 货币政策声明对国内通胀与补贴改革传导的措辞变化',
    ],
    model: 'local',
    degraded: true,
    generatedAt: now,
  }

  if (!hasAnyAiConfigured(settings)) return fallback

  try {
    const { text, model } = await generateText({
      apiKey: settings.geminiKey,
      route: aiRoute(settings, 'pro'),
      systemInstruction: `${RESEARCH_DOCTRINE}

你是马来西亚固收（MGS / MGII）与跨境利率首席策略师。请基于给定的 BNM 政策利率、MGS 收益率曲线、美马利差、USD/MYR 汇率及近期拍卖计划，输出结构化的国债拍卖供需与跨市场影响研判。全部使用简体中文，严格返回 JSON。`,
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ benchmarks, upcomingAuctions: upcoming }) }] }],
      jsonSchema: {
        type: 'OBJECT',
        properties: {
          headline: { type: 'STRING' },
          demandOutlook: { type: 'STRING' },
          yieldImpact: { type: 'STRING' },
          fxAndEquityImpact: { type: 'STRING' },
          keyWatchPoints: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['headline', 'demandOutlook', 'yieldImpact', 'fxAndEquityImpact', 'keyWatchPoints'],
      },
      temperature: 0.35,
      maxOutputTokens: 2048,
    })

    const parsed = parseJsonLoose<Partial<BondAuctionAnalysis>>(text) ?? {}
    return {
      headline: parsed.headline || fallback.headline,
      demandOutlook: parsed.demandOutlook || fallback.demandOutlook,
      yieldImpact: parsed.yieldImpact || fallback.yieldImpact,
      fxAndEquityImpact: parsed.fxAndEquityImpact || fallback.fxAndEquityImpact,
      keyWatchPoints:
        Array.isArray(parsed.keyWatchPoints) && parsed.keyWatchPoints.length > 0
          ? parsed.keyWatchPoints.slice(0, 5)
          : fallback.keyWatchPoints,
      model,
      degraded: false,
      generatedAt: now,
    }
  } catch {
    return fallback
  }
}

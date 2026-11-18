import type { NewsItem, NewsSource } from '@/types'

/**
 * 多源财经新闻。
 * 优先尝试通过公共 CORS 网关拉取真实 RSS；任一源失败都会被静默忽略并回落到
 * 内置的高仿真基准新闻流，确保侧边栏永不空白。
 */

interface NewsSeed {
  source: NewsSource
  title: string
  summary: string
  minutesAgo: number
  tickers: string[]
  sentiment: NewsItem['sentiment']
}

const SEEDS: NewsSeed[] = [
  {
    source: 'WSJ',
    title: 'Fed Officials Signal Caution on Rate Cuts as Inflation Cools Only Gradually',
    summary:
      'Minutes showed several policymakers favouring an extended hold, pushing front-end Treasury yields higher while equities traded sideways.',
    minutesAgo: 14,
    tickers: ['US10Y', 'AAPL', 'JPM'],
    sentiment: 'neutral',
  },
  {
    source: 'WSJ',
    title: "Nvidia's Data-Center Demand Shows No Sign of Cooling Into Next Quarter",
    summary:
      'Hyperscaler capex guidance continues to outrun supply, keeping accelerator order books full through the coming fiscal year.',
    minutesAgo: 42,
    tickers: ['NVDA', 'AMD'],
    sentiment: 'bullish',
  },
  {
    source: 'WSJ',
    title: 'Apple Services Margin Hits Record Even as Hardware Growth Stalls',
    summary:
      'High-margin services revenue now covers a rising share of group gross profit, but device replacement cycles remain stretched.',
    minutesAgo: 96,
    tickers: ['AAPL'],
    sentiment: 'neutral',
  },
  {
    source: 'WSJ',
    title: 'Oil Slips Below $70 as OPEC+ Weighs Faster Output Normalisation',
    summary:
      'Brent futures retreated on expectations of additional barrels returning to the market, pressuring integrated energy earnings estimates.',
    minutesAgo: 158,
    tickers: ['XOM', '3816.KL'],
    sentiment: 'bearish',
  },
  {
    source: 'WSJ',
    title: 'Regional Banks Brace for Lower Net Interest Income in the Year Ahead',
    summary:
      'Deposit repricing and a flatter curve are expected to compress margins, though credit costs remain contained for now.',
    minutesAgo: 221,
    tickers: ['JPM', '1155.KL', '1295.KL'],
    sentiment: 'bearish',
  },
  {
    source: '华尔街见闻',
    title: '美联储会议纪要：多数官员认为通胀回落进程仍需更多数据验证',
    summary:
      '纪要显示决策层对过早宽松保持警惕，市场对年内降息幅度的定价小幅下修，10 年期美债收益率随之走高。',
    minutesAgo: 21,
    tickers: ['US10Y', 'US2Y'],
    sentiment: 'bearish',
  },
  {
    source: '华尔街见闻',
    title: '马来西亚央行维持隔夜政策利率于 3.00% 不变，措辞偏向中性',
    summary:
      'BNM 表示当前利率水平仍足以支持增长并锚定通胀预期，市场普遍预期年内政策利率将保持稳定。',
    minutesAgo: 58,
    tickers: ['1155.KL', '1295.KL', '1023.KL'],
    sentiment: 'bullish',
  },
  {
    source: '华尔街见闻',
    title: '英伟达业绩前瞻：AI 资本开支仍是决定估值中枢的核心变量',
    summary:
      '卖方普遍上调数据中心收入预期，但同时也提示供应链交期与客户集中度带来的波动风险。',
    minutesAgo: 87,
    tickers: ['NVDA'],
    sentiment: 'bullish',
  },
  {
    source: '华尔街见闻',
    title: '令吉走强，外资连续第三周净买入马股',
    summary:
      '汇率企稳叠加估值折价吸引外资回流，金融与公用事业板块为主要受益方向。',
    minutesAgo: 133,
    tickers: ['1155.KL', '5347.KL', '1066.KL'],
    sentiment: 'bullish',
  },
  {
    source: '华尔街见闻',
    title: '10 年期美债收益率升破 4.4%，全球风险资产承压',
    summary:
      '实际利率上行削弱高估值成长股的贴现支撑，资金阶段性转向高股息防御板块。',
    minutesAgo: 205,
    tickers: ['US10Y', 'TSLA', 'KO'],
    sentiment: 'bearish',
  },
  {
    source: 'The Star Business',
    title: 'Maybank posts higher net profit on stronger non-interest income',
    summary:
      'Malaysia’s largest bank by assets reported resilient treasury and fee income, with return on equity holding above 11%.',
    minutesAgo: 33,
    tickers: ['1155.KL'],
    sentiment: 'bullish',
  },
  {
    source: 'The Star Business',
    title: 'Public Bank keeps dividend payout steady amid mid-single-digit loan growth',
    summary:
      'Management guided for stable asset quality and reaffirmed its commitment to a progressive dividend policy.',
    minutesAgo: 74,
    tickers: ['1295.KL'],
    sentiment: 'neutral',
  },
  {
    source: 'The Star Business',
    title: 'Bursa Malaysia records RM2.1bil foreign net inflow in October',
    summary:
      'Foreign funds returned to the local bourse on cheap valuations and a firmer ringgit, exchange data showed.',
    minutesAgo: 119,
    tickers: ['1155.KL', '1023.KL'],
    sentiment: 'bullish',
  },
  {
    source: 'The Star Business',
    title: 'Tenaga Nasional accelerates grid capex to meet data-centre demand',
    summary:
      'The utility is front-loading transmission investment as new hyperscale campuses connect to the national grid.',
    minutesAgo: 176,
    tickers: ['5347.KL'],
    sentiment: 'bullish',
  },
  {
    source: 'The Star Business',
    title: 'RHB Bank targets 8% loan growth and higher ROE by next year',
    summary:
      'The lender plans to lean on SME and mortgage segments while keeping credit cost guidance unchanged.',
    minutesAgo: 244,
    tickers: ['1066.KL'],
    sentiment: 'bullish',
  },
  {
    source: 'The Star Business',
    title: 'Ringgit strengthens past 4.20 against the US dollar',
    summary:
      'A narrower rate differential and improved portfolio flows supported the currency, easing imported input costs.',
    minutesAgo: 302,
    tickers: ['US10Y', 'MGS10Y'],
    sentiment: 'bullish',
  },
]

export function baselineNews(now = Date.now()): NewsItem[] {
  return SEEDS.map((seed, index) => ({
    id: `baseline-${index}`,
    title: seed.title,
    source: seed.source,
    summary: seed.summary,
    publishedAt: new Date(now - seed.minutesAgo * 60_000).toISOString(),
    url: '#',
    tickers: seed.tickers,
    sentiment: seed.sentiment,
    origin: 'baseline' as const,
  }))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
}

const FEEDS: Array<{ source: NewsSource; url: string }> = [
  { source: 'WSJ', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml' },
  { source: 'The Star Business', url: 'https://www.thestar.com.my/rss/Business/' },
  { source: '华尔街见闻', url: 'https://dedicated.wallstreetcn.com/rss.xml' },
]

const GATEWAY = 'https://api.allorigins.win/raw?url='

function inferSentiment(title: string): NewsItem['sentiment'] {
  const text = title.toLowerCase()
  if (/(surge|jump|rally|beat|record|gain|upgrade|soar|strengthen|higher)/.test(text)) return 'bullish'
  if (/(fall|drop|slump|miss|cut|downgrade|weak|plunge|pressure|lower|loss)/.test(text)) return 'bearish'
  return 'neutral'
}

async function fetchFeed(
  source: NewsSource,
  url: string,
  signal: AbortSignal,
): Promise<NewsItem[]> {
  const response = await fetch(`${GATEWAY}${encodeURIComponent(url)}`, { signal })
  if (!response.ok) throw new Error(`feed ${source} responded ${response.status}`)
  const xml = await response.text()
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const nodes = Array.from(doc.querySelectorAll('item, entry')).slice(0, 8)
  return nodes.map((node, index) => {
    const title = node.querySelector('title')?.textContent?.trim() ?? ''
    const link = node.querySelector('link')?.textContent?.trim() ?? '#'
    const description =
      node.querySelector('description, summary')?.textContent?.replace(/<[^>]+>/g, '').trim() ?? ''
    const dateText = node.querySelector('pubDate, updated, published')?.textContent ?? ''
    const published = new Date(dateText)
    return {
      id: `${source}-${index}-${link}`,
      title,
      summary: description.slice(0, 220),
      source,
      url: link,
      publishedAt: Number.isNaN(published.getTime()) ? new Date().toISOString() : published.toISOString(),
      tickers: [],
      sentiment: inferSentiment(title),
      origin: 'live' as const,
    }
  })
}

/** 尝试拉取真实 RSS；全部失败则返回空数组由调用方回落到基准新闻 */
export async function loadLiveNews(timeoutMs = 7000): Promise<NewsItem[]> {
  if (typeof DOMParser === 'undefined') return []
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const settled = await Promise.allSettled(
      FEEDS.map((feed) => fetchFeed(feed.source, feed.url, controller.signal)),
    )
    const items = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    return items
      .filter((item) => item.title.length > 8)
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, 30)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

export const NEWS_SOURCES: NewsSource[] = ['WSJ', '华尔街见闻', 'The Star Business']

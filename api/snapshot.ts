import type { VercelRequest, VercelResponse } from '@vercel/node'

import { STORE_KEYS, readGlobalNewsFeed, readJson } from './_lib/store.js'
import type { NewsItem, NewsPayload, NewsSourceId, QuotesPayload, ServerArticle, SyncMeta } from './_lib/types.js'

function inferSourceId(source: string): NewsSourceId {
  const s = source.toLowerCase()
  if (s.includes('finnhub')) return 'finnhub'
  if (s.includes('newsdata')) return 'newsdata'
  if (s.includes('bursa')) return 'bursa'
  if (s.includes('bernama')) return 'bernama'
  if (s.includes('yahoo')) return 'yahoo'
  if (s.includes('wsj') || s.includes('wall street journal')) return 'wsj'
  if (s.includes('见闻') || s.includes('wallstreetcn')) return 'wallstreetcn'
  if (s.includes('cnbc')) return 'cnbc'
  if (s.includes('star')) return 'thestar'
  if (s.includes('nst')) return 'nst'
  if (s.includes('edge')) return 'theedgemalaysia'
  if (s.includes('alpha')) return 'alphavantage'
  return 'gdelt'
}

function feedItemsToPayload(items: NewsItem[]): NewsPayload | null {
  if (items.length === 0) return null
  const articles: ServerArticle[] = items.map((item) => {
    const sourceId = inferSourceId(item.source)
    const isMalaysia = ['bernama', 'thestar', 'nst', 'theedgemalaysia', 'bursa'].includes(sourceId)
    const hasZh = Boolean(item.translatedTitle)
    return {
      id: item.id,
      title: item.title,
      titleZh: item.translatedTitle,
      summary: item.summary ?? item.title,
      summaryZh: item.summary,
      sourceId,
      sourceName: item.source,
      url: item.url,
      publishedAt: item.publishedAt,
      region: isMalaysia ? 'malaysia' : 'global',
      lang: sourceId === 'wallstreetcn' ? 'zh' : 'en',
      tickers: [],
      sentiment: item.sentiment ?? 'neutral',
      categories: ['equities'],
      origin: 'live',
      translation: hasZh ? 'done' : 'none',
    }
  })
  return {
    articles,
    updatedAt: items[0]?.publishedAt ?? new Date().toISOString(),
    translatedCount: articles.filter((a) => a.translation === 'done').length,
  }
}

/**
 * GET /api/snapshot
 *
 * 首屏毫秒级读取端点：直接返回后台已准备好的最新行情快照与新闻列表，
 * 前端打开网页无需等待任何外部 API 转圈。
 */
export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  const [quotes, rawNews, meta, feed] = await Promise.all([
    readJson<QuotesPayload>(STORE_KEYS.quotes),
    readJson<NewsPayload>(STORE_KEYS.news),
    readJson<SyncMeta>(STORE_KEYS.syncMeta),
    readGlobalNewsFeed(),
  ])

  const news = rawNews ?? feedItemsToPayload(feed)
  const ready = Boolean(quotes || news)

  // 允许 CDN 边缘缓存 60s，并在后台并行刷新，进一步压低首屏延迟
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  res.status(200).json({
    ok: ready,
    ready,
    quotes: quotes ?? null,
    news: news ?? null,
    globalFeedCount: feed.length,
    meta: meta ?? null,
  })
}

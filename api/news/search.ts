import type { VercelRequest, VercelResponse } from '@vercel/node'

import { loadKeys } from '../_lib/env.js'
import { dedupeArticles, inferSentiment } from '../_lib/news.js'
import { serverSourceMeta } from '../_lib/newsSources.js'
import type { ServerArticle } from '../_lib/types.js'

const TIMEOUT_MS = 9000

function cleanStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function hashId(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) hash = (hash * 31 + input.charCodeAt(i)) | 0
  return Math.abs(hash).toString(36)
}

function safeDate(value: unknown): string {
  const parsed = typeof value === 'number' ? new Date(value * 1000) : new Date(String(value ?? ''))
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    return (await res.json()) as unknown
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' })
    return
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const query = cleanStr(req.query.q) || cleanStr(body.query)
  if (!query) {
    res.status(400).json({ ok: false, error: '请输入公司名称或关键词' })
    return
  }

  const envKeys = loadKeys()
  const newsDataKey = envKeys.newsData || cleanStr(body.newsDataKey)
  const finnhubKey = envKeys.finnhub || cleanStr(body.finnhubKey)
  const tasks: Array<Promise<ServerArticle[]>> = []

  // 1) NewsData.io 实时关键词搜索
  if (newsDataKey) {
    const url = `https://newsdata.io/api/1/latest?apikey=${encodeURIComponent(newsDataKey)}&q=${encodeURIComponent(query)}&language=en,zh`
    tasks.push(
      fetchJsonWithTimeout(url).then((raw) => {
        const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
        const results = Array.isArray(record.results) ? record.results : []
        const meta = serverSourceMeta('newsdata')
        return results.flatMap((entry) => {
          const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
          const title = cleanStr(row.title)
          if (!title) return []
          const description = cleanStr(row.description) || cleanStr(row.content) || title
          const link = cleanStr(row.link) || '#'
          const sourceName = cleanStr(row.source_name)
          const lang = cleanStr(row.language).toLowerCase().startsWith('zh') ? 'zh' : 'en'
          const countries = Array.isArray(row.country)
            ? row.country.map((c) => cleanStr(c).toLowerCase())
            : []
          const isMy =
            countries.includes('malaysia') || /\b(malaysia|bursa|ringgit|klci)\b/i.test(title)
          return [
            {
              id: `newsdata-q-${hashId(`${link}|${title}`)}`,
              title,
              summary: description.slice(0, 400),
              sourceId: 'newsdata' as const,
              sourceName: sourceName ? `NewsData · ${sourceName}` : meta.name,
              url: link,
              publishedAt: safeDate(row.pubDate ?? row.pubDateTZ),
              region: isMy ? ('malaysia' as const) : ('global' as const),
              lang,
              tickers: /^[A-Z0-9.]{1,10}$/i.test(query) ? [query.toUpperCase()] : [],
              sentiment: inferSentiment(title),
              categories: ['equities', 'corporate'],
              origin: 'live' as const,
              translation: lang === 'zh' ? ('done' as const) : ('none' as const),
            },
          ]
        })
      }),
    )
  }

  // 2) Finnhub 公司新闻检索（若关键词符合 Ticker 格式）
  const tickerCandidate = query.replace(/\s+/g, '').toUpperCase()
  if (finnhubKey && /^[A-Z0-9.-]{1,10}$/.test(tickerCandidate)) {
    const to = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(tickerCandidate)}&from=${from}&to=${to}&token=${encodeURIComponent(finnhubKey)}`
    tasks.push(
      fetchJsonWithTimeout(url).then((raw) => {
        if (!Array.isArray(raw)) return []
        const meta = serverSourceMeta('finnhub')
        return raw.slice(0, 20).flatMap((entry) => {
          const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
          const title = cleanStr(row.headline)
          if (!title) return []
          const link = cleanStr(row.url) || '#'
          return [
            {
              id: `finnhub-q-${hashId(`${link}|${title}`)}`,
              title,
              summary: cleanStr(row.summary) || title,
              sourceId: 'finnhub' as const,
              sourceName: meta.name,
              url: link,
              publishedAt: safeDate(row.datetime),
              region: 'global' as const,
              lang: 'en' as const,
              tickers: [tickerCandidate],
              sentiment: inferSentiment(title),
              categories: ['corporate', 'equities'],
              origin: 'live' as const,
              translation: 'none' as const,
            },
          ]
        })
      }),
    )
  }

  // 3) GDELT 免 Key 全球财经检索兜底
  const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(
    `${query} (finance OR stock OR earnings OR market)`,
  )}%20sourcelang:english&mode=artlist&format=json&maxrecords=25&sort=datedesc`
  tasks.push(
    fetchJsonWithTimeout(gdeltUrl).then((raw) => {
      const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const list = Array.isArray(record.articles) ? record.articles : []
      const meta = serverSourceMeta('gdelt')
      return list.flatMap((entry) => {
        const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
        const title = cleanStr(row.title)
        if (!title) return []
        const link = cleanStr(row.url) || '#'
        return [
          {
            id: `gdelt-q-${hashId(`${link}|${title}`)}`,
            title,
            summary: title,
            sourceId: 'gdelt' as const,
            sourceName: meta.name,
            url: link,
            publishedAt: new Date().toISOString(),
            region: 'global' as const,
            lang: 'en' as const,
            tickers: /^[A-Z0-9.-]{1,10}$/i.test(query) ? [query.toUpperCase()] : [],
            sentiment: inferSentiment(title),
            categories: ['macro', 'equities'],
            origin: 'live' as const,
            translation: 'none' as const,
          },
        ]
      })
    }),
  )

  const settled = await Promise.allSettled(tasks)
  const articles = dedupeArticles(
    settled.flatMap((item) => (item.status === 'fulfilled' ? item.value : [])),
    60,
  )

  res.status(200).json({
    ok: true,
    query,
    articles,
    sourcesUsed: {
      newsdata: Boolean(newsDataKey),
      finnhub: Boolean(finnhubKey),
      gdelt: true,
    },
  })
}

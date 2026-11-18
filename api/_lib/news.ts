/**
 * APEX Terminal — 后台新闻聚合抓取（服务端）。
 *
 * 覆盖 12 个源：RSS（WSJ / 华尔街见闻 / CNBC / Yahoo / BERNAMA / The Star / NST /
 * The Edge）与结构化 API（Finnhub / Alpha Vantage / GDELT / Bursa）。服务端无 CORS
 * 限制，可直接抓取；RSS 采用轻量正则解析，避免引入额外 XML 依赖。
 */

import type { ServerKeys } from './env.js'
import type { NewsCategory, ServerArticle } from './types.js'
import {
  SECONDARY_FEEDS,
  SERVER_SOURCES,
  serverSourceMeta,
  sourceKey,
  type ServerSourceMeta,
} from './newsSources.js'

const TIMEOUT_MS = 9000

async function fetchText(url: string, timeout = TIMEOUT_MS): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'application/rss+xml,application/xml,text/xml,application/json,text/html,*/*',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url: string, timeout = TIMEOUT_MS): Promise<unknown> {
  try {
    return JSON.parse(await fetchText(url, timeout)) as unknown
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 通用文本处理
// ---------------------------------------------------------------------------

function stripHtml(input: string): string {
  return input
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim()
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function hashId(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) hash = (hash * 31 + input.charCodeAt(i)) | 0
  return Math.abs(hash).toString(36)
}

function safeDate(value: unknown): string {
  const parsed = typeof value === 'number' ? new Date(value * 1000) : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function parseCompactDate(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(value)
  if (match) {
    const date = new Date(
      Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6]),
      ),
    )
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return safeDate(value)
}

// ---------------------------------------------------------------------------
// 情绪与分类启发式
// ---------------------------------------------------------------------------

const BULLISH_RE =
  /(surge|soar|rally|rallies|jump|climb|gain|rise|beat|record|upgrade|strong|outperform|profit|growth|higher|boost|rebound|optimis|bullish|上涨|上升|走高|走强|利好|新高|增长|增持|看多|反弹)/i
const BEARISH_RE =
  /(plunge|slump|tumble|fall|drop|decline|slide|miss|cut|downgrade|weak|loss|lower|pressure|fear|warn|risk|recession|sell-?off|bearish|crash|sink|slip|下跌|走低|下滑|走弱|利空|减持|看空|衰退|抛售|承压)/i

export function inferSentiment(title: string): 'bullish' | 'bearish' | 'neutral' {
  const text = title.toLowerCase()
  const bullish = BULLISH_RE.test(text)
  const bearish = BEARISH_RE.test(text)
  if (bullish && !bearish) return 'bullish'
  if (bearish && !bullish) return 'bearish'
  return 'neutral'
}

const CATEGORY_RULES: Array<[NewsCategory, RegExp]> = [
  ['rates', /(fed|fomc|interest\s?rate|rate cut|rate hike|yield|treasury|bond|opr|bnm|monetary|降息|加息|利率|国债|收益率|美联储)/i],
  ['macro', /(inflation|cpi|gdp|economy|recession|unemployment|payroll|tariff|trade war|pmi|ringgit|forex|宏观|通胀|经济|关税|就业|令吉|汇率|马币)/i],
  ['energy', /(oil|crude|brent|opec|natural gas|energy|petrol|原油|油价|能源|天然气)/i],
  ['crypto', /(bitcoin|btc|ethereum|eth|crypto|blockchain|stablecoin|token|比特币|加密货币|区块链)/i],
  ['tech', /(artificial intelligence|\bai\b|semiconductor|chip|nvidia|apple|microsoft|google|meta\b|software|cloud|tech|芯片|半导体|人工智能|科技)/i],
  ['corporate', /(earnings|profit|revenue|dividend|merger|acquisition|takeover|\bipo\b|guidance|quarter|results|listing|公告|财报|业绩|盈利|分红|并购|上市)/i],
  ['equities', /(stock|shares|equity|equities|index|s&p|nasdaq|dow|market|rally|股价|股市|股票|指数|大盘)/i],
]

function categorize(title: string, meta: ServerSourceMeta): NewsCategory[] {
  const hits = CATEGORY_RULES.filter(([, re]) => re.test(title)).map(([category]) => category)
  const merged = hits.length > 0 ? hits : meta.categories
  return Array.from(new Set(merged)).slice(0, 3)
}

// ---------------------------------------------------------------------------
// 文章构造
// ---------------------------------------------------------------------------

interface RawItem {
  title: string
  summary: string
  url: string
  publishedAt: string
  tickers?: string[]
  sentimentScore?: number
}

function buildArticle(raw: RawItem, meta: ServerSourceMeta): ServerArticle {
  const title = raw.title.trim()
  const article: ServerArticle = {
    id: `${meta.id}-${hashId(`${raw.url}|${title}`)}`,
    title,
    summary: raw.summary.trim() || title,
    sourceId: meta.id,
    sourceName: meta.name,
    url: raw.url || '#',
    publishedAt: raw.publishedAt,
    region: meta.region,
    lang: meta.lang,
    tickers: raw.tickers ?? [],
    sentiment: inferSentiment(title),
    categories: categorize(title, meta),
    origin: 'live',
    translation: meta.lang === 'zh' ? 'done' : 'none',
  }
  if (raw.sentimentScore !== undefined && Number.isFinite(raw.sentimentScore)) {
    article.sentimentScore = raw.sentimentScore
    article.sentiment =
      raw.sentimentScore >= 0.15 ? 'bullish' : raw.sentimentScore <= -0.15 ? 'bearish' : 'neutral'
  }
  return article
}

// ---------------------------------------------------------------------------
// RSS 解析（轻量正则）
// ---------------------------------------------------------------------------

interface RssItem {
  title: string
  link: string
  summary: string
  publishedAt: string
}

function pickTag(block: string, tags: string[]): string {
  for (const tag of tags) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
    const match = re.exec(block)
    if (match && match[1]) return match[1]
  }
  return ''
}

function pickLink(block: string): string {
  const atom = /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(block)
  if (atom && atom[1]) return atom[1].trim()
  const plain = /<link\b[^>]*>([\s\S]*?)<\/link>/i.exec(block)
  if (plain && plain[1]) return stripHtml(plain[1])
  return ''
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = []
  const re = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) {
    const block = match[2]
    const title = stripHtml(pickTag(block, ['title']))
    if (!title) continue
    const summary = stripHtml(
      pickTag(block, ['description', 'summary', 'content:encoded', 'content']),
    ).slice(0, 400)
    const dateText = pickTag(block, ['pubDate', 'updated', 'published', 'dc:date', 'date'])
    items.push({
      title,
      link: pickLink(block),
      summary,
      publishedAt: dateText ? safeDate(stripHtml(dateText)) : new Date().toISOString(),
    })
  }
  return items
}

function parseRssToArticles(xml: string, meta: ServerSourceMeta): ServerArticle[] {
  return parseRss(xml)
    .slice(0, 30)
    .map((item) =>
      buildArticle(
        { title: item.title, summary: item.summary || item.title, url: item.link, publishedAt: item.publishedAt },
        meta,
      ),
    )
}

// ---------------------------------------------------------------------------
// 结构化 API 源
// ---------------------------------------------------------------------------

async function loadFinnhub(key: string): Promise<ServerArticle[]> {
  const meta = serverSourceMeta('finnhub')
  const rows = asArray(await fetchJson(`https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(key)}`))
  return rows.flatMap((entry) => {
    const row = asRecord(entry)
    const title = asString(row.headline)
    if (!title) return []
    const related = asString(row.related)
    return [
      buildArticle(
        {
          title,
          summary: asString(row.summary),
          url: asString(row.url),
          publishedAt: safeDate(row.datetime),
          tickers: related ? related.split(',').map((t) => t.trim()).filter(Boolean) : [],
        },
        meta,
      ),
    ]
  })
}

async function loadAlphaVantage(key: string): Promise<ServerArticle[]> {
  const meta = serverSourceMeta('alphavantage')
  const data = asRecord(
    await fetchJson(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&limit=50&apikey=${encodeURIComponent(key)}`),
  )
  return asArray(data.feed).flatMap((entry) => {
    const row = asRecord(entry)
    const title = asString(row.title)
    if (!title) return []
    const score = Number(row.overall_sentiment_score)
    const tickers = asArray(row.ticker_sentiment)
      .map((item) => asString(asRecord(item).ticker))
      .filter(Boolean)
    return [
      buildArticle(
        {
          title,
          summary: asString(row.summary),
          url: asString(row.url),
          publishedAt: parseCompactDate(asString(row.time_published)),
          tickers,
          sentimentScore: Number.isFinite(score) ? score : undefined,
        },
        meta,
      ),
    ]
  })
}

async function loadGdelt(): Promise<ServerArticle[]> {
  const meta = serverSourceMeta('gdelt')
  const url =
    'https://api.gdeltproject.org/api/v2/doc/doc?query=(finance%20OR%20markets%20OR%20economy)' +
    '%20sourcelang:english&mode=artlist&format=json&maxrecords=50&sort=datedesc'
  const data = asRecord(await fetchJson(url))
  return asArray(data.articles).flatMap((entry) => {
    const row = asRecord(entry)
    const title = asString(row.title)
    if (!title) return []
    return [
      buildArticle(
        { title, summary: '', url: asString(row.url), publishedAt: parseCompactDate(asString(row.seendate)) },
        meta,
      ),
    ]
  })
}

async function loadBursa(): Promise<ServerArticle[]> {
  const meta = serverSourceMeta('bursa')
  try {
    const data = await fetchJson('https://www.bursamalaysia.com/api/v1/announcements?per_page=30')
    const list = Array.isArray(data)
      ? data
      : Object.values(asRecord(asRecord(data).data)).find(Array.isArray) ?? []
    const articles = asArray(list).flatMap((entry) => {
      const row = asRecord(entry)
      const title = asString(row.title) || asString(row.subject) || asString(row.company_name)
      if (!title) return []
      return [
        buildArticle(
          {
            title,
            summary: asString(row.summary) || title,
            url: asString(row.url) || asString(row.link),
            publishedAt: safeDate(row.date ?? row.created_at),
          },
          meta,
        ),
      ]
    })
    return articles
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// 调度
// ---------------------------------------------------------------------------

async function loadRssSource(meta: ServerSourceMeta): Promise<ServerArticle[]> {
  const urls = [meta.feedUrl, ...(SECONDARY_FEEDS[meta.id] ?? [])].filter(
    (value): value is string => Boolean(value),
  )
  if (meta.id === 'cnbc') {
    const settled = await Promise.allSettled(urls.map((url) => fetchText(url)))
    return settled.flatMap((result) =>
      result.status === 'fulfilled' ? parseRssToArticles(result.value, meta) : [],
    )
  }
  for (const url of urls) {
    try {
      const articles = parseRssToArticles(await fetchText(url), meta)
      if (articles.length > 0) return articles
    } catch {
      // 顺延下一个地址
    }
  }
  return []
}

async function loadSource(meta: ServerSourceMeta, keys: ServerKeys): Promise<ServerArticle[]> {
  if (meta.kind === 'rss') return loadRssSource(meta)
  const key = sourceKey(meta.id, keys)
  switch (meta.id) {
    case 'finnhub':
      return key ? loadFinnhub(key).catch(() => []) : []
    case 'alphavantage':
      return key ? loadAlphaVantage(key).catch(() => []) : []
    case 'gdelt':
      return loadGdelt().catch(() => [])
    case 'bursa':
      return loadBursa().catch(() => [])
    default:
      return []
  }
}

/** 合并去重：按 url / 标题去重、丢弃过短标题、按时间降序、截断 */
function finalize(articles: ServerArticle[], limit: number): ServerArticle[] {
  const seen = new Set<string>()
  const out: ServerArticle[] = []
  for (const article of articles) {
    if (article.title.trim().length < 8) continue
    const key = (article.url && article.url !== '#' ? article.url : article.title).toLowerCase().trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(article)
  }
  out.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
  return out.slice(0, limit)
}

/** 并发抓取全部新闻源，返回合并去重后的文章列表 */
export async function fetchAllNews(keys: ServerKeys, limit = 120): Promise<ServerArticle[]> {
  const settled = await Promise.allSettled(SERVER_SOURCES.map((meta) => loadSource(meta, keys)))
  const articles = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  return finalize(articles, limit)
}

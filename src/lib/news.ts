import type {
  ApiSettings,
  NewsArticle,
  NewsCategory,
  NewsRegion,
  NewsSourceId,
  ProviderId,
} from '@/types'
import { safeNumber } from '@/lib/format'

/**
 * APEX Terminal — 多源财经新闻数据层
 *
 * 覆盖 12 个新闻源：结构化 API（Finnhub / Alpha Vantage / GDELT）、马来西亚本地频道
 * （BERNAMA / The Star / NST / The Edge / Bursa）以及美股与全球频道（WSJ / 华尔街见闻 /
 * CNBC / Yahoo Finance）。
 *
 * 所有网络请求都会先直连，失败后依次走公共 CORS 网关回退；任一源失败都被静默忽略，
 * 再用内置的高仿真基准新闻兜底，保证「全球与马股实时财经新闻中心」永不空白。
 */

// ---------------------------------------------------------------------------
// 公开类型
// ---------------------------------------------------------------------------

export interface NewsSourceMeta {
  id: NewsSourceId
  /** 展示名 */
  name: string
  region: NewsRegion
  lang: 'en' | 'zh'
  kind: 'rss' | 'api'
  /** 需要哪个引擎的 Key（null 表示免 Key） */
  needsKey: ProviderId | null
  /** RSS 源地址（kind === 'rss' 时） */
  feedUrl?: string
  /** 该源默认归属的分类 */
  categories: NewsCategory[]
  accent: 'gold' | 'ice' | 'iris' | 'bull' | 'bear' | 'neutral'
}

// ---------------------------------------------------------------------------
// 新闻源清单
// ---------------------------------------------------------------------------

export const NEWS_SOURCES: NewsSourceMeta[] = [
  {
    id: 'wsj',
    name: 'WSJ Markets',
    region: 'global',
    lang: 'en',
    kind: 'rss',
    needsKey: null,
    feedUrl: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
    categories: ['equities', 'macro'],
    accent: 'gold',
  },
  {
    id: 'wallstreetcn',
    name: '华尔街见闻',
    region: 'global',
    lang: 'zh',
    kind: 'rss',
    needsKey: null,
    feedUrl: 'https://dedicated.wallstreetcn.com/rss.xml',
    categories: ['macro', 'equities'],
    accent: 'iris',
  },
  {
    id: 'cnbc',
    name: 'CNBC Markets',
    region: 'global',
    lang: 'en',
    kind: 'rss',
    needsKey: null,
    feedUrl: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    categories: ['equities', 'macro'],
    accent: 'ice',
  },
  {
    id: 'yahoo',
    name: 'Yahoo Finance',
    region: 'global',
    lang: 'en',
    kind: 'rss',
    needsKey: null,
    categories: ['equities'],
    accent: 'iris',
  },
  {
    id: 'finnhub',
    name: 'Finnhub News',
    region: 'global',
    lang: 'en',
    kind: 'api',
    needsKey: 'finnhub',
    categories: ['equities', 'corporate'],
    accent: 'bull',
  },
  {
    id: 'alphavantage',
    name: 'Alpha Vantage Sentiment',
    region: 'global',
    lang: 'en',
    kind: 'api',
    needsKey: 'alphavantage',
    categories: ['equities', 'macro'],
    accent: 'neutral',
  },
  {
    id: 'gdelt',
    name: 'GDELT Global',
    region: 'global',
    lang: 'en',
    kind: 'api',
    needsKey: null,
    categories: ['macro'],
    accent: 'neutral',
  },
  {
    id: 'bernama',
    name: 'BERNAMA Business',
    region: 'malaysia',
    lang: 'en',
    kind: 'rss',
    needsKey: null,
    feedUrl: 'https://www.bernama.com/en/rssfeed.php',
    categories: ['macro', 'corporate'],
    accent: 'gold',
  },
  {
    id: 'thestar',
    name: 'The Star Business',
    region: 'malaysia',
    lang: 'en',
    kind: 'rss',
    needsKey: null,
    feedUrl: 'https://www.thestar.com.my/rss/Business/',
    categories: ['equities', 'corporate'],
    accent: 'ice',
  },
  {
    id: 'nst',
    name: 'NST Business',
    region: 'malaysia',
    lang: 'en',
    kind: 'rss',
    needsKey: null,
    feedUrl: 'https://www.nst.com.my/rss/business',
    categories: ['equities', 'corporate'],
    accent: 'iris',
  },
  {
    id: 'theedgemalaysia',
    name: 'The Edge Malaysia',
    region: 'malaysia',
    lang: 'en',
    kind: 'rss',
    needsKey: null,
    feedUrl: 'https://theedgemalaysia.com/rss',
    categories: ['equities', 'corporate'],
    accent: 'bull',
  },
  {
    id: 'bursa',
    name: 'Bursa Malaysia',
    region: 'malaysia',
    lang: 'en',
    kind: 'api',
    needsKey: null,
    categories: ['corporate'],
    accent: 'ice',
  },
]

const SOURCE_MAP = new Map<NewsSourceId, NewsSourceMeta>(NEWS_SOURCES.map((meta) => [meta.id, meta]))

/** 通过 id 取源元数据 */
export function sourceMeta(id: NewsSourceId): NewsSourceMeta {
  const meta = SOURCE_MAP.get(id)
  if (!meta) throw new Error(`未知新闻源: ${id}`)
  return meta
}

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

/** 容错 JSON 解析：失败返回 null，由调用方按空结果处理 */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 把 unknown 安全转为对象字典 */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** 把 unknown 安全转为数组 */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 把 unknown 安全转为字符串 */
function asString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/** 简易稳定哈希，用于生成文章 id */
function hashId(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

/** 去掉 HTML 标签与常见实体，压缩空白 */
function stripHtml(input: string): string {
  return input
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** 秒 / 毫秒时间戳或日期字符串 → ISO 字符串 */
function toIso(value: unknown, unit: 'sec' | 'ms' | 'text'): string {
  if (unit === 'text') {
    if (typeof value === 'number') {
      const fromNumber = new Date(value)
      return Number.isNaN(fromNumber.getTime()) ? new Date().toISOString() : fromNumber.toISOString()
    }
    const parsed = new Date(String(value))
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
  }
  const n = safeNumber(value, Number.NaN)
  if (!Number.isFinite(n)) return new Date().toISOString()
  return new Date(unit === 'sec' ? n * 1000 : n).toISOString()
}

/** 解析 YYYYMMDDTHHMMSS（Alpha Vantage / GDELT）或任意日期字符串 → ISO */
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
  const fallback = new Date(value)
  return Number.isNaN(fallback.getTime()) ? new Date().toISOString() : fallback.toISOString()
}

/** 取 YYYY-MM-DD */
function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// 启发式：情绪与分类
// ---------------------------------------------------------------------------

const BULLISH_RE =
  /(surge|soar|rally|rallies|jump|jumps|climb|gain|gains|rise|rises|beat|beats|record|upgrade|strength|strong|outperform|profit|growth|higher|boost|rebound|optimis|bullish|upside|advance|rebound|扩(张|产)|上涨|上升|走高|走强|利好|新高|增长|增持|看多|反弹)/i
const BEARISH_RE =
  /(plunge|slump|tumble|fall|falls|drop|drops|decline|slide|miss|misses|cut|cuts|downgrade|weak|loss|losses|lower|pressure|fear|warn|risk|recession|sell-?off|bearish|crash|sink|downside|slip|slips|下跌|走低|下滑|走弱|利空|减持|看空|衰退|抛售|承压)/i

/** 依据标题关键词推断多空情绪 */
export function inferSentiment(title: string): 'bullish' | 'bearish' | 'neutral' {
  const text = title.toLowerCase()
  const bullish = BULLISH_RE.test(text)
  const bearish = BEARISH_RE.test(text)
  if (bullish && !bearish) return 'bullish'
  if (bearish && !bullish) return 'bearish'
  return 'neutral'
}

/** 把 -1~1 的情绪分映射为离散情绪 */
function scoreToSentiment(score: number): 'bullish' | 'bearish' | 'neutral' {
  if (score >= 0.15) return 'bullish'
  if (score <= -0.15) return 'bearish'
  return 'neutral'
}

const CATEGORY_RULES: Array<[NewsCategory, RegExp]> = [
  ['rates', /(fed|fomc|interest\s?rate|rate cut|rate hike|yield|treasury|bond|opr|bnm|monetary|降息|加息|利率|国债|收益率|美联储|货币政策)/i],
  ['macro', /(inflation|cpi|gdp|economy|economic|recession|unemployment|jobs|payroll|tariff|trade war|pmi|ringgit|currency|forex|宏观|通胀|经济|关税|就业|令吉|汇率|马币)/i],
  ['energy', /(oil|crude|brent|opec|natural gas|energy|petrol|diesel|原油|油价|能源|天然气)/i],
  ['crypto', /(bitcoin|btc|ethereum|eth|crypto|blockchain|stablecoin|token|比特币|加密货币|区块链)/i],
  ['tech', /(artificial intelligence|\bai\b|semiconductor|chip|nvidia|apple|microsoft|google|meta\b|software|cloud|tech|technology|芯片|半导体|人工智能|科技)/i],
  ['corporate', /(earnings|profit|revenue|dividend|merger|acquisition|takeover|\bipo\b|guidance|quarter|results|listing|公告|财报|业绩|盈利|分红|并购|上市|回购)/i],
  ['equities', /(stock|shares|equity|equities|index|s&p|nasdaq|dow|market|rally|股价|股市|股票|指数|大盘)/i],
]

/** 依据标题关键词 + 源默认分类推断文章分类 */
export function categorize(title: string, source: NewsSourceMeta): NewsCategory[] {
  const hits = CATEGORY_RULES.filter(([, re]) => re.test(title)).map(([category]) => category)
  const merged = hits.length > 0 ? hits : source.categories
  return Array.from(new Set(merged)).slice(0, 3)
}

// ---------------------------------------------------------------------------
// 网络：直连 + CORS 网关回退
// ---------------------------------------------------------------------------

const CORS_GATEWAYS: Array<(url: string) => string> = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
]

/** 单次抓取的整体超时预算（毫秒） */
const REQUEST_TIMEOUT = 9000

/**
 * 抓取文本：先直连，失败后依次尝试公共 CORS 网关。
 * 整个调用共享一个 ~9000ms 的超时预算，超时或全部失败则抛错。
 */
async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort)
  }

  const candidates = [url, ...CORS_GATEWAYS.map((build) => build(url))]
  let lastError: unknown

  try {
    for (const candidate of candidates) {
      if (controller.signal.aborted) break
      try {
        const response = await fetch(candidate, { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.text()
      } catch (error) {
        lastError = error
      }
    }
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }

  throw lastError instanceof Error ? lastError : new Error(`请求失败: ${url}`)
}

// ---------------------------------------------------------------------------
// 文章构造
// ---------------------------------------------------------------------------

interface RawArticle {
  title: string
  summary: string
  url: string
  publishedAt: string
  tickers?: string[]
  lang?: 'en' | 'zh'
  sentimentScore?: number
}

/** 把源无关的原始条目补全为 NewsArticle */
function buildArticle(raw: RawArticle, meta: NewsSourceMeta): NewsArticle {
  const title = raw.title.trim()
  const lang = raw.lang ?? meta.lang
  const tickers = (raw.tickers ?? []).map((ticker) => ticker.trim()).filter(Boolean)
  const score = raw.sentimentScore

  const article: NewsArticle = {
    id: `${meta.id}-${hashId(`${raw.url}|${title}`)}`,
    title,
    summary: raw.summary.trim() || title,
    sourceId: meta.id,
    sourceName: meta.name,
    url: raw.url || '#',
    publishedAt: raw.publishedAt,
    region: meta.region,
    lang,
    tickers,
    sentiment:
      score !== undefined && Number.isFinite(score) ? scoreToSentiment(score) : inferSentiment(title),
    categories: categorize(title, meta),
    origin: 'live',
    translation: lang === 'zh' ? 'done' : 'none',
  }

  if (score !== undefined && Number.isFinite(score)) article.sentimentScore = score
  return article
}

// ---------------------------------------------------------------------------
// RSS 解析
// ---------------------------------------------------------------------------

interface ParsedFeedItem {
  title: string
  link: string
  summary: string
  publishedAt: string
}

/** 用 DOMParser 解析 RSS / Atom，取 item 与 entry 节点 */
function parseRss(xml: string): ParsedFeedItem[] {
  if (typeof DOMParser === 'undefined') return []
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const nodes = Array.from(doc.querySelectorAll('item, entry'))
  return nodes.map((node) => {
    const title = stripHtml(node.querySelector('title')?.textContent ?? '')
    const linkNode = node.querySelector('link')
    const link = (linkNode?.getAttribute('href') ?? linkNode?.textContent ?? '').trim()
    const rawSummary =
      node.querySelector('description')?.textContent ??
      node.querySelector('summary')?.textContent ??
      node.querySelector('content')?.textContent ??
      ''
    const dateText =
      node.querySelector('pubDate')?.textContent ??
      node.querySelector('updated')?.textContent ??
      node.querySelector('published')?.textContent ??
      node.querySelector('date')?.textContent ??
      ''
    return {
      title,
      link,
      summary: stripHtml(rawSummary).slice(0, 240),
      publishedAt: toIso(dateText, 'text'),
    }
  })
}

/** 解析 RSS XML 为文章列表 */
function parseRssToArticles(xml: string, meta: NewsSourceMeta, symbol?: string): NewsArticle[] {
  return parseRss(xml)
    .filter((item) => item.title.length > 0)
    .slice(0, 30)
    .map((item) =>
      buildArticle(
        {
          title: item.title,
          summary: item.summary || item.title,
          url: item.link,
          publishedAt: item.publishedAt,
          tickers: symbol ? [symbol] : [],
        },
        meta,
      ),
    )
}

// ---------------------------------------------------------------------------
// 结构化 API 源
// ---------------------------------------------------------------------------

/** Finnhub：general 频道 + 可选个股 company-news */
async function loadFinnhub(
  key: string,
  symbol: string | undefined,
  signal?: AbortSignal,
): Promise<NewsArticle[]> {
  const meta = sourceMeta('finnhub')
  const articles: NewsArticle[] = []

  const mapRows = (rows: unknown[], fallbackTicker?: string) => {
    for (const entry of rows) {
      const row = asRecord(entry)
      const title = asString(row.headline)
      if (!title) continue
      const related = asString(row.related)
      const tickers = related
        ? related.split(',').map((ticker) => ticker.trim()).filter(Boolean)
        : fallbackTicker
          ? [fallbackTicker]
          : []
      articles.push(
        buildArticle(
          {
            title,
            summary: asString(row.summary),
            url: asString(row.url),
            publishedAt: toIso(row.datetime, 'sec'),
            tickers,
          },
          meta,
        ),
      )
    }
  }

  try {
    const generalUrl = `https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(key)}`
    mapRows(asArray(safeJson(await fetchText(generalUrl, signal))))
  } catch {
    // 静默忽略
  }

  if (symbol) {
    try {
      const to = ymd(Date.now())
      const from = ymd(Date.now() - 7 * 86_400_000)
      const companyUrl = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${encodeURIComponent(key)}`
      mapRows(asArray(safeJson(await fetchText(companyUrl, signal))), symbol)
    } catch {
      // 静默忽略
    }
  }

  return articles
}

/** Alpha Vantage：NEWS_SENTIMENT，附整体情绪分与 ticker_sentiment */
async function loadAlphaVantage(
  key: string,
  symbol: string | undefined,
  signal?: AbortSignal,
): Promise<NewsArticle[]> {
  const meta = sourceMeta('alphavantage')
  const url =
    `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&limit=50` +
    `&apikey=${encodeURIComponent(key)}${symbol ? `&tickers=${encodeURIComponent(symbol)}` : ''}`
  const data = safeJson(await fetchText(url, signal))
  const feed = asArray(asRecord(data).feed)
  const articles: NewsArticle[] = []

  for (const entry of feed) {
    const row = asRecord(entry)
    const title = asString(row.title)
    if (!title) continue
    const score = safeNumber(row.overall_sentiment_score, Number.NaN)
    const tickers = asArray(row.ticker_sentiment)
      .map((item) => asString(asRecord(item).ticker))
      .filter(Boolean)
    articles.push(
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
    )
  }

  return articles
}

/** GDELT：免 Key 的全球金融新闻（tickers 置空） */
async function loadGdelt(signal?: AbortSignal): Promise<NewsArticle[]> {
  const meta = sourceMeta('gdelt')
  const url =
    'https://api.gdeltproject.org/api/v2/doc/doc?query=(finance%20OR%20markets%20OR%20economy)' +
    '%20sourcelang:english&mode=artlist&format=json&maxrecords=50&sort=datedesc'
  const data = safeJson(await fetchText(url, signal))
  const articles: NewsArticle[] = []

  for (const entry of asArray(asRecord(data).articles)) {
    const row = asRecord(entry)
    const title = asString(row.title)
    if (!title) continue
    articles.push(
      buildArticle(
        {
          title,
          summary: '',
          url: asString(row.url),
          publishedAt: parseCompactDate(asString(row.seendate)),
          tickers: [],
        },
        meta,
      ),
    )
  }

  return articles
}

/** 从任意 JSON 结构中取出公告数组（取第一个数组字段） */
function extractAnnouncementList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  const record = asRecord(data)
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) return value
  }
  const nested = asRecord(record.data)
  for (const value of Object.values(nested)) {
    if (Array.isArray(value)) return value
  }
  return []
}

/** 从 Bursa 公告 HTML 页面兜底提取链接型公告 */
function parseBursaHtml(html: string, meta: NewsSourceMeta): NewsArticle[] {
  if (typeof DOMParser === 'undefined') return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const articles: NewsArticle[] = []
  for (const anchor of Array.from(doc.querySelectorAll('a'))) {
    const title = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (title.length < 12) continue
    const href = anchor.getAttribute('href') ?? ''
    const url = href.startsWith('http')
      ? href
      : href
        ? `https://www.bursamalaysia.com${href}`
        : '#'
    if (!/announcement/i.test(url)) continue
    articles.push(
      buildArticle(
        {
          title,
          summary: title,
          url,
          publishedAt: new Date().toISOString(),
          tickers: [],
        },
        meta,
      ),
    )
    if (articles.length >= 15) break
  }
  return articles
}

/** Bursa Malaysia 公司公告（尽力而为，失败即返回空） */
async function loadBursa(signal?: AbortSignal): Promise<NewsArticle[]> {
  const meta = sourceMeta('bursa')
  const articles: NewsArticle[] = []

  try {
    const apiUrl = 'https://www.bursamalaysia.com/api/v1/announcements?per_page=30'
    const list = extractAnnouncementList(safeJson(await fetchText(apiUrl, signal)))
    for (const entry of list) {
      const row = asRecord(entry)
      const title =
        asString(row.title) || asString(row.subject) || asString(row.name) || asString(row.company_name)
      if (!title) continue
      const url = asString(row.url) || asString(row.link) || asString(row.announcement_url)
      const publishedAt = toIso(
        row.date ?? row.announced_date ?? row.created_at ?? row.timestamp,
        'text',
      )
      articles.push(
        buildArticle(
          {
            title,
            summary: asString(row.summary) || asString(row.content) || title,
            url,
            publishedAt,
            tickers: [],
          },
          meta,
        ),
      )
    }
  } catch {
    // 静默忽略
  }

  if (articles.length === 0) {
    try {
      const pageUrl =
        'https://www.bursamalaysia.com/market_information/announcements/company_announcement'
      articles.push(...parseBursaHtml(await fetchText(pageUrl, signal), meta))
    } catch {
      // 静默忽略
    }
  }

  return articles
}

// ---------------------------------------------------------------------------
// 各源调度
// ---------------------------------------------------------------------------

/** 部分 RSS 源的次级 / 备用地址 */
const SECONDARY_FEEDS: Partial<Record<NewsSourceId, string[]>> = {
  bernama: ['https://www.bernama.com/en/rss/business.xml'],
  theedgemalaysia: ['https://www.theedgemarkets.com/rss.xml'],
  cnbc: ['https://www.cnbc.com/id/10000664/device/rss/rss.html'],
}

/** 加载单个 RSS 源 */
async function loadRssSource(
  meta: NewsSourceMeta,
  symbol: string | undefined,
  signal?: AbortSignal,
): Promise<NewsArticle[]> {
  // Yahoo Finance 需要 symbol，否则跳过
  if (meta.id === 'yahoo') {
    if (!symbol) return []
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`
    try {
      return parseRssToArticles(await fetchText(url, signal), meta, symbol)
    } catch {
      return []
    }
  }

  const urls = [meta.feedUrl, ...(SECONDARY_FEEDS[meta.id] ?? [])].filter(
    (value): value is string => Boolean(value),
  )

  // CNBC：多个频道合并
  if (meta.id === 'cnbc') {
    const settled = await Promise.allSettled(urls.map((url) => fetchText(url, signal)))
    return settled.flatMap((result) =>
      result.status === 'fulfilled' ? parseRssToArticles(result.value, meta) : [],
    )
  }

  // 其它源：主源解析不到 item 时顺延下一个地址
  for (const url of urls) {
    try {
      const articles = parseRssToArticles(await fetchText(url, signal), meta)
      if (articles.length > 0) return articles
    } catch {
      // 静默忽略，继续下一个地址
    }
  }
  return []
}

/** 加载单个 API 源 */
function loadApiSource(
  meta: NewsSourceMeta,
  settings: ApiSettings,
  symbol: string | undefined,
  signal?: AbortSignal,
): Promise<NewsArticle[]> {
  if (meta.needsKey) {
    const key = settings.providers?.[meta.needsKey]?.apiKey?.trim() ?? ''
    if (!key) return Promise.resolve([])
    if (meta.id === 'finnhub') return loadFinnhub(key, symbol, signal)
    if (meta.id === 'alphavantage') return loadAlphaVantage(key, symbol, signal)
    return Promise.resolve([])
  }
  if (meta.id === 'gdelt') return loadGdelt(signal)
  if (meta.id === 'bursa') return loadBursa(signal)
  return Promise.resolve([])
}

/** 调度单个源 */
function loadSource(
  meta: NewsSourceMeta,
  settings: ApiSettings,
  symbol: string | undefined,
  signal?: AbortSignal,
): Promise<NewsArticle[]> {
  return meta.kind === 'rss'
    ? loadRssSource(meta, symbol, signal)
    : loadApiSource(meta, settings, symbol, signal)
}

/** 合并去重：按 url（或标题）去重、丢弃过短标题、按时间降序、截断到 150 条 */
function finalizeArticles(articles: NewsArticle[]): NewsArticle[] {
  const seen = new Set<string>()
  const result: NewsArticle[] = []
  for (const article of articles) {
    if (article.title.trim().length < 8) continue
    const key = (article.url && article.url !== '#' ? article.url : article.title).toLowerCase().trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(article)
  }
  result.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
  return result.slice(0, 150)
}

/**
 * 并发拉取全部在线源，返回合并去重后的文章。
 * 任一源失败都会被静默忽略；全部失败则返回空数组（由调用方回落到基准新闻）。
 */
export async function loadLiveNews(
  settings: ApiSettings,
  options: { symbol?: string; signal?: AbortSignal } = {},
): Promise<NewsArticle[]> {
  if (typeof DOMParser === 'undefined') return []
  const { symbol, signal } = options
  const settled = await Promise.allSettled(
    NEWS_SOURCES.map((meta) => loadSource(meta, settings, symbol, signal)),
  )
  const articles = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  return finalizeArticles(articles)
}

// ---------------------------------------------------------------------------
// 过滤工具
// ---------------------------------------------------------------------------

/** 归一化股票代码，便于忽略 .KL 后缀 / 大小写差异进行匹配 */
function normalizeTicker(value: string): string {
  return value.trim().toUpperCase()
}

/** 判断文章是否命中给定标的（tickers 为空则视为不命中） */
export function matchesSymbol(article: NewsArticle, symbol: string): boolean {
  const target = normalizeTicker(symbol)
  if (!target) return true
  const bare = target.replace(/\.KL$/, '')
  return article.tickers.some((ticker) => {
    const normalized = normalizeTicker(ticker)
    return (
      normalized === target ||
      normalized.replace(/\.KL$/, '') === bare ||
      normalized.replace(/[^A-Z0-9]/g, '') === target.replace(/[^A-Z0-9]/g, '')
    )
  })
}

// ---------------------------------------------------------------------------
// 基准新闻（高仿真兜底）
// ---------------------------------------------------------------------------

interface BaselineSeed {
  sourceId: NewsSourceId
  title: string
  summary: string
  minutesAgo: number
  tickers: string[]
  sentiment: 'bullish' | 'bearish' | 'neutral'
  categories: NewsCategory[]
  sentimentScore?: number
}

const BASELINE_SEEDS: BaselineSeed[] = [
  // ------------------------------------------------ 美股 / 全球
  {
    sourceId: 'wsj',
    title: 'Fed Officials Signal Caution on Rate Cuts as Inflation Cools Only Gradually',
    summary:
      'Minutes showed several policymakers favouring an extended hold, pushing front-end Treasury yields higher while equities traded sideways.',
    minutesAgo: 14,
    tickers: ['US10Y', 'JPM'],
    sentiment: 'neutral',
    categories: ['rates', 'macro'],
  },
  {
    sourceId: 'wsj',
    title: "Nvidia's Data-Center Demand Shows No Sign of Cooling Into Next Quarter",
    summary:
      'Hyperscaler capex guidance continues to outrun supply, keeping accelerator order books full through the coming fiscal year.',
    minutesAgo: 42,
    tickers: ['NVDA', 'AMD'],
    sentiment: 'bullish',
    categories: ['tech', 'corporate'],
  },
  {
    sourceId: 'wsj',
    title: 'Apple Services Margin Hits Record Even as Hardware Growth Stalls',
    summary:
      'High-margin services revenue now covers a rising share of group gross profit, but device replacement cycles remain stretched.',
    minutesAgo: 96,
    tickers: ['AAPL'],
    sentiment: 'neutral',
    categories: ['tech', 'corporate'],
  },
  {
    sourceId: 'cnbc',
    title: 'Oil Slips Below $70 as OPEC+ Weighs Faster Output Normalisation',
    summary:
      'Brent futures retreated on expectations of additional barrels returning to the market, pressuring integrated energy earnings estimates.',
    minutesAgo: 158,
    tickers: ['XOM', '3816.KL'],
    sentiment: 'bearish',
    categories: ['energy', 'macro'],
  },
  {
    sourceId: 'cnbc',
    title: 'Tesla Deliveries Miss Estimates as EV Price War Intensifies',
    summary:
      'Quarterly volumes came in below consensus as price cuts across the sector failed to offset softer demand in key markets.',
    minutesAgo: 63,
    tickers: ['TSLA'],
    sentiment: 'bearish',
    categories: ['equities', 'corporate'],
  },
  {
    sourceId: 'wsj',
    title: 'Regional Banks Brace for Lower Net Interest Income in the Year Ahead',
    summary:
      'Deposit repricing and a flatter curve are expected to compress margins, though credit costs remain contained for now.',
    minutesAgo: 221,
    tickers: ['JPM', '1155.KL', '1295.KL'],
    sentiment: 'bearish',
    categories: ['rates', 'corporate'],
  },
  {
    sourceId: 'cnbc',
    title: 'Dollar Retreats as Traders Trim Bets on a Hawkish Fed',
    summary:
      'A softer rate outlook knocked the greenback off recent highs, easing pressure on emerging-market currencies.',
    minutesAgo: 131,
    tickers: ['US10Y'],
    sentiment: 'neutral',
    categories: ['macro', 'rates'],
  },
  {
    sourceId: 'finnhub',
    title: 'Chipmakers Rally on Robust AI Server Orders',
    summary:
      'Accelerator suppliers guided higher on sustained hyperscaler demand, lifting the broader semiconductor complex.',
    minutesAgo: 77,
    tickers: ['NVDA', 'AMD'],
    sentiment: 'bullish',
    categories: ['tech', 'equities'],
  },
  {
    sourceId: 'alphavantage',
    title: 'Treasury Yields Edge Higher Ahead of Key Inflation Print',
    summary:
      'Investors positioned defensively before the CPI release, with the 10-year note yield testing the upper end of its recent range.',
    minutesAgo: 189,
    tickers: ['US10Y', 'US2Y'],
    sentiment: 'bearish',
    categories: ['rates', 'macro'],
    sentimentScore: -0.21,
  },
  {
    sourceId: 'gdelt',
    title: 'Global Markets Steady as Investors Weigh Growth Outlook',
    summary:
      'Equities held a narrow range while attention stayed fixed on central-bank guidance and the trajectory of corporate earnings.',
    minutesAgo: 104,
    tickers: [],
    sentiment: 'neutral',
    categories: ['macro', 'equities'],
  },
  {
    sourceId: 'yahoo',
    title: 'Microsoft Cloud Growth Keeps Shares Near Record High',
    summary:
      'Azure momentum and disciplined cost control supported the stock as analysts reiterated constructive ratings.',
    minutesAgo: 55,
    tickers: ['MSFT'],
    sentiment: 'bullish',
    categories: ['tech', 'corporate'],
  },
  {
    sourceId: 'wsj',
    title: 'Gold Extends Record Run on Rate-Cut Optimism',
    summary:
      'Bullion advanced as real yields eased and central-bank buying remained firm, keeping the metal near all-time highs.',
    minutesAgo: 240,
    tickers: ['GLD'],
    sentiment: 'bullish',
    categories: ['macro'],
  },
  // ------------------------------------------------ 中文源
  {
    sourceId: 'wallstreetcn',
    title: '美联储会议纪要：多数官员认为通胀回落进程仍需更多数据验证',
    summary:
      '纪要显示决策层对过早宽松保持警惕，市场对年内降息幅度的定价小幅下修，10 年期美债收益率随之走高。',
    minutesAgo: 21,
    tickers: ['US10Y', 'US2Y'],
    sentiment: 'bearish',
    categories: ['rates', 'macro'],
  },
  {
    sourceId: 'wallstreetcn',
    title: '英伟达业绩前瞻：AI 资本开支仍是决定估值中枢的核心变量',
    summary:
      '卖方普遍上调数据中心收入预期，但同时提示供应链交期与客户集中度带来的波动风险。',
    minutesAgo: 87,
    tickers: ['NVDA'],
    sentiment: 'bullish',
    categories: ['tech', 'corporate'],
  },
  {
    sourceId: 'wallstreetcn',
    title: '10 年期美债收益率升破 4.4%，全球风险资产承压',
    summary:
      '实际利率上行削弱高估值成长股的贴现支撑，资金阶段性转向高股息防御板块。',
    minutesAgo: 205,
    tickers: ['US10Y', 'TSLA', 'KO'],
    sentiment: 'bearish',
    categories: ['rates', 'macro'],
  },
  // ------------------------------------------------ 马来西亚
  {
    sourceId: 'thestar',
    title: 'Maybank posts higher net profit on stronger non-interest income',
    summary:
      'Malaysia’s largest bank by assets reported resilient treasury and fee income, with return on equity holding above 11%.',
    minutesAgo: 33,
    tickers: ['1155.KL'],
    sentiment: 'bullish',
    categories: ['corporate', 'equities'],
  },
  {
    sourceId: 'thestar',
    title: 'Public Bank keeps dividend payout steady amid mid-single-digit loan growth',
    summary:
      'Management guided for stable asset quality and reaffirmed its commitment to a progressive dividend policy.',
    minutesAgo: 74,
    tickers: ['1295.KL'],
    sentiment: 'neutral',
    categories: ['corporate', 'equities'],
  },
  {
    sourceId: 'thestar',
    title: 'Bursa Malaysia records RM2.1bil foreign net inflow in October',
    summary:
      'Foreign funds returned to the local bourse on cheap valuations and a firmer ringgit, exchange data showed.',
    minutesAgo: 119,
    tickers: ['1155.KL', '1023.KL'],
    sentiment: 'bullish',
    categories: ['equities', 'macro'],
  },
  {
    sourceId: 'bernama',
    title: 'BNM holds OPR at 3.00% as growth stays resilient',
    summary:
      'Bank Negara said the current policy stance remains supportive of growth while anchoring inflation expectations.',
    minutesAgo: 58,
    tickers: ['1155.KL', '1295.KL', '1023.KL'],
    sentiment: 'neutral',
    categories: ['rates', 'macro'],
  },
  {
    sourceId: 'bernama',
    title: 'Ringgit strengthens past 4.20 against the US dollar',
    summary:
      'A narrower rate differential and improved portfolio flows supported the currency, easing imported input costs.',
    minutesAgo: 302,
    tickers: ['1155.KL'],
    sentiment: 'bullish',
    categories: ['macro', 'rates'],
  },
  {
    sourceId: 'nst',
    title: 'Tenaga Nasional accelerates grid capex to meet data-centre demand',
    summary:
      'The utility is front-loading transmission investment as new hyperscale campuses connect to the national grid.',
    minutesAgo: 176,
    tickers: ['5347.KL'],
    sentiment: 'bullish',
    categories: ['corporate', 'equities'],
  },
  {
    sourceId: 'theedgemalaysia',
    title: 'Data-centre boom lifts construction and utilities counters',
    summary:
      'Analysts flagged a multi-year capex cycle, with contractors and power providers among the clearest beneficiaries.',
    minutesAgo: 145,
    tickers: ['5347.KL', '6033.KL'],
    sentiment: 'bullish',
    categories: ['corporate', 'equities'],
  },
  {
    sourceId: 'bursa',
    title: 'Bursa Malaysia: New listings pipeline stays active into year-end',
    summary:
      'The exchange reported a healthy queue of initial public offerings, led by consumer and industrial issuers.',
    minutesAgo: 260,
    tickers: ['5225.KL', '5296.KL'],
    sentiment: 'neutral',
    categories: ['corporate'],
  },
]

/** 基准新闻（高仿真兜底，23 条），按时间降序 */
export function baselineNews(now = Date.now()): NewsArticle[] {
  return BASELINE_SEEDS.map((seed, index) => {
    const meta = sourceMeta(seed.sourceId)
    const article: NewsArticle = {
      id: `baseline-${seed.sourceId}-${index}`,
      title: seed.title,
      summary: seed.summary,
      sourceId: seed.sourceId,
      sourceName: meta.name,
      url: '#',
      publishedAt: new Date(now - seed.minutesAgo * 60_000).toISOString(),
      region: meta.region,
      lang: meta.lang,
      tickers: seed.tickers,
      sentiment: seed.sentiment,
      categories: seed.categories,
      origin: 'baseline',
      translation: meta.lang === 'zh' ? 'done' : 'none',
    }
    if (seed.sentimentScore !== undefined) article.sentimentScore = seed.sentimentScore
    return article
  }).sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
}

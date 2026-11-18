/**
 * APEX Terminal — 后台新闻源清单（服务端镜像）。
 *
 * 与前端 `src/lib/news.ts` 的 NEWS_SOURCES 保持一致，但不依赖浏览器 DOMParser。
 */

import type { NewsCategory, NewsRegion, NewsSourceId } from './types.js'
import type { ServerKeys } from './env.js'

export interface ServerSourceMeta {
  id: NewsSourceId
  name: string
  region: NewsRegion
  lang: 'en' | 'zh'
  kind: 'rss' | 'api'
  feedUrl?: string
  categories: NewsCategory[]
  accent: 'gold' | 'ice' | 'iris' | 'bull' | 'bear' | 'neutral'
}

export const SERVER_SOURCES: ServerSourceMeta[] = [
  {
    id: 'wsj',
    name: 'WSJ Markets',
    region: 'global',
    lang: 'en',
    kind: 'rss',
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
    categories: ['equities'],
    accent: 'iris',
  },
  {
    id: 'finnhub',
    name: 'Finnhub News',
    region: 'global',
    lang: 'en',
    kind: 'api',
    categories: ['equities', 'corporate'],
    accent: 'bull',
  },
  {
    id: 'alphavantage',
    name: 'Alpha Vantage Sentiment',
    region: 'global',
    lang: 'en',
    kind: 'api',
    categories: ['equities', 'macro'],
    accent: 'neutral',
  },
  {
    id: 'gdelt',
    name: 'GDELT Global',
    region: 'global',
    lang: 'en',
    kind: 'api',
    categories: ['macro'],
    accent: 'neutral',
  },
  {
    id: 'bernama',
    name: 'BERNAMA Business',
    region: 'malaysia',
    lang: 'en',
    kind: 'rss',
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
    categories: ['corporate'],
    accent: 'ice',
  },
]

const SOURCE_MAP = new Map(SERVER_SOURCES.map((meta) => [meta.id, meta]))

export function serverSourceMeta(id: NewsSourceId): ServerSourceMeta {
  const meta = SOURCE_MAP.get(id)
  if (!meta) throw new Error(`未知新闻源: ${id}`)
  return meta
}

/** 部分 RSS 源的次级 / 备用地址 */
export const SECONDARY_FEEDS: Partial<Record<NewsSourceId, string[]>> = {
  bernama: ['https://www.bernama.com/en/rss/business.xml'],
  theedgemalaysia: ['https://www.theedgemarkets.com/rss.xml'],
  cnbc: ['https://www.cnbc.com/id/10000664/device/rss/rss.html'],
}

/** 该源是否需要（以及使用哪一把）Key */
export function sourceKey(id: NewsSourceId, keys: ServerKeys): string {
  switch (id) {
    case 'finnhub':
      return keys.finnhub
    case 'alphavantage':
      return keys.alphavantage
    default:
      return ''
  }
}

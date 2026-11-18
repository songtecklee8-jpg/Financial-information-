import type { VercelRequest, VercelResponse } from '@vercel/node'

import { buildNewsDetail } from '../_lib/ai.js'
import { loadKeys } from '../_lib/env.js'
import { extractArticle } from '../_lib/extract.js'
import { STORE_KEYS, TTL, readJson, writeJson } from '../_lib/store.js'
import type { NewsDetail, NewsSourceId, ServerArticle } from '../_lib/types.js'

/**
 * POST / GET /api/news/detail
 *
 * 点开新闻即看「AI 深度 Summary + 完整新闻全文」：
 * 1. 用 @mozilla/readability + linkedom 抓取并清洗原新闻正文
 * 2. 调用 Gemini 生成 3–5 条华文核心摘要要点 + 五大资产涨跌概率推演
 * 3. 生成全文整篇华文翻译
 * 4. 结果整体写入 Upstash Redis，下次点击秒开且不重复消耗 API 额度
 */

const VALID_SOURCES = new Set<NewsSourceId>([
  'wsj',
  'wallstreetcn',
  'cnbc',
  'yahoo',
  'finnhub',
  'alphavantage',
  'gdelt',
  'bernama',
  'thestar',
  'nst',
  'theedgemalaysia',
  'bursa',
])

function hashId(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) hash = (hash * 31 + input.charCodeAt(i)) | 0
  return Math.abs(hash).toString(36)
}

function str(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return str(value[0])
  return String(value).trim()
}

function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return !(
      host === 'localhost' ||
      host.endsWith('.local') ||
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
      host === '[::1]'
    )
  } catch {
    return false
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const pick = (key: string): string => str(req.query[key]) || str(body[key])

  const url = pick('url')
  const title = pick('title')
  const id = pick('id') || `cloud-${hashId(`${url}|${title}`)}`
  const refresh = pick('refresh') === '1'

  if (!url && !title) {
    res.status(400).json({ ok: false, error: '缺少 url 或 title 参数' })
    return
  }

  // 命中云端缓存：秒开，不再消耗 API 额度
  if (!refresh) {
    const cached = await readJson<NewsDetail>(STORE_KEYS.newsDetail(id))
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
      res.status(200).json({ ok: true, cached: true, detail: cached })
      return
    }
  }

  const rawSource = pick('sourceId')
  const sourceId: NewsSourceId = VALID_SOURCES.has(rawSource as NewsSourceId)
    ? (rawSource as NewsSourceId)
    : 'cnbc'

  const article: ServerArticle = {
    id,
    title: title || url,
    summary: pick('summary') || title,
    sourceId,
    sourceName: pick('sourceName') || 'News',
    url,
    publishedAt: pick('publishedAt') || new Date().toISOString(),
    region: pick('region') === 'malaysia' ? 'malaysia' : 'global',
    lang: pick('lang') === 'zh' ? 'zh' : 'en',
    tickers: pick('tickers')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    sentiment: 'neutral',
    categories: [],
    origin: 'live',
    translation: 'none',
  }

  const keys = loadKeys()

  // 1) 抓取正文并清洗（失败则回落到 RSS 导语）
  const extracted = isSafeUrl(url) ? await extractArticle(url) : { text: '', mode: 'unavailable' as const }
  const fullText = extracted.text || article.summary

  // 2) AI 摘要要点 + 五大资产推演 + 全文翻译
  let detail: NewsDetail
  try {
    detail = await buildNewsDetail({ article, fullText, apiKey: keys.gemini })
  } catch (error) {
    res.status(200).json({
      ok: false,
      error: `AI 推演失败：${error instanceof Error ? error.message : String(error)}`,
      detail: {
        id,
        url,
        title: article.title,
        sourceName: article.sourceName,
        publishedAt: article.publishedAt,
        summaryPoints: [],
        fullText,
        fullTextZh: '',
        impact: null,
        model: 'unavailable',
        extraction: extracted.mode,
        cachedAt: new Date().toISOString(),
      },
    })
    return
  }

  detail.extraction = extracted.mode === 'unavailable' && !extracted.text ? 'unavailable' : extracted.mode

  // 3) 缓存结果（全文抓取 + 全篇翻译 + AI 推演）
  await writeJson(STORE_KEYS.newsDetail(id), detail, TTL.detail)

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
  res.status(200).json({ ok: true, cached: false, detail })
}

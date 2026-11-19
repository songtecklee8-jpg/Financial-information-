import type { VercelRequest, VercelResponse } from '@vercel/node'

import { enrichArticles } from '../_lib/ai.js'
import { fetchBondsTracker } from '../_lib/bonds.js'
import { fetchEarningsCalendar } from '../_lib/earnings.js'
import { loadKeys, loadWatchlist } from '../_lib/env.js'
import { dedupeArticles, fetchAllNews } from '../_lib/news.js'
import { fetchQuotes } from '../_lib/quotes.js'
import {
  STORE_KEYS,
  TTL,
  readJson,
  saveGlobalNewsFeed,
  usingUpstash,
  writeJson,
} from '../_lib/store.js'
import type { NewsItem, NewsPayload, QuotesPayload, ServerArticle, SyncMeta } from '../_lib/types.js'

/**
 * POST / GET /api/cron/sync
 *
 * 后台 24 小时静默同步入口（Vercel Cron 与外部 cron-job.org 共用）：
 * 1. 多引擎拉取自选池美股 / 马股 .KL / 加密资产最新行情
 * 2. `Promise.allSettled` 并发抓取 Finnhub / NewsData.io / Bursa / BERNAMA / Yahoo Finance 等全部新闻源
 * 3. URL + 标题相似度智能去重，对新入库英文新闻用 `gemini-2.5-flash-lite` 批量翻译标题、生成摘要与多空标签
 * 4. 标准化新闻写入 Upstash Redis Sorted Set (`news:global_feed`) 保留最新 200 条（未配置 Redis 时自动降级本地缓存）
 *
 * 安全：配置了 `CRON_SECRET` 后，支持：
 * - 请求头 `Authorization: Bearer <CRON_SECRET>` 或 `x-cron-secret: <CRON_SECRET>`
 * - URL 查询参数 `?secret=<CRON_SECRET>` 或 `?key=<CRON_SECRET>`
 */

const MAX_ENRICH_PER_RUN = 40
const MAX_NEWS_STORED = 200

function extractSecret(req: VercelRequest): string {
  const header = req.headers['authorization'] ?? ''
  const bearer = Array.isArray(header) ? header[0] : header
  if (bearer && bearer.toLowerCase().startsWith('bearer ')) return bearer.slice(7).trim()
  const custom = req.headers['x-cron-secret']
  const customValue = Array.isArray(custom) ? custom[0] : custom
  if (customValue) return customValue.trim()
  const secretParam = req.query.secret
  if (typeof secretParam === 'string' && secretParam.trim()) return secretParam.trim()
  const query = req.query.key
  if (typeof query === 'string' && query.trim()) return query.trim()
  return ''
}

function authorize(req: VercelRequest, secret: string): boolean {
  if (!secret) return true
  return extractSecret(req) === secret
}

function toStandardNewsItem(article: ServerArticle): NewsItem {
  return {
    id: article.id,
    title: article.title,
    ...(article.titleZh ? { translatedTitle: article.titleZh } : {}),
    summary: article.summaryZh || article.summary,
    url: article.url,
    source: article.sourceName,
    publishedAt: article.publishedAt,
    sentiment: article.sentiment,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const started = Date.now()
  const keys = loadKeys()

  if (!authorize(req, keys.cronSecret)) {
    res.status(401).json({ ok: false, success: false, error: 'unauthorized：CRON_SECRET 校验失败' })
    return
  }

  const errors: string[] = []
  const trigger: SyncMeta['trigger'] = req.headers['x-vercel-cron'] ? 'cron' : 'external'

  // ------------------------------------------------------------------ 行情
  let quotes: Record<string, QuotesPayload['quotes'][string]> = {}
  try {
    quotes = await fetchQuotes(loadWatchlist(), keys)
  } catch (error) {
    errors.push(`行情同步失败：${error instanceof Error ? error.message : String(error)}`)
  }
  const quotesPayload: QuotesPayload = {
    quotes,
    updatedAt: new Date().toISOString(),
    liveCount: Object.keys(quotes).length,
  }

  // ------------------------------------------------------------------ 新闻
  let newsTotal = 0
  let newsTranslated = 0
  let addedCount = 0
  let newsModel: string | undefined
  try {
    const fetched = await fetchAllNews(keys, MAX_NEWS_STORED)
    const existing = await readJson<NewsPayload>(STORE_KEYS.news)
    const knownIds = new Set((existing?.articles ?? []).map((item) => item.id))

    const fresh = fetched.filter((item) => !knownIds.has(item.id))
    addedCount = fresh.length

    const pending = fresh.filter((item) => item.lang === 'en').slice(0, MAX_ENRICH_PER_RUN)
    const enriched = await enrichArticles(pending, keys.gemini)
    newsModel = enriched.model ?? existing?.model

    // 合并并按 URL + 标题相似度智能去重，保留最新 200 条
    const merged = dedupeArticles([...fetched, ...(existing?.articles ?? [])], MAX_NEWS_STORED)

    const nowIso = new Date().toISOString()
    const newsPayload: NewsPayload = {
      articles: merged,
      updatedAt: nowIso,
      model: newsModel,
      translatedCount: merged.filter((item) => item.translation === 'done').length,
    }
    newsTotal = merged.length
    newsTranslated = newsPayload.translatedCount

    await Promise.all([
      writeJson(STORE_KEYS.news, newsPayload, TTL.news),
      saveGlobalNewsFeed(merged.map(toStandardNewsItem)),
    ])
  } catch (error) {
    errors.push(`新闻同步失败：${error instanceof Error ? error.message : String(error)}`)
  }

  // ------------------------------------------------------------------ 财报日历与国债
  try {
    const earningsPayload = await fetchEarningsCalendar({
      finnhubKey: keys.finnhub,
      fmpKey: keys.fmp,
      geminiKey: keys.gemini,
      aiRouting: 'auto',
    })
    await writeJson(STORE_KEYS.earnings, earningsPayload, TTL.earnings)
  } catch (error) {
    errors.push(`财报日历同步失败：${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const bondsPayload = await fetchBondsTracker({
      geminiKey: keys.gemini,
      aiRouting: 'auto',
    })
    await writeJson(STORE_KEYS.bonds, bondsPayload, TTL.bonds)
  } catch (error) {
    errors.push(`国债日历同步失败：${error instanceof Error ? error.message : String(error)}`)
  }

  // ------------------------------------------------------------------ 落库
  await writeJson(STORE_KEYS.quotes, quotesPayload, TTL.quotes)

  const timestamp = new Date().toISOString()
  const meta: SyncMeta = {
    lastSyncAt: timestamp,
    lastSyncDurationMs: Date.now() - started,
    trigger,
    quotes: { total: Object.keys(quotes).length, live: quotesPayload.liveCount },
    news: { total: newsTotal, translated: newsTranslated },
    errors,
    usingUpstash: usingUpstash(),
  }
  await writeJson(STORE_KEYS.syncMeta, meta, TTL.news)

  res.status(200).json({
    ok: true,
    success: true,
    addedCount,
    totalStored: newsTotal,
    timestamp,
    ...meta,
  })
}

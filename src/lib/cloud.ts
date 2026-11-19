import type {
  AiFallbackConfig,
  ApiSettings,
  BondAuctionAnalysis,
  BondAuctionItem,
  BondMarketBenchmark,
  BondsPayload,
  BursaAnnouncement,
  BursaEarningsDetail,
  CloudSnapshotResponse,
  EarningsPayload,
  NewsArticle,
  NewsDetail,
} from '@/types'

/**
 * APEX Terminal — 云端后台客户端。
 *
 * 部署到 Vercel 后，前端首屏直接读取 `/api/snapshot`（后台已准备好的最新行情 +
 * 新闻），实现毫秒级秒开；当 `/api/*` 不可用（例如仍托管在 GitHub Pages 纯静态环境）
 * 时静默降级为浏览器端直连模式，保证体验永不中断。
 */

const API_BASE = '/api'
const SNAPSHOT_TTL_MS = 60_000
const FAILURE_COOLDOWN_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 8_000

let cachedSnapshot: { value: CloudSnapshotResponse; at: number } | null = null
let inflight: Promise<CloudSnapshotResponse | null> | null = null
let unavailableUntil = 0

const detailCache = new Map<string, NewsDetail>()

/** 云端是否可用（最近一次快照请求是否成功） */
export function isCloudEnabled(): boolean {
  return cachedSnapshot !== null
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return null
    return (await response.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 读取云端行情 + 新闻快照（带 60s 内存缓存与失败冷却，避免反复打空请求） */
export async function getCloudSnapshot(force = false): Promise<CloudSnapshotResponse | null> {
  const now = Date.now()
  if (!force && cachedSnapshot && now - cachedSnapshot.at < SNAPSHOT_TTL_MS) {
    return cachedSnapshot.value
  }
  if (!force && now < unavailableUntil) return null
  if (inflight) return inflight

  inflight = requestJson<CloudSnapshotResponse>('/snapshot')
    .then((value) => {
      if (!value || !value.ready) {
        unavailableUntil = Date.now() + FAILURE_COOLDOWN_MS
        return null
      }
      cachedSnapshot = { value, at: Date.now() }
      return value
    })
    .catch(() => {
      unavailableUntil = Date.now() + FAILURE_COOLDOWN_MS
      return null
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** 从云端快照中取出新闻列表（无云端时返回 null） */
export async function getCloudNews(
  force = false,
): Promise<{ articles: NewsArticle[]; updatedAt: string; model?: string } | null> {
  const snapshot = await getCloudSnapshot(force)
  if (!snapshot?.news || snapshot.news.articles.length === 0) return null
  return {
    articles: snapshot.news.articles,
    updatedAt: snapshot.news.updatedAt,
    model: snapshot.news.model,
  }
}

/** 从云端快照中取出行情（无云端时返回 null） */
export async function getCloudQuotes(): Promise<CloudSnapshotResponse['quotes']> {
  const snapshot = await getCloudSnapshot()
  return snapshot?.quotes ?? null
}

/** 让指定标的优先使用云端快照价格：返回 symbol → 价格映射 */
export function pickCloudPrices(
  quotes: NonNullable<CloudSnapshotResponse['quotes']> | null,
  symbols: string[],
): Record<string, number> {
  const out: Record<string, number> = {}
  if (!quotes) return out
  for (const symbol of symbols) {
    const hit = quotes.quotes[symbol]
    if (hit && hit.price > 0) out[symbol] = hit.price
  }
  return out
}

// ---------------------------------------------------------------------------
// 单篇新闻详情（全文 + AI 摘要 + 推演）
// ---------------------------------------------------------------------------

export interface NewsDetailRequest {
  id: string
  url: string
  title: string
  summary: string
  sourceId: string
  sourceName: string
  publishedAt: string
  region: 'global' | 'malaysia'
  lang: 'en' | 'zh'
  tickers: string[]
  refresh?: boolean
  aiRouting?: string
  geminiModel?: string
  geminiKey?: string
  aiFallback?: AiFallbackConfig
}

/** 请求云端新闻详情接口；失败返回 null（由调用方回落本地推演） */
export async function fetchNewsDetail(req: NewsDetailRequest): Promise<NewsDetail | null> {
  if (!req.refresh) {
    const hit = detailCache.get(req.id)
    if (hit) return hit
  }
  const snapshotKnown = cachedSnapshot !== null
  const now = Date.now()
  if (!snapshotKnown && now < unavailableUntil) return null

  const payload = await requestJson<{ ok: boolean; detail?: NewsDetail }>('/news/detail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: req.id,
      url: req.url === '#' ? '' : req.url,
      title: req.title,
      summary: req.summary,
      sourceId: req.sourceId,
      sourceName: req.sourceName,
      publishedAt: req.publishedAt,
      region: req.region,
      lang: req.lang,
      tickers: req.tickers.join(','),
      refresh: req.refresh ? '1' : '',
      aiRouting: req.aiRouting ?? '',
      geminiModel: req.geminiModel ?? '',
      geminiKey: req.geminiKey ?? '',
      aiFallback: req.aiFallback,
    }),
  })

  if (!payload || !payload.detail) {
    unavailableUntil = Date.now() + FAILURE_COOLDOWN_MS
    return null
  }
  detailCache.set(req.id, payload.detail)
  return payload.detail
}

// ---------------------------------------------------------------------------
// 财报日历 & 马来西亚政府债券（MGS / MGII）
// ---------------------------------------------------------------------------

const AI_ENDPOINT_TIMEOUT_MS = 25_000

async function postApiJson<T>(path: string, body: Record<string, unknown>, timeoutMs = AI_ENDPOINT_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return null
    return (await response.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchEarningsCalendar(
  settings: ApiSettings,
  refresh = false,
): Promise<EarningsPayload | null> {
  const res = await postApiJson<{ ok: boolean; payload?: EarningsPayload }>(
    '/earnings',
    {
      finnhubKey: settings.providers.finnhub.apiKey,
      fmpKey: settings.providers.fmp.apiKey,
      geminiKey: settings.geminiKey,
      aiRouting: settings.aiRouting,
      geminiModel: settings.geminiModel,
      aiFallback: settings.aiFallback,
      refresh,
    },
    18_000,
  )
  return res?.payload ?? null
}

export async function fetchBursaEarningsDetail(
  announcement: BursaAnnouncement,
  settings: ApiSettings,
  refresh = false,
): Promise<BursaEarningsDetail | null> {
  const res = await postApiJson<{ ok: boolean; detail?: BursaEarningsDetail }>(
    '/earnings/detail',
    {
      announcement,
      geminiKey: settings.geminiKey,
      aiRouting: settings.aiRouting,
      geminiModel: settings.geminiModel,
      aiFallback: settings.aiFallback,
      refresh,
    },
    AI_ENDPOINT_TIMEOUT_MS,
  )
  return res?.detail ?? null
}

export async function fetchBondsTracker(
  settings: ApiSettings,
  refresh = false,
): Promise<BondsPayload | null> {
  const res = await postApiJson<{ ok: boolean; payload?: BondsPayload }>(
    '/bonds',
    {
      geminiKey: settings.geminiKey,
      aiRouting: settings.aiRouting,
      geminiModel: settings.geminiModel,
      aiFallback: settings.aiFallback,
      refresh,
    },
    18_000,
  )
  return res?.payload ?? null
}

export async function analyzeBondAuctions(
  benchmarks: BondMarketBenchmark,
  auctions: BondAuctionItem[],
  settings: ApiSettings,
): Promise<BondAuctionAnalysis | null> {
  const res = await postApiJson<{ ok: boolean; analysis?: BondAuctionAnalysis }>(
    '/bonds/analyze',
    {
      benchmarks,
      auctions,
      geminiKey: settings.geminiKey,
      aiRouting: settings.aiRouting,
      geminiModel: settings.geminiModel,
      aiFallback: settings.aiFallback,
    },
    AI_ENDPOINT_TIMEOUT_MS,
  )
  return res?.analysis ?? null
}


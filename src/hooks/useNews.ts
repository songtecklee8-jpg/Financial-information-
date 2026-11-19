import { useCallback, useEffect, useState } from 'react'

import type { ApiSettings, CloudSyncMeta, NewsArticle } from '@/types'
import { getCloudNews, getCloudSnapshot } from '@/lib/cloud'
import { baselineNews, loadLiveNews } from '@/lib/news'

export type NewsStatus = 'loading' | 'cloud' | 'live' | 'baseline'

export interface NewsController {
  articles: NewsArticle[]
  status: NewsStatus
  lastUpdated: string | null
  /** 云端后台最近一次同步元信息（云端不可用时为 null） */
  cloudMeta: CloudSyncMeta | null
  /** 云端预翻译命中的模型 id */
  cloudModel: string | null
  refresh: () => void
}

/** 自动刷新间隔：3 分钟 */
const AUTO_REFRESH_MS = 180_000

/**
 * 「全球与马股实时财经新闻中心」数据编排。
 *
 * 优先读取云端后台（/api/cron/sync 定时写入 Redis）已准备好的新闻快照，实现首屏毫秒级秒开；
 * 云端不可用时回落到浏览器端直连模式；全部失败再用内置基准新闻兜底。
 */
export function useNews(settings: ApiSettings, symbol: string): NewsController {
  const [articles, setArticles] = useState<NewsArticle[]>(() => baselineNews())
  const [status, setStatus] = useState<NewsStatus>('loading')
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [cloudMeta, setCloudMeta] = useState<CloudSyncMeta | null>(null)
  const [cloudModel, setCloudModel] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    setStatus('loading')

    ;(async () => {
      // 1) 云端后台优先：毫秒级读取已准备好的最新数据
      const cloud = await getCloudNews(refreshToken > 0)
      if (!alive) return
      if (cloud && cloud.articles.length >= 5) {
        setArticles(cloud.articles)
        setStatus('cloud')
        setLastUpdated(cloud.updatedAt)
        setCloudModel(cloud.model ?? null)
        const snapshot = await getCloudSnapshot()
        if (alive) setCloudMeta(snapshot?.meta ?? null)
        return
      }
      setCloudModel(null)

      // 2) 回落到浏览器端直连
      try {
        const live = await loadLiveNews(settings, { symbol, signal: controller.signal })
        if (!alive) return
        if (live.length >= 5) {
          setArticles(live)
          setStatus('live')
        } else {
          setArticles(baselineNews())
          setStatus('baseline')
        }
        setLastUpdated(new Date().toISOString())
      } catch {
        if (!alive) return
        setArticles(baselineNews())
        setStatus('baseline')
        setLastUpdated(new Date().toISOString())
      }
    })()

    return () => {
      alive = false
      controller.abort()
    }
  }, [settings, symbol, refreshToken])

  // 定期自动刷新
  useEffect(() => {
    const timer = window.setInterval(() => setRefreshToken((value) => value + 1), AUTO_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), [])

  return { articles, status, lastUpdated, cloudMeta, cloudModel, refresh }
}

import { useCallback, useEffect, useState } from 'react'

import type { ApiSettings, NewsArticle } from '@/types'
import { baselineNews, loadLiveNews } from '@/lib/news'

export type NewsStatus = 'loading' | 'live' | 'baseline'

export interface NewsController {
  articles: NewsArticle[]
  status: NewsStatus
  lastUpdated: string | null
  refresh: () => void
}

/** 自动刷新间隔：3 分钟 */
const AUTO_REFRESH_MS = 180_000

/**
 * 「全球与马股实时财经新闻中心」数据编排。
 * 打开页面即自动拉取最新资讯；任一源失败都会被静默忽略，并用基准新闻兜底。
 */
export function useNews(settings: ApiSettings, symbol: string): NewsController {
  const [articles, setArticles] = useState<NewsArticle[]>(() => baselineNews())
  const [status, setStatus] = useState<NewsStatus>('loading')
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    setStatus('loading')
    loadLiveNews(settings, { symbol, signal: controller.signal })
      .then((live) => {
        if (!alive) return
        if (live.length >= 5) {
          setArticles(live)
          setStatus('live')
        } else {
          setArticles(baselineNews())
          setStatus('baseline')
        }
        setLastUpdated(new Date().toISOString())
      })
      .catch(() => {
        if (!alive) return
        setArticles(baselineNews())
        setStatus('baseline')
        setLastUpdated(new Date().toISOString())
      })
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

  return { articles, status, lastUpdated, refresh }
}

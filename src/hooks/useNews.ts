import { useEffect, useState } from 'react'

import type { NewsItem } from '@/types'
import { baselineNews, loadLiveNews } from '@/lib/news'

export type NewsStatus = 'baseline' | 'loading' | 'live'

export interface NewsController {
  items: NewsItem[]
  status: NewsStatus
}

export function useNews(): NewsController {
  const [items, setItems] = useState<NewsItem[]>(() => baselineNews())
  const [status, setStatus] = useState<NewsStatus>('loading')

  useEffect(() => {
    let alive = true
    setStatus('loading')
    loadLiveNews()
      .then((live) => {
        if (!alive) return
        if (live.length >= 5) {
          setItems(live)
          setStatus('live')
        } else {
          setItems(baselineNews())
          setStatus('baseline')
        }
      })
      .catch(() => {
        if (!alive) return
        setItems(baselineNews())
        setStatus('baseline')
      })
    return () => {
      alive = false
    }
  }, [])

  return { items, status }
}

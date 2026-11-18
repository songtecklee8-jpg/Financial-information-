import { useCallback, useEffect, useState } from 'react'

import type { DataOrigin, Fundamentals, Quote, Security } from '@/types'
import {
  baselineFundamentals,
  baselineQuote,
  normalizeSymbol,
  resolveSecurity,
} from '@/lib/universe'
import { fetchLiveSnapshot, hasTwelveDataKey } from '@/lib/twelveData'

interface SnapshotState {
  security: Security
  quote: Quote
  fundamentals: Fundamentals
}

function buildBaselineState(symbol: string): SnapshotState {
  const normalized = normalizeSymbol(symbol)
  return {
    security: resolveSecurity(normalized),
    quote: baselineQuote(normalized),
    fundamentals: baselineFundamentals(normalized),
  }
}

/** 基准模式下用微小随机游走模拟报价跳动，让终端保持"活着"的手感 */
function tickQuote(quote: Quote): Quote {
  const price = Math.max(0.0001, quote.price + (Math.random() - 0.5) * quote.price * 0.0016)
  const change = price - quote.previousClose
  return {
    ...quote,
    price,
    change,
    changePercent: quote.previousClose ? (change / quote.previousClose) * 100 : 0,
    dayHigh: Math.max(quote.dayHigh, price),
    dayLow: Math.min(quote.dayLow, price),
    spark: [...quote.spark.slice(1), price],
    updatedAt: new Date().toISOString(),
  }
}

export interface SecuritySnapshot extends SnapshotState {
  origin: DataOrigin
  loading: boolean
  error: string | null
  /** 实际命中的 Twelve Data 接口 */
  endpoints: string[]
  refresh: () => void
}

export function useSecuritySnapshot(rawSymbol: string, apiKey: string): SecuritySnapshot {
  const symbol = normalizeSymbol(rawSymbol)
  const [state, setState] = useState<SnapshotState>(() => buildBaselineState(symbol))
  const [origin, setOrigin] = useState<DataOrigin>('baseline')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [endpoints, setEndpoints] = useState<string[]>([])
  const [refreshToken, setRefreshToken] = useState(0)

  // 切换标的：立刻用基准数据填充，避免出现空窗
  useEffect(() => {
    setState(buildBaselineState(symbol))
    setOrigin('baseline')
    setError(null)
    setEndpoints([])
  }, [symbol])

  // 实时拉取（仅在配置了 Key 时）
  useEffect(() => {
    if (!hasTwelveDataKey(apiKey)) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    fetchLiveSnapshot(symbol, apiKey, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) return
        setState({
          security: snapshot.security,
          quote: snapshot.quote,
          fundamentals: snapshot.fundamentals,
        })
        setOrigin('live')
        setEndpoints(snapshot.endpoints)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : '实时数据拉取失败，已回退基准数据')
        setOrigin('baseline')
        setEndpoints([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [symbol, apiKey, refreshToken])

  // 基准模式下的报价心跳
  useEffect(() => {
    if (origin !== 'baseline') return
    const timer = window.setInterval(() => {
      setState((prev) => ({ ...prev, quote: tickQuote(prev.quote) }))
    }, 3200)
    return () => window.clearInterval(timer)
  }, [origin])

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), [])

  return { ...state, origin, loading, error, endpoints, refresh }
}

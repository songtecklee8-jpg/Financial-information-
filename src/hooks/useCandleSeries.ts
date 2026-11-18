import { useCallback, useEffect, useState } from 'react'

import type { ApiSettings, CandleSeries, IntervalKey, ProviderId, RangeKey } from '@/types'
import { configuredProviderCount, fetchCandles } from '@/lib/market/failover'
import { syntheticCandles } from '@/lib/market/baseline'
import { normalizeSymbol } from '@/lib/universe'

export interface CandleController {
  series: CandleSeries | null
  loading: boolean
  error: string | null
  provider: ProviderId | null
  /** 实际请求的源周期（可能比目标更细，由聚合得到） */
  sourceInterval: IntervalKey | null
  factor: number
  refresh: () => void
}

interface SeriesState {
  series: CandleSeries
  provider: ProviderId | null
  sourceInterval: IntervalKey
  factor: number
}

/** 全周期 K 线数据编排：优先多引擎故障转移，全部失败时回落高仿真合成序列 */
export function useCandleSeries(
  rawSymbol: string,
  range: RangeKey,
  interval: IntervalKey,
  settings: ApiSettings,
): CandleController {
  const symbol = normalizeSymbol(rawSymbol)
  const hasProviders = configuredProviderCount(settings) > 0

  const [state, setState] = useState<SeriesState>(() => ({
    series: {
      symbol,
      interval,
      candles: syntheticCandles(symbol, range, interval),
      origin: 'baseline',
      provider: null,
      fetchedAt: new Date().toISOString(),
    },
    provider: null,
    sourceInterval: interval,
    factor: 1,
  }))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const fallback = (): SeriesState => ({
      series: {
        symbol,
        interval,
        candles: syntheticCandles(symbol, range, interval),
        origin: 'baseline',
        provider: null,
        fetchedAt: new Date().toISOString(),
      },
      provider: null,
      sourceInterval: interval,
      factor: 1,
    })

    if (!hasProviders) {
      setState(fallback())
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    fetchCandles(symbol, range, interval, settings, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (result.candles.length === 0) throw new Error('该引擎未返回 K 线数据')
        setState({
          series: {
            symbol,
            interval,
            candles: result.candles,
            origin: 'live',
            provider: result.provider,
            fetchedAt: new Date().toISOString(),
          },
          provider: result.provider,
          sourceInterval: result.sourceInterval,
          factor: result.factor,
        })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setState(fallback())
        setError(cause instanceof Error ? cause.message : 'K 线拉取失败，已回退合成序列')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [symbol, range, interval, settings, hasProviders, refreshToken])

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), [])

  return {
    series: state.series,
    loading,
    error,
    provider: state.provider,
    sourceInterval: state.sourceInterval,
    factor: state.factor,
    refresh,
  }
}

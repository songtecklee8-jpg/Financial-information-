import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  ApiSettings,
  DataOrigin,
  Fundamentals,
  ProviderId,
  Quote,
  QuoteSnapshot,
  Security,
} from '@/types'
import {
  baselineFundamentals,
  baselineQuote,
  normalizeSymbol,
  resolveSecurity,
} from '@/lib/universe'
import { configuredProviderCount, fetchFundamentals, fetchQuote } from '@/lib/market/failover'

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

/** 基准模式下用微小随机游走模拟报价跳动，让终端保持“活着”的手感 */
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

/** 把引擎返回的快照合并到基准报价之上，缺失字段沿用基准值 */
function mergeQuote(base: Quote, snap: QuoteSnapshot): Quote {
  const price = snap.price > 0 ? snap.price : base.price
  const previousClose = snap.previousClose > 0 ? snap.previousClose : base.previousClose
  const change = price - previousClose
  return {
    ...base,
    price,
    previousClose,
    change,
    changePercent: previousClose !== 0 ? (change / previousClose) * 100 : 0,
    open: snap.open ?? base.open,
    dayHigh: Math.max(snap.dayHigh ?? base.dayHigh, price),
    dayLow: Math.min(snap.dayLow ?? base.dayLow, price),
    volume: snap.volume ?? base.volume,
    fiftyTwoWeekHigh: snap.fiftyTwoWeekHigh ?? base.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: snap.fiftyTwoWeekLow ?? base.fiftyTwoWeekLow,
    marketCap: snap.marketCap ?? base.marketCap,
    currency: snap.currency ?? base.currency,
    updatedAt: snap.updatedAt ?? new Date().toISOString(),
    origin: 'live',
  }
}

export interface SecuritySnapshot extends SnapshotState {
  origin: DataOrigin
  loading: boolean
  error: string | null
  /** 最终命中并提供报价的引擎 */
  provider: ProviderId | null
  /** 本次故障转移实际尝试过的引擎顺序 */
  trail: ProviderId[]
  refresh: () => void
}

/** 实时报价心跳间隔（毫秒） */
const QUOTE_POLL_MS = 15_000

export function useSecuritySnapshot(rawSymbol: string, settings: ApiSettings): SecuritySnapshot {
  const symbol = normalizeSymbol(rawSymbol)
  const hasProviders = configuredProviderCount(settings) > 0

  const [state, setState] = useState<SnapshotState>(() => buildBaselineState(symbol))
  const [origin, setOrigin] = useState<DataOrigin>('baseline')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<ProviderId | null>(null)
  const [trail, setTrail] = useState<ProviderId[]>([])
  const [refreshToken, setRefreshToken] = useState(0)
  const silentRef = useRef(false)

  // 切换标的：立刻用基准数据填充，避免出现空窗
  useEffect(() => {
    setState(buildBaselineState(symbol))
    setOrigin('baseline')
    setError(null)
    setProvider(null)
    setTrail([])
  }, [symbol])

  // 实时拉取：多引擎故障转移（仅在配置了任意 Key 时）
  useEffect(() => {
    if (!hasProviders) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    if (!silentRef.current) setLoading(true)
    silentRef.current = false

    const base = buildBaselineState(symbol)
    fetchQuote(symbol, settings, controller.signal)
      .then(async (result) => {
        if (controller.signal.aborted) return
        const fundamentals = await fetchFundamentals(symbol, settings, controller.signal).catch(
          () => null,
        )
        if (controller.signal.aborted) return
        setState({
          security: base.security,
          quote: mergeQuote(base.quote, result.snapshot),
          fundamentals: fundamentals
            ? { ...base.fundamentals, ...fundamentals.patch }
            : base.fundamentals,
        })
        setOrigin('live')
        setProvider(result.provider)
        setTrail(result.trail)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : '实时数据拉取失败，已回退基准数据')
        setOrigin('baseline')
        setProvider(null)
        setTrail([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [symbol, settings, hasProviders, refreshToken])

  // 基准模式下的报价心跳
  useEffect(() => {
    if (origin !== 'baseline') return
    const timer = window.setInterval(() => {
      setState((prev) => ({ ...prev, quote: tickQuote(prev.quote) }))
    }, 3200)
    return () => window.clearInterval(timer)
  }, [origin])

  // 实时模式下的报价轮询，保持当前数据持续刷新
  useEffect(() => {
    if (!hasProviders || origin !== 'live') return
    const timer = window.setInterval(() => {
      silentRef.current = true
      setRefreshToken((value) => value + 1)
    }, QUOTE_POLL_MS)
    return () => window.clearInterval(timer)
  }, [hasProviders, origin])

  const refresh = useCallback(() => {
    silentRef.current = false
    setRefreshToken((value) => value + 1)
  }, [])

  return { ...state, origin, loading, error, provider, trail, refresh }
}

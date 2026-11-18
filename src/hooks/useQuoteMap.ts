import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ApiSettings, Currency, DataOrigin } from '@/types'
import { getCloudQuotes, getCloudSnapshot, pickCloudPrices } from '@/lib/cloud'
import { baselineQuote, normalizeSymbol, resolveSecurity } from '@/lib/universe'
import { configuredProviderCount, fetchQuote } from '@/lib/market/failover'

export interface QuoteMapController {
  /** 各标的以自身计价货币的实时价格 */
  prices: Record<string, number>
  /** 各标的计价货币 */
  currencies: Record<string, Currency>
  origin: DataOrigin
  loading: boolean
  refresh: () => void
}

/** 实时轮询间隔 */
const POLL_MS = 12_000
/** 基准模式心跳间隔 */
const BASELINE_TICK_MS = 3200

function sameMap(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((key) => a[key] === b[key])
}

/**
 * 批量实时报价：为模拟交易的持仓、挂单与下单票据提供多引擎行情。
 * 复用与第一页相同的故障转移链路，全部失败时回退基准数据。
 */
export function useQuoteMap(symbols: string[], settings: ApiSettings): QuoteMapController {
  const key = useMemo(
    () => [...new Set(symbols.map((s) => normalizeSymbol(s)))].filter(Boolean).sort().join('|'),
    [symbols],
  )
  const list = useMemo(() => (key ? key.split('|') : []), [key])

  const hasProviders = configuredProviderCount(settings) > 0
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [currencies, setCurrencies] = useState<Record<string, Currency>>({})
  const [origin, setOrigin] = useState<DataOrigin>('baseline')
  const [loading, setLoading] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    if (list.length === 0) {
      setPrices((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      setCurrencies((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      setOrigin('baseline')
      setLoading(false)
      return
    }

    const controller = new AbortController()
    const basePrices: Record<string, number> = {}
    const baseCurrencies: Record<string, Currency> = {}
    for (const sym of list) {
      basePrices[sym] = baselineQuote(sym).price
      baseCurrencies[sym] = resolveSecurity(sym).currency
    }

    if (!hasProviders) {
      setPrices((prev) => (sameMap(prev, basePrices) ? prev : basePrices))
      setCurrencies(baseCurrencies)
      setOrigin('baseline')
      setLoading(false)
      return () => controller.abort()
    }

    setLoading(true)
    ;(async () => {
      const results = await Promise.all(
        list.map(async (sym) => {
          try {
            const res = await fetchQuote(sym, settings, controller.signal)
            return { sym, price: res.snapshot.price, currency: res.snapshot.currency }
          } catch {
            return { sym, price: Number.NaN, currency: undefined as Currency | undefined }
          }
        }),
      )
      if (controller.signal.aborted) return
      const nextPrices = { ...basePrices }
      const nextCurrencies = { ...baseCurrencies }
      let liveCount = 0
      for (const r of results) {
        if (Number.isFinite(r.price) && r.price > 0) {
          nextPrices[r.sym] = r.price
          liveCount += 1
        }
        if (r.currency) nextCurrencies[r.sym] = r.currency
      }
      setPrices((prev) => (sameMap(prev, nextPrices) ? prev : nextPrices))
      setCurrencies(nextCurrencies)
      setOrigin(liveCount > 0 ? 'live' : 'baseline')
    })()
      .catch(() => {
        if (controller.signal.aborted) return
        setOrigin('baseline')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [key, hasProviders, settings, refreshToken, list])

  // 云端后台快照优先：首屏毫秒级拿到后台已准备好的最新价格
  useEffect(() => {
    if (list.length === 0) return
    let alive = true

    const apply = async (force: boolean) => {
      const cloud = force
        ? (await getCloudSnapshot(true))?.quotes ?? null
        : await getCloudQuotes()
      if (!alive || !cloud) return
      const seed = pickCloudPrices(cloud, list)
      if (Object.keys(seed).length === 0) return
      const seedCurrencies: Record<string, Currency> = {}
      for (const sym of list) {
        const hit = cloud.quotes[sym]
        if (hit) seedCurrencies[sym] = hit.currency
      }
      setPrices((prev) => {
        const next = { ...prev, ...seed }
        return sameMap(prev, next) ? prev : next
      })
      setCurrencies((prev) => ({ ...prev, ...seedCurrencies }))
      setOrigin('live')
    }

    void apply(false)

    // 未配置行情引擎时，靠云端后台快照定期刷新（已配置引擎则由实时链路负责）
    const timer = hasProviders ? null : window.setInterval(() => void apply(true), 60_000)
    return () => {
      alive = false
      if (timer) window.clearInterval(timer)
    }
  }, [key, list, hasProviders])

  // 基准模式下微幅心跳，让账户估值保持“活着”的手感
  useEffect(() => {
    if (origin !== 'baseline' || list.length === 0) return
    const timer = window.setInterval(() => {
      setPrices((prev) => {
        const next: Record<string, number> = {}
        for (const sym of list) {
          const current = prev[sym]
          next[sym] = current && current > 0 ? Math.max(0.0001, current * (1 + (Math.random() - 0.5) * 0.0016)) : current
        }
        return next
      })
    }, BASELINE_TICK_MS)
    return () => window.clearInterval(timer)
  }, [origin, list])

  // 实时模式下定期轮询
  useEffect(() => {
    if (!hasProviders || origin !== 'live' || list.length === 0) return
    const timer = window.setInterval(() => setRefreshToken((v) => v + 1), POLL_MS)
    return () => window.clearInterval(timer)
  }, [hasProviders, origin, list])

  const refresh = useCallback(() => setRefreshToken((v) => v + 1), [])

  return { prices, currencies, origin, loading, refresh }
}

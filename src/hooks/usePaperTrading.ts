import { useCallback, useMemo, useRef, useState, useEffect } from 'react'

import type { Currency, OrderRequest, OrderResult, PaperProfile } from '@/types'
import { applyOrder, createProfile as makeProfile, matchPendingOrders } from '@/lib/trading'

const STORAGE_KEY = 'apex-terminal:paper-trading:v1'

interface PersistState {
  profiles: PaperProfile[]
  activeId: string | null
}

/** 首次进入：默认创建一个美股账户 */
function seedState(): PersistState {
  const profile = makeProfile('美股科技波段账户', 'USD', 100_000)
  return { profiles: [profile], activeId: profile.id }
}

function loadState(): PersistState {
  if (typeof window === 'undefined') return seedState()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return seedState()
    const parsed = JSON.parse(raw) as PersistState
    if (!parsed || !Array.isArray(parsed.profiles) || parsed.profiles.length === 0) return seedState()
    const activeId = parsed.profiles.some((p) => p.id === parsed.activeId)
      ? parsed.activeId
      : parsed.profiles[0].id
    return { profiles: parsed.profiles, activeId }
  } catch {
    return seedState()
  }
}

export interface PaperTradingController {
  profiles: PaperProfile[]
  activeId: string | null
  active: PaperProfile | null
  createProfile: (name: string, currency: Currency, initialCapital: number) => void
  renameProfile: (id: string, name: string) => void
  deleteProfile: (id: string) => void
  switchProfile: (id: string) => void
  /** 重置账户：清空持仓与流水，本金与现金归为指定金额 */
  resetCapital: (id: string, amount: number) => void
  /** 追加资金：本金与可用现金同步增加 */
  deposit: (id: string, amount: number) => void
  setFxRate: (id: string, rate: number) => void
  placeOrder: (request: OrderRequest) => OrderResult
  cancelOrder: (orderId: string) => void
  /** 用最新报价检查所有账户的挂单是否触发成交 */
  applyPrices: (prices: Record<string, number>) => void
}

/**
 * 多账户（Profile）模拟交易账本。
 * 全部数据持久化于 localStorage；撮合与盈亏由 lib/trading 纯函数完成。
 */
export function usePaperTrading(): PaperTradingController {
  const [state, setState] = useState<PersistState>(loadState)
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // 存储不可用时静默忽略
    }
  }, [state])

  const updateProfile = useCallback((id: string, updater: (profile: PaperProfile) => PaperProfile) => {
    setState((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) => (p.id === id ? updater(p) : p)),
    }))
  }, [])

  const createProfile = useCallback((name: string, currency: Currency, initialCapital: number) => {
    const profile = makeProfile(name, currency, initialCapital)
    setState((prev) => ({ profiles: [...prev.profiles, profile], activeId: profile.id }))
  }, [])

  const renameProfile = useCallback(
    (id: string, name: string) => {
      updateProfile(id, (p) => ({ ...p, name: name.trim() || p.name, updatedAt: new Date().toISOString() }))
    },
    [updateProfile],
  )

  const deleteProfile = useCallback((id: string) => {
    setState((prev) => {
      const profiles = prev.profiles.filter((p) => p.id !== id)
      if (profiles.length === 0) return seedState()
      const activeId = prev.activeId === id ? profiles[0].id : prev.activeId
      return { profiles, activeId }
    })
  }, [])

  const switchProfile = useCallback((id: string) => {
    setState((prev) => (prev.profiles.some((p) => p.id === id) ? { ...prev, activeId: id } : prev))
  }, [])

  const resetCapital = useCallback(
    (id: string, amount: number) => {
      const capital = Math.max(0, amount)
      updateProfile(id, (p) => ({
        ...p,
        initialCapital: capital,
        cash: capital,
        positions: [],
        trades: [],
        pending: [],
        updatedAt: new Date().toISOString(),
      }))
    },
    [updateProfile],
  )

  const deposit = useCallback(
    (id: string, amount: number) => {
      const delta = amount
      updateProfile(id, (p) => ({
        ...p,
        initialCapital: Math.max(0, p.initialCapital + delta),
        cash: Math.max(0, p.cash + delta),
        updatedAt: new Date().toISOString(),
      }))
    },
    [updateProfile],
  )

  const setFxRate = useCallback(
    (id: string, rate: number) => {
      const value = Number.isFinite(rate) && rate > 0 ? rate : 4.45
      updateProfile(id, (p) => ({ ...p, fxRate: value, updatedAt: new Date().toISOString() }))
    },
    [updateProfile],
  )

  const placeOrder = useCallback((request: OrderRequest): OrderResult => {
    const current = stateRef.current
    const id = current.activeId
    if (!id) return { ok: false, status: 'rejected', reason: '请先创建交易账户' }
    const profile = current.profiles.find((p) => p.id === id)
    if (!profile) return { ok: false, status: 'rejected', reason: '账户不存在' }

    const { profile: next, result } = applyOrder(profile, request)
    if (result.ok) {
      const nextState: PersistState = {
        ...current,
        profiles: current.profiles.map((p) => (p.id === id ? next : p)),
      }
      stateRef.current = nextState
      setState(nextState)
    }
    return result
  }, [])

  const cancelOrder = useCallback(
    (orderId: string) => {
      setState((prev) => ({
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.pending.some((o) => o.id === orderId)
            ? { ...p, pending: p.pending.filter((o) => o.id !== orderId), updatedAt: new Date().toISOString() }
            : p,
        ),
      }))
    },
    [],
  )

  const applyPrices = useCallback((prices: Record<string, number>) => {
    if (Object.keys(prices).length === 0) return
    setState((prev) => {
      let changed = false
      const profiles = prev.profiles.map((p) => {
        if (p.pending.length === 0) return p
        const { profile, filled } = matchPendingOrders(p, prices)
        if (filled.length > 0) {
          changed = true
          return profile
        }
        return p
      })
      return changed ? { ...prev, profiles } : prev
    })
  }, [])

  const active = useMemo(
    () => state.profiles.find((p) => p.id === state.activeId) ?? null,
    [state.profiles, state.activeId],
  )

  return {
    profiles: state.profiles,
    activeId: state.activeId,
    active,
    createProfile,
    renameProfile,
    deleteProfile,
    switchProfile,
    resetCapital,
    deposit,
    setFxRate,
    placeOrder,
    cancelOrder,
    applyPrices,
  }
}

import type { MacroRates } from '@/types'

/**
 * 宏观利率基线。
 * 基准口径：美国国债（2Y/10Y/30Y）、马来西亚政府证券 MGS（3Y/5Y/10Y）
 * 与马来西亚国家银行 BNM 隔夜政策利率（OPR）。
 */
const BASE = {
  us2y: 4.21,
  us10y: 4.42,
  us30y: 4.61,
  mgs3y: 3.62,
  mgs5y: 3.74,
  mgs10y: 3.86,
  opr: 3.0,
} as const

function withSpread(rates: Omit<MacroRates, 'spread10y' | 'updatedAt' | 'origin'>): MacroRates {
  return {
    ...rates,
    spread10y: Number((rates.us10y - rates.mgs10y).toFixed(2)),
    updatedAt: new Date().toISOString(),
    origin: 'baseline',
  }
}

export function baselineMacro(): MacroRates {
  return withSpread({ ...BASE })
}

/** 手动刷新时的微小波动（终端模拟渲染，波动幅度 ±1bp 以内） */
export function jitterMacro(previous: MacroRates): MacroRates {
  const drift = (key: keyof typeof BASE) => {
    const value = previous[key] + (Math.random() - 0.5) * 0.02
    return Number(value.toFixed(2))
  }
  return withSpread({
    us2y: drift('us2y'),
    us10y: drift('us10y'),
    us30y: drift('us30y'),
    mgs3y: drift('mgs3y'),
    mgs5y: drift('mgs5y'),
    mgs10y: drift('mgs10y'),
    opr: previous.opr,
  })
}

/** 收益率曲线各期限相对 OPR / 短端的利差（bp） */
export function curveSpreads(rates: MacroRates) {
  return [
    { label: 'US 2Y–10Y', value: Number(((rates.us10y - rates.us2y) * 100).toFixed(0)) },
    { label: 'MGS 3Y–10Y', value: Number(((rates.mgs10y - rates.mgs3y) * 100).toFixed(0)) },
    { label: 'US10Y – MGS10Y', value: Number(((rates.us10y - rates.mgs10y) * 100).toFixed(0)) },
    { label: 'MGS10Y – OPR', value: Number(((rates.mgs10y - rates.opr) * 100).toFixed(0)) },
  ]
}

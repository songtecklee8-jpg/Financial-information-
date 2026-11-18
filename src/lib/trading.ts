import type {
  Currency,
  OrderRequest,
  OrderResult,
  PaperProfile,
  PendingOrder,
  Position,
  ProfileStats,
  TradeRecord,
  TradeReview,
} from '@/types'
import { clamp, formatPercent, formatPrice } from '@/lib/format'

/** 默认 USD → MYR 汇率（1 美元兑令吉），可由用户在账户中调整 */
export const DEFAULT_FX_RATE = 4.45

/** 生成唯一 id */
export function uid(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}

/** 跨币种换算：fxRate 表示 1 USD 兑多少 MYR */
export function convert(amount: number, from: Currency, to: Currency, fxRate: number): number {
  if (from === to) return amount
  const rate = fxRate > 0 ? fxRate : DEFAULT_FX_RATE
  if (from === 'USD' && to === 'MYR') return amount * rate
  if (from === 'MYR' && to === 'USD') return amount / rate
  return amount
}

/** 创建新账户档案 */
export function createProfile(
  name: string,
  currency: Currency,
  initialCapital: number,
  fxRate = DEFAULT_FX_RATE,
): PaperProfile {
  const now = new Date().toISOString()
  return {
    id: uid('profile'),
    name: name.trim() || '新建账户',
    currency,
    initialCapital: Math.max(0, initialCapital),
    cash: Math.max(0, initialCapital),
    fxRate: fxRate > 0 ? fxRate : DEFAULT_FX_RATE,
    positions: [],
    trades: [],
    pending: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** 按均价法更新持仓（买入） */
function openPosition(
  positions: Position[],
  symbol: string,
  name: string,
  market: Position['market'],
  currency: Currency,
  quantity: number,
  price: number,
  now: string,
): Position[] {
  const existing = positions.find((p) => p.symbol === symbol)
  if (!existing) {
    return [
      ...positions,
      { symbol, name, market, currency, quantity, avgCost: price, openedAt: now, updatedAt: now },
    ]
  }
  const totalQty = existing.quantity + quantity
  const avgCost = (existing.avgCost * existing.quantity + price * quantity) / totalQty
  return positions.map((p) =>
    p.symbol === symbol ? { ...p, quantity: totalQty, avgCost, updatedAt: now } : p,
  )
}

/** 按均价法减仓（卖出），返回 [新持仓数组, 已实现盈亏(标的货币)] */
function closePosition(
  positions: Position[],
  symbol: string,
  quantity: number,
  price: number,
  now: string,
): [Position[], number] {
  const existing = positions.find((p) => p.symbol === symbol)
  if (!existing) return [positions, 0]
  const realized = (price - existing.avgCost) * quantity
  const remaining = existing.quantity - quantity
  if (remaining <= 1e-9) {
    return [positions.filter((p) => p.symbol !== symbol), realized]
  }
  return [
    positions.map((p) => (p.symbol === symbol ? { ...p, quantity: remaining, updatedAt: now } : p)),
    realized,
  ]
}

/**
 * 撮合下单：市价单立即成交；限价单若价格已穿越则成交，否则挂单。
 * 返回新的账户档案与下单结果（纯函数，不修改入参）。
 */
export function applyOrder(profile: PaperProfile, request: OrderRequest): { profile: PaperProfile; result: OrderResult } {
  const { symbol, name, market, currency, side, type, quantity } = request
  const base = profile.currency
  const fx = profile.fxRate
  const now = new Date().toISOString()

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { profile, result: { ok: false, status: 'rejected', reason: '委托数量必须大于 0' } }
  }
  if (!Number.isFinite(request.marketPrice) || request.marketPrice <= 0) {
    return { profile, result: { ok: false, status: 'rejected', reason: '缺少有效的实时价格' } }
  }

  const limit = request.limitPrice
  const crossed =
    type === 'market' ||
    (typeof limit === 'number' &&
      limit > 0 &&
      (side === 'buy' ? request.marketPrice <= limit : request.marketPrice >= limit))

  // 限价未穿越：挂单等待
  if (!crossed) {
    const pending: PendingOrder = {
      id: uid('order'),
      profileId: profile.id,
      symbol,
      name,
      market,
      currency,
      side,
      quantity,
      limitPrice: limit as number,
      createdAt: now,
    }
    return {
      profile: { ...profile, pending: [...profile.pending, pending], updatedAt: now },
      result: { ok: true, status: 'open', pending },
    }
  }

  // 成交价：市价用最新价；限价穿越时以最新价成交（价格改善）
  const fillPrice = request.marketPrice

  return fillOrder(profile, {
    symbol,
    name,
    market,
    currency,
    side,
    type,
    quantity,
    price: fillPrice,
    now,
    base,
    fx,
  })
}

interface FillInput {
  symbol: string
  name: string
  market: Position['market']
  currency: Currency
  side: OrderRequest['side']
  type: OrderRequest['type']
  quantity: number
  price: number
  now: string
  base: Currency
  fx: number
}

/** 执行成交并更新账本 */
function fillOrder(profile: PaperProfile, input: FillInput): { profile: PaperProfile; result: OrderResult } {
  const { symbol, name, market, currency, side, type, quantity, price, now, base, fx } = input
  const notional = price * quantity
  const notionalBase = convert(notional, currency, base, fx)

  if (side === 'buy') {
    if (profile.cash < notionalBase - 1e-6) {
      return {
        profile,
        result: {
          ok: false,
          status: 'rejected',
          reason: `可用现金不足：需要 ${formatPrice(notionalBase, base)}，当前 ${formatPrice(profile.cash, base)}`,
        },
      }
    }
    const trade: TradeRecord = {
      id: uid('trade'),
      profileId: profile.id,
      symbol,
      name,
      market,
      currency,
      side,
      type,
      quantity,
      price,
      notional,
      realizedPnl: 0,
      createdAt: now,
    }
    return {
      profile: {
        ...profile,
        cash: profile.cash - notionalBase,
        positions: openPosition(profile.positions, symbol, name, market, currency, quantity, price, now),
        trades: [...profile.trades, trade],
        updatedAt: now,
      },
      result: { ok: true, status: 'filled', trade },
    }
  }

  // 卖出
  const held = profile.positions.find((p) => p.symbol === symbol)
  if (!held || held.quantity + 1e-9 < quantity) {
    return {
      profile,
      result: {
        ok: false,
        status: 'rejected',
        reason: `持仓不足：当前持有 ${held?.quantity ?? 0} 股，无法卖出 ${quantity} 股`,
      },
    }
  }
  const [positions, realizedLocal] = closePosition(profile.positions, symbol, quantity, price, now)
  const realizedBase = convert(realizedLocal, currency, base, fx)
  const trade: TradeRecord = {
    id: uid('trade'),
    profileId: profile.id,
    symbol,
    name,
    market,
    currency,
    side,
    type,
    quantity,
    price,
    notional,
    realizedPnl: realizedBase,
    createdAt: now,
  }
  return {
    profile: {
      ...profile,
      cash: profile.cash + notionalBase,
      positions,
      trades: [...profile.trades, trade],
      updatedAt: now,
    },
    result: { ok: true, status: 'filled', trade },
  }
}

/** 用最新价格检查挂单是否可触发成交 */
export function matchPendingOrders(
  profile: PaperProfile,
  prices: Record<string, number>,
): { profile: PaperProfile; filled: TradeRecord[] } {
  if (profile.pending.length === 0) return { profile, filled: [] }
  let current = profile
  const filled: TradeRecord[] = []

  for (const order of profile.pending) {
    const price = prices[order.symbol]
    if (!Number.isFinite(price) || price <= 0) continue
    const crossed = order.side === 'buy' ? price <= order.limitPrice : price >= order.limitPrice
    if (!crossed) continue

    const now = new Date().toISOString()
    const attempt = fillOrder(current, {
      symbol: order.symbol,
      name: order.name,
      market: order.market,
      currency: order.currency,
      side: order.side,
      type: 'limit',
      quantity: order.quantity,
      price,
      now,
      base: current.currency,
      fx: current.fxRate,
    })
    // 仅当成交时才移除该挂单（现金/持仓不足时保留，等待后续）
    if (attempt.result.status === 'filled') {
      current = {
        ...attempt.profile,
        pending: attempt.profile.pending.filter((p) => p.id !== order.id),
      }
      if (attempt.result.trade) filled.push(attempt.result.trade)
    }
  }

  return { profile: filled.length > 0 ? current : profile, filled }
}

/** 计算账户绩效统计（全部折算为账本货币） */
export function computeProfileStats(
  profile: PaperProfile,
  prices: Record<string, number>,
): ProfileStats {
  const base = profile.currency
  const fx = profile.fxRate

  let positionsValue = 0
  let costBasis = 0
  let largest = 0
  for (const pos of profile.positions) {
    const price = Number.isFinite(prices[pos.symbol]) ? prices[pos.symbol] : pos.avgCost
    const value = convert(price * pos.quantity, pos.currency, base, fx)
    const cost = convert(pos.avgCost * pos.quantity, pos.currency, base, fx)
    positionsValue += value
    costBasis += cost
    largest = Math.max(largest, value)
  }

  const unrealizedPnl = positionsValue - costBasis
  const realizedPnl = profile.trades.reduce((sum, t) => sum + t.realizedPnl, 0)
  const totalValue = profile.cash + positionsValue
  const totalPnl = totalValue - profile.initialCapital
  const totalPnlPct = profile.initialCapital > 0 ? (totalPnl / profile.initialCapital) * 100 : 0

  const closed = profile.trades.filter((t) => t.side === 'sell')
  const wins = closed.filter((t) => t.realizedPnl > 0).length
  const losses = closed.filter((t) => t.realizedPnl < 0).length
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0

  const grossWin = closed.reduce((sum, t) => sum + Math.max(0, t.realizedPnl), 0)
  const grossLoss = closed.reduce((sum, t) => sum + Math.max(0, -t.realizedPnl), 0)
  const profitFactor = grossLoss > 1e-9 ? grossWin / grossLoss : grossWin > 0 ? 99.99 : 0

  // 用已实现盈亏序列 + 当前总资产近似还原权益曲线，据此计算最大回撤
  const ordered = [...profile.trades].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
  const curve: number[] = [profile.initialCapital]
  let cum = 0
  for (const t of ordered) {
    cum += t.realizedPnl
    curve.push(profile.initialCapital + cum)
  }
  curve.push(totalValue)
  let peak = curve[0] ?? 0
  let maxDrawdownPct = 0
  for (const point of curve) {
    peak = Math.max(peak, point)
    if (peak > 0) {
      const dd = ((peak - point) / peak) * 100
      maxDrawdownPct = Math.max(maxDrawdownPct, dd)
    }
  }

  const concentrationPct = positionsValue > 0 ? (largest / positionsValue) * 100 : 0

  return {
    currency: base,
    cash: profile.cash,
    positionsValue,
    totalValue,
    unrealizedPnl,
    realizedPnl,
    totalPnl,
    totalPnlPct,
    winRate,
    wins,
    losses,
    profitFactor,
    maxDrawdownPct,
    tradeCount: profile.trades.length,
    closedTrades: closed.length,
    concentrationPct,
  }
}

// ---------------------------------------------------------------------------
// AI 复盘：上下文打包 + 无 Key 本地兜底
// ---------------------------------------------------------------------------

/** 把账户快照整理成给 Gemini 的结构化文本 */
export function buildTradeReviewPayload(profile: PaperProfile, stats: ProfileStats): string {
  const positions =
    profile.positions.length > 0
      ? profile.positions
          .map((p) => {
            const value = convert(p.avgCost * p.quantity, p.currency, stats.currency, profile.fxRate)
            const weight = stats.positionsValue > 0 ? (value / stats.positionsValue) * 100 : 0
            return `- ${p.symbol}（${p.name}｜${p.market}）持仓 ${p.quantity} @ 均价 ${formatPrice(p.avgCost, p.currency)}，成本占比 ${weight.toFixed(1)}%`
          })
          .join('\n')
      : '- 当前空仓'

  const recent = [...profile.trades]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20)
    .map(
      (t) =>
        `- ${t.createdAt.slice(0, 16).replace('T', ' ')} ${t.side === 'buy' ? '买入' : '卖出'} ${t.symbol} × ${t.quantity} @ ${formatPrice(t.price, t.currency)}${
          t.side === 'sell' ? `（已实现 ${formatPrice(t.realizedPnl, stats.currency)}）` : ''
        }`,
    )
    .join('\n')

  const pending =
    profile.pending.length > 0
      ? profile.pending
          .map((p) => `- ${p.side === 'buy' ? '买入' : '卖出'} ${p.symbol} × ${p.quantity} @ 限价 ${formatPrice(p.limitPrice, p.currency)}`)
          .join('\n')
      : '- 无'

  return [
    '=== 账户档案 ===',
    `账户名称：${profile.name}`,
    `账本货币：${profile.currency}`,
    `USD/MYR 汇率：${profile.fxRate.toFixed(4)}`,
    `初始本金：${formatPrice(profile.initialCapital, stats.currency)}`,
    `创建时间：${profile.createdAt.slice(0, 10)}`,

    '=== 资产与盈亏 ===',
    `可用现金：${formatPrice(stats.cash, stats.currency)}`,
    `持仓市值：${formatPrice(stats.positionsValue, stats.currency)}`,
    `总资产：${formatPrice(stats.totalValue, stats.currency)}`,
    `浮动盈亏：${formatPrice(stats.unrealizedPnl, stats.currency)}`,
    `已实现盈亏：${formatPrice(stats.realizedPnl, stats.currency)}`,
    `总盈亏：${formatPrice(stats.totalPnl, stats.currency)}（${formatPercent(stats.totalPnlPct, { signed: true })}）`,

    '=== 交易绩效 ===',
    `成交笔数：${stats.tradeCount}（其中平仓 ${stats.closedTrades} 笔）`,
    `胜率：${stats.winRate.toFixed(1)}%（盈 ${stats.wins} / 亏 ${stats.losses}）`,
    `盈亏比：${stats.profitFactor.toFixed(2)}`,
    `最大回撤：${stats.maxDrawdownPct.toFixed(2)}%`,
    `第一大持仓集中度：${stats.concentrationPct.toFixed(1)}%`,

    '=== 当前持仓 ===',
    positions,

    '=== 挂单 ===',
    pending,

    '=== 最近成交（最多 20 笔）===',
    recent || '- 暂无成交记录',

    '',
    '请基于以上账户快照，输出 JSON 格式的深度交易复盘。',
  ].join('\n')
}

/** 未配置 Gemini Key 时的本地启发式复盘，保证复盘卡片永不空白 */
export function localTradeReview(profile: PaperProfile, stats: ProfileStats): TradeReview {
  const strengths: string[] = []
  const improvements: string[] = []

  if (stats.closedTrades >= 3 && stats.winRate >= 50) {
    strengths.push(`胜率 ${stats.winRate.toFixed(0)}%，择时与顺势执行到位`)
  }
  if (profile.positions.length >= 2 && stats.concentrationPct <= 35) {
    strengths.push(`${profile.positions.length} 只标的分散配置，符合 MPT 分散化原则`)
  }
  if (stats.maxDrawdownPct <= 10 && stats.tradeCount > 0) {
    strengths.push(`最大回撤仅 ${stats.maxDrawdownPct.toFixed(1)}%，风险控制稳健`)
  }
  if (stats.totalPnl > 0) {
    strengths.push(`账户累计盈利 ${formatPrice(stats.totalPnl, stats.currency)}，整体为正收益`)
  }
  if (strengths.length === 0) {
    strengths.push('已建立基础交易框架，建议继续累积样本以评估真实能力')
  }

  if (stats.concentrationPct > 50) {
    improvements.push(`第一大持仓占比 ${stats.concentrationPct.toFixed(0)}%，过度集中，建议降至 25% 以内`)
  }
  if (stats.maxDrawdownPct > 20) {
    improvements.push(`最大回撤 ${stats.maxDrawdownPct.toFixed(1)}%，恐缺乏止损纪律`)
  }
  if (stats.closedTrades >= 20) {
    improvements.push(`累计平仓 ${stats.closedTrades} 笔，交易偏频繁，需留意滑点与情绪损耗`)
  }
  if (stats.totalValue > 0 && stats.cash / stats.totalValue > 0.7 && profile.positions.length === 0) {
    improvements.push(`现金占比 ${((stats.cash / stats.totalValue) * 100).toFixed(0)}%，资金闲置，存在机会成本`)
  }
  if (stats.closedTrades >= 3 && stats.profitFactor < 1) {
    improvements.push(`盈亏比 ${stats.profitFactor.toFixed(2)} 低于 1，存在止盈过早或止损过晚`)
  }
  if (improvements.length === 0) {
    improvements.push('建议补充明确的止损 / 止盈规则，并记录每笔交易的理由与预期')
  }

  const disciplineScore = clamp(
    Math.round(
      55 +
        (stats.winRate >= 50 ? 10 : -5) +
        (stats.concentrationPct <= 35 ? 10 : -10) +
        (stats.maxDrawdownPct <= 10 ? 10 : stats.maxDrawdownPct > 25 ? -15 : 0) +
        (stats.profitFactor >= 1.5 ? 10 : stats.profitFactor < 1 ? -10 : 0),
    ),
    5,
    95,
  )

  return {
    profileId: profile.id,
    headline: `${profile.name}：总资产 ${formatPrice(stats.totalValue, stats.currency)}，累计 ${
      stats.totalPnl >= 0 ? '盈利' : '亏损'
    } ${formatPrice(Math.abs(stats.totalPnl), stats.currency)}`,
    strengths,
    improvements,
    riskPlan: `按半凯利公式，单笔风险敞口建议控制在总资产的 ${Math.max(
      1,
      Math.min(10, Math.round(stats.winRate / 5)),
    )}% 以内；依据 MPT 将持仓分散至 4-6 只不同板块标的，单一持仓上限 25%；为每笔交易预设 -8% 止损与 +15% 止盈规则；当前账本货币为 ${stats.currency}，跨市场交易时注意 USD/MYR 汇率波动对折算盈亏的影响。本结论为本地启发式复盘，配置 Gemini Key 可获得结合宏观利率与历史周期的深度诊断。`,
    disciplineScore,
    generatedAt: new Date().toISOString(),
    model: 'local-quant-engine',
    degraded: true,
  }
}

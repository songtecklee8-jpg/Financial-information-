import { Clock, Layers, X } from 'lucide-react'

import type { Currency, PendingOrder, Position, TradeRecord } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'
import { formatDateTime, formatNumber, formatPercent, formatPrice } from '@/lib/format'
import { convert } from '@/lib/trading'

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-faint">
      {icon}
      <p className="text-[11.5px]">{text}</p>
    </div>
  )
}

export function PositionsPanel({
  positions,
  prices,
  fxRate,
  baseCurrency,
  onClosePosition,
}: {
  positions: Position[]
  prices: Record<string, number>
  fxRate: number
  baseCurrency: Currency
  onClosePosition: (position: Position) => void
}) {
  if (positions.length === 0) {
    return <Empty icon={<Layers className="size-6" />} text="当前空仓，使用左侧票据下单建仓" />
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] font-mono text-[11.5px]">
        <thead>
          <tr className="text-left text-[10px] tracking-[0.1em] text-faint uppercase">
            <th className="pb-2 font-medium">标的</th>
            <th className="pb-2 text-right font-medium">持仓</th>
            <th className="pb-2 text-right font-medium">均价</th>
            <th className="pb-2 text-right font-medium">最新价</th>
            <th className="pb-2 text-right font-medium">市值</th>
            <th className="pb-2 text-right font-medium">浮动盈亏</th>
            <th className="pb-2 text-right font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => {
            const last = Number.isFinite(prices[pos.symbol]) ? prices[pos.symbol] : pos.avgCost
            const marketValue = convert(last * pos.quantity, pos.currency, baseCurrency, fxRate)
            const cost = convert(pos.avgCost * pos.quantity, pos.currency, baseCurrency, fxRate)
            const pnl = marketValue - cost
            const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0
            const up = pnl >= 0
            return (
              <tr key={pos.symbol} className="border-t border-line/50">
                <td className="py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-ink">{pos.symbol}</span>
                    <span className="rounded border border-line bg-void/50 px-1 py-[1px] text-[9px] text-faint">
                      {pos.market}
                    </span>
                  </div>
                  <div className="max-w-[160px] truncate text-[10px] text-faint">{pos.name}</div>
                </td>
                <td className="py-2 text-right text-dim">{formatNumber(pos.quantity)}</td>
                <td className="py-2 text-right text-dim">{formatPrice(pos.avgCost, pos.currency)}</td>
                <td className="py-2 text-right text-ink">{formatPrice(last, pos.currency)}</td>
                <td className="py-2 text-right text-ink">{formatPrice(marketValue, baseCurrency)}</td>
                <td className={cn('py-2 text-right font-medium', up ? 'text-bull' : 'text-bear')}>
                  {up ? '+' : ''}
                  {formatPrice(pnl, baseCurrency)}
                  <div className="text-[10px] opacity-80">{formatPercent(pnlPct, { signed: true })}</div>
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onClosePosition(pos)}
                    className="rounded-md border border-line px-2 py-1 text-[10px] text-faint transition hover:border-bear/50 hover:text-bear"
                    title="按最新价市价平仓"
                  >
                    平仓
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function PendingOrdersPanel({
  pending,
  prices,
  onCancel,
}: {
  pending: PendingOrder[]
  prices: Record<string, number>
  onCancel: (id: string) => void
}) {
  if (pending.length === 0) {
    return <Empty icon={<Clock className="size-6" />} text="暂无挂单" />
  }

  return (
    <ul className="space-y-1.5">
      {pending.map((order) => {
        const last = prices[order.symbol]
        const gap =
          Number.isFinite(last) && last > 0
            ? ((order.limitPrice - last) / last) * 100
            : Number.NaN
        return (
          <li
            key={order.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-line bg-void/40 px-2.5 py-2 font-mono text-[11px]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Badge tone={order.side === 'buy' ? 'bull' : 'bear'}>
                  {order.side === 'buy' ? '买入' : '卖出'}
                </Badge>
                <span className="font-semibold text-ink">{order.symbol}</span>
                <span className="text-faint">× {formatNumber(order.quantity)}</span>
              </div>
              <div className="mt-0.5 text-[10px] text-faint">
                限价 {formatPrice(order.limitPrice, order.currency)}
                {Number.isFinite(last) ? ` · 现价 ${formatPrice(last, order.currency)}` : ''}
                {Number.isFinite(gap) ? ` · 距离 ${gap >= 0 ? '+' : ''}${gap.toFixed(2)}%` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onCancel(order.id)}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-line px-2 py-1 text-[10px] text-faint transition hover:border-bear/50 hover:text-bear"
            >
              <X className="size-3" /> 撤单
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function TradeHistoryPanel({ trades, currency }: { trades: TradeRecord[]; currency: Currency }) {
  if (trades.length === 0) {
    return <Empty icon={<Clock className="size-6" />} text="暂无成交记录" />
  }

  const ordered = [...trades].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  return (
    <div className="max-h-[360px] overflow-y-auto">
      <table className="w-full min-w-[600px] font-mono text-[11px]">
        <thead className="sticky top-0 bg-panel">
          <tr className="text-left text-[10px] tracking-[0.1em] text-faint uppercase">
            <th className="pb-2 font-medium">时间</th>
            <th className="pb-2 font-medium">方向</th>
            <th className="pb-2 font-medium">标的</th>
            <th className="pb-2 text-right font-medium">数量</th>
            <th className="pb-2 text-right font-medium">成交价</th>
            <th className="pb-2 text-right font-medium">已实现盈亏</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((trade) => (
            <tr key={trade.id} className="border-t border-line/50">
              <td className="py-1.5 text-faint">{formatDateTime(trade.createdAt)}</td>
              <td className="py-1.5">
                <span className={trade.side === 'buy' ? 'text-bull' : 'text-bear'}>
                  {trade.side === 'buy' ? '买入' : '卖出'}
                </span>
                <span className="ml-1 text-[9.5px] text-faint">
                  {trade.type === 'limit' ? '限价' : '市价'}
                </span>
              </td>
              <td className="py-1.5 text-ink">{trade.symbol}</td>
              <td className="py-1.5 text-right text-dim">{formatNumber(trade.quantity)}</td>
              <td className="py-1.5 text-right text-dim">{formatPrice(trade.price, trade.currency)}</td>
              <td className="py-1.5 text-right">
                {trade.side === 'sell' ? (
                  <span className={trade.realizedPnl >= 0 ? 'text-bull' : 'text-bear'}>
                    {trade.realizedPnl >= 0 ? '+' : ''}
                    {formatPrice(trade.realizedPnl, currency)}
                  </span>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

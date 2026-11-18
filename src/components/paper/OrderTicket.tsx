import { useMemo, useState } from 'react'
import { CircleCheck, CircleX, LoaderCircle, Send } from 'lucide-react'

import type { Currency, DataOrigin, OrderRequest, OrderResult, Security } from '@/types'
import { SearchBar } from '@/components/SearchBar'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'
import { formatNumber, formatPrice } from '@/lib/format'

interface OrderTicketProps {
  symbol: string
  security: Security
  price: number
  origin: DataOrigin
  cash: number
  heldQty: number
  currency: Currency
  onSelectSymbol: (symbol: string) => void
  onPlace: (request: OrderRequest) => OrderResult
}

type Side = 'buy' | 'sell'
type OrderKind = 'market' | 'limit'

export function OrderTicket({
  symbol,
  security,
  price,
  origin,
  cash,
  heldQty,
  currency,
  onSelectSymbol,
  onPlace,
}: OrderTicketProps) {
  const [side, setSide] = useState<Side>('buy')
  const [kind, setKind] = useState<OrderKind>('market')
  const [qty, setQty] = useState('10')
  const [limit, setLimit] = useState('')
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const quantity = Number(qty)
  const limitPrice = Number(limit)
  const effectivePrice = kind === 'limit' && limitPrice > 0 ? limitPrice : price
  const notional = Number.isFinite(quantity) && quantity > 0 ? effectivePrice * quantity : 0

  const buyingPowerQty = useMemo(
    () => (price > 0 ? Math.floor(cash / price) : 0),
    [cash, price],
  )

  const blocked =
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    price <= 0 ||
    (kind === 'limit' && (!Number.isFinite(limitPrice) || limitPrice <= 0)) ||
    (side === 'buy' && notional > cash + 1e-6) ||
    (side === 'sell' && quantity > heldQty + 1e-9)

  const applyPortion = (portion: number) => {
    if (side === 'buy') {
      setQty(String(Math.max(0, Math.floor(buyingPowerQty * portion))))
      if (kind === 'limit' && !limit) setLimit(price.toFixed(2))
    } else {
      setQty(String(Math.max(0, Math.floor(heldQty * portion))))
    }
  }

  const submit = () => {
    setFeedback(null)
    const result = onPlace({
      symbol: security.symbol,
      name: security.name,
      market: security.market,
      currency: security.currency,
      side,
      type: kind,
      quantity,
      limitPrice: kind === 'limit' ? limitPrice : undefined,
      marketPrice: price,
    })
    setFeedback({
      ok: result.ok,
      text: result.ok
        ? result.status === 'open'
          ? `限价单已挂出：${side === 'buy' ? '买入' : '卖出'} ${symbol} × ${quantity} @ ${formatPrice(limitPrice, currency)}`
          : `成交：${side === 'buy' ? '买入' : '卖出'} ${symbol} × ${quantity} @ ${formatPrice(price, currency)}`
        : result.reason ?? '下单失败',
    })
  }

  return (
    <section className="panel hairline-top flex min-w-0 flex-col">
      <header className="flex items-center justify-between border-b border-line/70 px-3.5 py-2.5">
        <div>
          <div className="font-mono text-[10px] tracking-[0.18em] text-gold/80 uppercase">Order Ticket</div>
          <h2 className="text-[13px] font-semibold tracking-wide text-ink">下单票据</h2>
        </div>
        {origin === 'live' ? (
          <Badge tone="bull" dot>LIVE</Badge>
        ) : (
          <Badge tone="neutral" title="未配置行情 Key，按基准价格撮合">BASELINE</Badge>
        )}
      </header>

      <div className="space-y-3 p-3.5">
        {/* 买卖方向 */}
        <div className="grid grid-cols-2 gap-1.5">
          {(['buy', 'sell'] as Side[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={cn(
                'rounded-lg border py-2 font-mono text-[12px] font-medium transition',
                side === s
                  ? s === 'buy'
                    ? 'border-bull/55 bg-bull/15 text-bull'
                    : 'border-bear/55 bg-bear/15 text-bear'
                  : 'border-line bg-panel-2 text-dim hover:text-ink',
              )}
            >
              {s === 'buy' ? '买入 BUY' : '卖出 SELL'}
            </button>
          ))}
        </div>

        {/* 标的 */}
        <div>
          <span className="mb-1 block font-mono text-[10.5px] tracking-[0.1em] text-faint uppercase">标的</span>
          <SearchBar
            onSelect={onSelectSymbol}
            activeSymbol={symbol}
            bindGlobalShortcut={false}
            placeholder="搜索美股 / 马股代码或名称"
          />
          <div className="mt-1.5 flex items-center justify-between font-mono text-[11px]">
            <span className="truncate text-ink">
              {security.symbol} <span className="text-faint">{security.name}</span>
            </span>
            <span className="shrink-0 text-gold">{formatPrice(price, security.currency)}</span>
          </div>
        </div>

        {/* 订单类型 */}
        <div>
          <span className="mb-1 block font-mono text-[10.5px] tracking-[0.1em] text-faint uppercase">订单类型</span>
          <div className="grid grid-cols-2 gap-1.5">
            {(['market', 'limit'] as OrderKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k)
                  if (k === 'limit' && !limit) setLimit(price.toFixed(2))
                }}
                className={cn(
                  'rounded-lg border py-1.5 font-mono text-[11px] transition',
                  kind === k ? 'border-gold/50 bg-gold/12 text-gold' : 'border-line bg-panel-2 text-dim hover:text-ink',
                )}
              >
                {k === 'market' ? '市价单 Market' : '限价单 Limit'}
              </button>
            ))}
          </div>
        </div>

        {kind === 'limit' && (
          <div>
            <span className="mb-1 block font-mono text-[10.5px] tracking-[0.1em] text-faint uppercase">限价</span>
            <input
              value={limit}
              onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              className="w-full rounded-lg border border-line bg-void/70 px-2.5 py-2 font-mono text-[13px] text-ink outline-none focus:border-gold/55"
            />
            <p className="mt-1 text-[10.5px] text-faint">
              {side === 'buy' ? '当市价 ≤ 限价时触发买入' : '当市价 ≥ 限价时触发卖出'}；未触发则挂单等待。
            </p>
          </div>
        )}

        {/* 数量 */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[10.5px] tracking-[0.1em] text-faint uppercase">数量</span>
            <span className="font-mono text-[10px] text-faint">
              {side === 'buy' ? `可买约 ${formatNumber(buyingPowerQty)} 股` : `持有 ${formatNumber(heldQty)} 股`}
            </span>
          </div>
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            className="w-full rounded-lg border border-line bg-void/70 px-2.5 py-2 font-mono text-[13px] text-ink outline-none focus:border-gold/55"
          />
          <div className="mt-1.5 flex gap-1.5">
            {[0.25, 0.5, 1].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPortion(p)}
                className="flex-1 rounded border border-line bg-void/50 py-1 font-mono text-[10px] text-faint transition hover:border-gold/40 hover:text-gold"
              >
                {p * 100}%
              </button>
            ))}
          </div>
        </div>

        {/* 预估 */}
        <div className="rounded-lg border border-line bg-void/40 px-3 py-2 font-mono text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-faint">预估金额</span>
            <span className="text-ink">{formatPrice(notional, currency)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-faint">可用现金</span>
            <span className="text-dim">{formatPrice(cash, currency)}</span>
          </div>
        </div>

        <button
          type="button"
          disabled={blocked}
          onClick={submit}
          className={cn(
            'flex w-full items-center justify-center gap-1.5 rounded-lg border py-2.5 font-mono text-[12.5px] font-medium transition',
            blocked
              ? 'cursor-not-allowed border-line bg-panel-2 text-faint'
              : side === 'buy'
                ? 'border-bull/55 bg-bull/15 text-bull hover:bg-bull/25'
                : 'border-bear/55 bg-bear/15 text-bear hover:bg-bear/25',
          )}
        >
          <Send className="size-3.5" />
          {blocked ? '数量 / 资金不足' : `提交${side === 'buy' ? '买入' : '卖出'}委托`}
        </button>

        {feedback && (
          <div
            className={cn(
              'flex items-start gap-1.5 rounded-lg border px-2.5 py-2 font-mono text-[11px]',
              feedback.ok ? 'border-bull/35 bg-bull/10 text-bull' : 'border-bear/35 bg-bear/10 text-bear',
            )}
          >
            {feedback.ok ? <CircleCheck className="mt-[1px] size-3.5 shrink-0" /> : <CircleX className="mt-[1px] size-3.5 shrink-0" />}
            <span className="leading-relaxed">{feedback.text}</span>
          </div>
        )}

        {origin === 'baseline' && (
          <p className="flex items-center gap-1 font-mono text-[10px] text-faint">
            <LoaderCircle className="size-3" /> 未配置行情 Key，撮合基于基准价格
          </p>
        )}
      </div>
    </section>
  )
}

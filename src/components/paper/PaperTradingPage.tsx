import { useEffect, useMemo, useState } from 'react'
import { Activity, Banknote, KeyRound, LoaderCircle, RefreshCw } from 'lucide-react'

import type { ApiSettings, Position } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { OrderTicket } from '@/components/paper/OrderTicket'
import { PositionsPanel, PendingOrdersPanel, TradeHistoryPanel } from '@/components/paper/PortfolioPanels'
import { ProfileManager } from '@/components/paper/ProfileManager'
import { TradeReviewPanel } from '@/components/paper/TradeReviewPanel'
import { StatTile } from '@/components/ui/StatTile'
import { usePaperTrading } from '@/hooks/usePaperTrading'
import { useQuoteMap } from '@/hooks/useQuoteMap'
import { cn } from '@/lib/cn'
import { formatNumber, formatPercent, formatPrice } from '@/lib/format'
import { computeProfileStats } from '@/lib/trading'
import { baselineQuote, normalizeSymbol, resolveSecurity } from '@/lib/universe'

interface PaperTradingPageProps {
  settings: ApiSettings
  onOpenSettings: () => void
}

const DEFAULT_TICKET = 'AAPL'

export function PaperTradingPage({ settings, onOpenSettings }: PaperTradingPageProps) {
  const paper = usePaperTrading()
  const [ticketSymbol, setTicketSymbol] = useState(DEFAULT_TICKET)

  // 需要实时行情的全部标的：下单票据 + 所有账户的持仓与挂单
  const symbols = useMemo(() => {
    const set = new Set<string>()
    set.add(normalizeSymbol(ticketSymbol))
    for (const profile of paper.profiles) {
      for (const pos of profile.positions) set.add(pos.symbol)
      for (const order of profile.pending) set.add(order.symbol)
    }
    return [...set]
  }, [paper.profiles, ticketSymbol])

  const quotes = useQuoteMap(symbols, settings)

  // 实时报价更新后检查挂单撮合
  useEffect(() => {
    paper.applyPrices(quotes.prices)
  }, [quotes.prices, paper.applyPrices])

  const active = paper.active
  const stats = useMemo(
    () => (active ? computeProfileStats(active, quotes.prices) : null),
    [active, quotes.prices],
  )

  const normalizedTicket = normalizeSymbol(ticketSymbol)
  const ticketSecurity = useMemo(() => resolveSecurity(normalizedTicket), [normalizedTicket])
  const ticketPrice =
    quotes.prices[normalizedTicket] && quotes.prices[normalizedTicket] > 0
      ? quotes.prices[normalizedTicket]
      : baselineQuote(normalizedTicket).price
  const heldQty = active?.positions.find((p) => p.symbol === normalizedTicket)?.quantity ?? 0

  const closePosition = (position: Position) => {
    const price = quotes.prices[position.symbol]
    if (!price || price <= 0) return
    paper.placeOrder({
      symbol: position.symbol,
      name: position.name,
      market: position.market,
      currency: position.currency,
      side: 'sell',
      type: 'market',
      quantity: position.quantity,
      marketPrice: price,
    })
  }

  return (
    <main className="mx-auto w-full max-w-[1800px] flex-1 px-3 pt-3 pb-16 sm:px-4">
      {/* 头部 */}
      <section className="panel hairline-top mb-3 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Banknote className="size-4 text-gold" />
              <h1 className="text-base font-semibold tracking-wide text-ink">
                模拟交易 · 实时盘面仿真与多策略账户管理
              </h1>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
              买卖撮合与持仓盈亏直接接入第一页的多引擎实时行情流（同步支持美股与马股 .KL 价格），
              支持市价单与限价单模拟成交；每个账户（Profile）独立核算本金、持仓与盈亏，并配备专属
              <span className="text-gold">AI 交易表现深度诊断</span>。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {quotes.origin === 'live' ? (
              <Badge tone="bull" dot>
                LIVE 实时行情
              </Badge>
            ) : (
              <Badge tone="neutral" dot title="未配置行情 Key，按终端内置基准价格撮合">
                BASELINE 基准盘面
              </Badge>
            )}
            <button
              type="button"
              onClick={quotes.refresh}
              className="inline-flex items-center gap-1 rounded-lg border border-line-2 px-2.5 py-1.5 font-mono text-[11px] text-dim transition hover:border-gold/50 hover:text-gold"
            >
              {quotes.loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              刷新行情
            </button>
          </div>
        </div>
        {quotes.origin === 'baseline' && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-2 inline-flex items-center gap-1 font-mono text-[10.5px] text-gold transition hover:text-gold/80"
          >
            <KeyRound className="size-3" /> 配置行情引擎 Key 以启用真实实时价格撮合
          </button>
        )}
      </section>

      {/* 账户管理 */}
      <div className="mb-3">
        <ProfileManager
          profiles={paper.profiles}
          activeId={paper.activeId}
          active={active}
          onSwitch={paper.switchProfile}
          onCreate={paper.createProfile}
          onRename={paper.renameProfile}
          onDelete={paper.deleteProfile}
          onResetCapital={paper.resetCapital}
          onDeposit={paper.deposit}
          onSetFxRate={paper.setFxRate}
        />
      </div>

      {active && stats ? (
        <>
          {/* 账户绩效总览 */}
          <section className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
            <StatTile label="总资产" value={formatPrice(stats.totalValue, stats.currency)} tone="neutral" />
            <StatTile label="可用现金" value={formatPrice(stats.cash, stats.currency)} tone="neutral" />
            <StatTile label="持仓市值" value={formatPrice(stats.positionsValue, stats.currency)} tone="neutral" />
            <StatTile
              label="浮动盈亏"
              value={`${stats.unrealizedPnl >= 0 ? '+' : ''}${formatPrice(stats.unrealizedPnl, stats.currency)}`}
              tone={stats.unrealizedPnl >= 0 ? 'bull' : 'bear'}
            />
            <StatTile
              label="已实现盈亏"
              value={`${stats.realizedPnl >= 0 ? '+' : ''}${formatPrice(stats.realizedPnl, stats.currency)}`}
              tone={stats.realizedPnl >= 0 ? 'bull' : 'bear'}
            />
            <StatTile
              label="总盈亏"
              value={`${stats.totalPnl >= 0 ? '+' : ''}${formatPrice(stats.totalPnl, stats.currency)}`}
              hint="含浮动与已实现"
              tone={stats.totalPnl >= 0 ? 'bull' : 'bear'}
              footnote={formatPercent(stats.totalPnlPct, { signed: true })}
            />
            <StatTile
              label="胜率"
              value={`${stats.winRate.toFixed(1)}%`}
              tone={stats.winRate >= 50 ? 'bull' : 'neutral'}
              footnote={`盈 ${stats.wins} / 亏 ${stats.losses}`}
            />
            <StatTile
              label="盈亏比"
              value={stats.profitFactor >= 99 ? '∞' : stats.profitFactor.toFixed(2)}
              hint="毛利润 / 毛亏损"
              tone={stats.profitFactor >= 1.5 ? 'bull' : stats.profitFactor < 1 ? 'bear' : 'neutral'}
            />
            <StatTile
              label="最大回撤"
              value={`${stats.maxDrawdownPct.toFixed(2)}%`}
              tone={stats.maxDrawdownPct > 20 ? 'bear' : 'neutral'}
            />
            <StatTile
              label="持仓集中度"
              value={`${stats.concentrationPct.toFixed(1)}%`}
              hint="第一大持仓占比"
              tone={stats.concentrationPct > 50 ? 'bear' : 'neutral'}
            />
            <StatTile label="成交笔数" value={formatNumber(stats.tradeCount)} footnote={`平仓 ${stats.closedTrades} 笔`} />
            <StatTile label="账本货币" value={active.currency} footnote={`1 USD = ${active.fxRate} MYR`} />
          </section>

          {/* 主体 */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
            <div className="min-w-0 space-y-3 xl:col-span-4">
              <OrderTicket
                symbol={normalizedTicket}
                security={ticketSecurity}
                price={ticketPrice}
                origin={quotes.origin}
                cash={stats.cash}
                heldQty={heldQty}
                currency={active.currency}
                onSelectSymbol={setTicketSymbol}
                onPlace={paper.placeOrder}
              />

              <section className="panel hairline-top">
                <header className="border-b border-line/70 px-3.5 py-2.5">
                  <div className="font-mono text-[10px] tracking-[0.18em] text-gold/80 uppercase">Open Orders</div>
                  <h2 className="text-[13px] font-semibold tracking-wide text-ink">
                    挂单 {active.pending.length > 0 && <span className="text-faint">({active.pending.length})</span>}
                  </h2>
                </header>
                <div className="p-3.5">
                  <PendingOrdersPanel pending={active.pending} prices={quotes.prices} onCancel={paper.cancelOrder} />
                </div>
              </section>
            </div>

            <div className="min-w-0 space-y-3 xl:col-span-8">
              <section className="panel hairline-top">
                <header className="flex items-center justify-between border-b border-line/70 px-3.5 py-2.5">
                  <div>
                    <div className="font-mono text-[10px] tracking-[0.18em] text-gold/80 uppercase">Positions</div>
                    <h2 className="text-[13px] font-semibold tracking-wide text-ink">
                      当前持仓 {active.positions.length > 0 && <span className="text-faint">({active.positions.length})</span>}
                    </h2>
                  </div>
                  <Activity className={cn('size-4', quotes.origin === 'live' ? 'text-bull' : 'text-faint')} />
                </header>
                <div className="p-3.5">
                  <PositionsPanel
                    positions={active.positions}
                    prices={quotes.prices}
                    fxRate={active.fxRate}
                    baseCurrency={active.currency}
                    onClosePosition={closePosition}
                  />
                </div>
              </section>

              <TradeReviewPanel
                profile={active}
                stats={stats}
                hasGemini={settings.geminiKey.trim().length > 0}
                apiKey={settings.geminiKey}
                model={settings.geminiModel}
                onOpenSettings={onOpenSettings}
              />

              <section className="panel hairline-top">
                <header className="border-b border-line/70 px-3.5 py-2.5">
                  <div className="font-mono text-[10px] tracking-[0.18em] text-gold/80 uppercase">Trade Blotter</div>
                  <h2 className="text-[13px] font-semibold tracking-wide text-ink">
                    交易流水 {active.trades.length > 0 && <span className="text-faint">({active.trades.length})</span>}
                  </h2>
                </header>
                <div className="p-3.5">
                  <TradeHistoryPanel trades={active.trades} currency={active.currency} />
                </div>
              </section>
            </div>
          </div>
        </>
      ) : (
        <section className="panel flex flex-col items-center gap-2 py-16 text-faint">
          <Banknote className="size-7" />
          <p className="text-[12px]">暂无交易账户，请点击上方「新建账户」开始模拟交易</p>
        </section>
      )}

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3 font-mono text-[10px] text-faint">
        <span>
          模拟交易账户数据保存在浏览器本地（localStorage），实时行情来自多引擎故障转移接口。
        </span>
        <span>本模拟交易与 AI 复盘仅用于量化研究与演示，不构成任何投资建议。</span>
      </footer>
    </main>
  )
}

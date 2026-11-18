import { AlertTriangle, ArrowDownRight, ArrowUpRight, RefreshCw } from 'lucide-react'

import type { DataOrigin, Quote, Security } from '@/types'
import { Badge, OriginBadge } from '@/components/ui/Badge'
import { Sparkline } from '@/components/ui/Sparkline'
import { cn } from '@/lib/cn'
import { formatCompact, formatDateTime, formatPercent, formatPrice, formatVolume } from '@/lib/format'

interface QuoteHeroProps {
  security: Security
  quote: Quote
  origin: DataOrigin
  loading: boolean
  error: string | null
  endpoints: string[]
  onRefresh: () => void
  className?: string
}

function RangeBar({
  label,
  low,
  high,
  value,
  currency,
}: {
  label: string
  low: number
  high: number
  value: number
  currency: string
}) {
  const span = high - low
  const ratio = span > 0 ? Math.max(0, Math.min(1, (value - low) / span)) : 0.5
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between font-mono text-[10px] text-faint">
        <span>{label}</span>
        <span className="text-dim">{formatPercent(ratio * 100, { digits: 0 })} 分位</span>
      </div>
      <div className="relative mt-1.5 h-1.5 w-full rounded-full bg-line">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-bear/60 via-gold/60 to-bull/70"
          style={{ width: `${ratio * 100}%` }}
        />
        <span
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-abyss bg-ink"
          style={{ left: `${ratio * 100}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-faint">
        <span>{formatPrice(low, currency)}</span>
        <span>{formatPrice(high, currency)}</span>
      </div>
    </div>
  )
}

export function QuoteHero({
  security,
  quote,
  origin,
  loading,
  error,
  endpoints,
  onRefresh,
  className,
}: QuoteHeroProps) {
  const up = quote.change >= 0
  const Arrow = up ? ArrowUpRight : ArrowDownRight

  const stats: Array<{ label: string; value: string }> = [
    { label: '昨收', value: formatPrice(quote.previousClose, quote.currency) },
    { label: '开盘', value: formatPrice(quote.open, quote.currency) },
    { label: '日内高', value: formatPrice(quote.dayHigh, quote.currency) },
    { label: '日内低', value: formatPrice(quote.dayLow, quote.currency) },
    { label: '成交量', value: formatVolume(quote.volume) },
    { label: '平均成交量', value: formatVolume(quote.averageVolume) },
    { label: '总市值', value: formatCompact(quote.marketCap) },
    { label: '52 周高/低', value: `${formatPrice(quote.fiftyTwoWeekHigh, quote.currency)} / ${formatPrice(quote.fiftyTwoWeekLow, quote.currency)}` },
  ]

  return (
    <section className={cn('panel hairline-top flex flex-col', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/70 px-3.5 py-2.5 sm:px-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-lg leading-none font-bold tracking-wide text-ink">
              {security.symbol}
            </h1>
            <Badge tone={security.market === 'BURSA' ? 'ice' : 'gold'}>
              {security.market === 'BURSA' ? 'BURSA MY' : 'US'}
            </Badge>
            <OriginBadge origin={origin} />
          </div>
          <p className="mt-1 truncate text-[12px] text-dim" title={security.name}>
            {security.name}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-faint">
            {security.exchange} · {security.sector} · {security.currency}
            {endpoints.length > 0 && ` · 接口 ${endpoints.join('/')}`}
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          title="刷新行情"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-2 px-2.5 py-1.5 font-mono text-[10.5px] text-dim transition hover:border-gold/50 hover:text-gold"
        >
          <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
          刷新
        </button>
      </div>

      <div className="grid gap-3 px-3.5 pt-3 sm:px-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-5">
        <div className="min-w-0">
          <div key={quote.updatedAt} className="tick-flash inline-flex items-end gap-2 rounded px-1">
            <span
              className={cn(
                'font-mono text-[34px] leading-none font-semibold sm:text-[40px]',
                up ? 'text-bull' : 'text-bear',
              )}
            >
              {formatPrice(quote.price, quote.currency)}
            </span>
            <span className={cn('pb-1 font-mono text-sm', up ? 'text-bull' : 'text-bear')}>
              <Arrow className="mb-0.5 inline size-3.5" />
              {up ? '+' : ''}
              {quote.change.toFixed(quote.currency === 'MYR' ? 3 : 2)}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'rounded border px-1.5 py-[2px] font-mono text-[11.5px] font-medium',
                up ? 'border-bull/35 bg-bull/10 text-bull' : 'border-bear/35 bg-bear/10 text-bear',
              )}
            >
              {formatPercent(quote.changePercent, { signed: true })}
            </span>
            <span className="font-mono text-[10px] text-faint">
              更新于 {formatDateTime(quote.updatedAt)}
            </span>
            {loading && <span className="font-mono text-[10px] text-gold">拉取实时数据…</span>}
          </div>

          <div className="mt-3 space-y-2.5">
            <RangeBar
              label="日内区间"
              low={quote.dayLow}
              high={quote.dayHigh}
              value={quote.price}
              currency={quote.currency}
            />
            <RangeBar
              label="52 周区间"
              low={quote.fiftyTwoWeekLow}
              high={quote.fiftyTwoWeekHigh}
              value={quote.price}
              currency={quote.currency}
            />
          </div>
        </div>

        <div className="min-w-0">
          <Sparkline
            data={quote.spark}
            baseline={quote.previousClose}
            showBaseline
            height={104}
            strokeWidth={1.8}
            className="rounded-lg border border-line/60 bg-void/40 px-1"
          />
          <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="min-w-0">
                <div className="font-mono text-[9.5px] tracking-[0.08em] text-faint uppercase">
                  {stat.label}
                </div>
                <div className="truncate font-mono text-[11.5px] text-ink" title={stat.value}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 mx-3.5 mb-3.5 flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/[0.07] px-3 py-2 sm:mx-4 sm:mb-4">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-gold" />
          <p className="text-[11px] leading-relaxed text-dim">
            <span className="text-gold">实时数据不可用：</span>
            {error}
            <span className="text-faint"> 已无缝回退至终端内置基准数据。</span>
          </p>
        </div>
      )}
      <div className="h-3.5" />
    </section>
  )
}

import { useMemo } from 'react'

import type { Quote, Security } from '@/types'
import { Sparkline } from '@/components/ui/Sparkline'
import { FEATURED_SYMBOLS, baselineQuote, resolveSecurity } from '@/lib/universe'
import { cn } from '@/lib/cn'
import { formatPercent, formatPrice } from '@/lib/format'

interface WatchGridProps {
  activeSymbol: string
  onSelect: (symbol: string) => void
  /** 当前标的的实时快照，用于覆盖对应格子的数据 */
  liveQuote?: Quote
  liveOrigin?: 'live' | 'baseline'
  className?: string
}

interface Row {
  security: Security
  quote: Quote
}

/** 行情墙：热门美股 + 马股，点击即切换标的 */
export function WatchGrid({
  activeSymbol,
  onSelect,
  liveQuote,
  liveOrigin = 'baseline',
  className,
}: WatchGridProps) {
  const rows = useMemo<Row[]>(
    () =>
      FEATURED_SYMBOLS.map((symbol) => ({
        security: resolveSecurity(symbol),
        quote:
          liveQuote && liveQuote.symbol === symbol && liveOrigin === 'live'
            ? liveQuote
            : baselineQuote(symbol),
      })),
    [liveQuote, liveOrigin],
  )

  return (
    <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4', className)}>
      {rows.map(({ security, quote }) => {
        const isActive = security.symbol === activeSymbol
        const up = quote.change >= 0
        const isLive = quote.origin === 'live'
        return (
          <button
            key={security.symbol}
            type="button"
            onClick={() => onSelect(security.symbol)}
            className={cn(
              'group panel-flat relative overflow-hidden px-2.5 py-2 text-left transition',
              isActive ? 'border-gold/55 bg-gold/[0.06]' : 'hover:border-line-2 hover:bg-panel-3',
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <span
                className={cn(
                  'truncate font-mono text-[11.5px] font-semibold',
                  isActive ? 'text-gold' : 'text-ink',
                )}
              >
                {security.symbol}
              </span>
              {isLive && <span className="size-1.5 shrink-0 rounded-full bg-bull live-dot" />}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-faint" title={security.name}>
              {security.name}
            </div>
            <div className="mt-1.5 flex items-end justify-between gap-1">
              <span className="font-mono text-[13px] leading-none text-ink">
                {formatPrice(quote.price, quote.currency)}
              </span>
              <span
                className={cn(
                  'font-mono text-[10.5px] leading-none font-medium',
                  up ? 'text-bull' : 'text-bear',
                )}
              >
                {formatPercent(quote.changePercent, { signed: true })}
              </span>
            </div>
            <Sparkline
              data={quote.spark}
              baseline={quote.previousClose}
              height={22}
              strokeWidth={1.2}
              className="mt-1.5"
            />
          </button>
        )
      })}
    </div>
  )
}

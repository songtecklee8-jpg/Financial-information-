import { useMemo } from 'react'

import { ALL_INSTRUMENTS, baselineQuote } from '@/lib/universe'
import { cn } from '@/lib/cn'
import { formatPercent, formatPrice } from '@/lib/format'

interface TickerTapeProps {
  onSelect: (symbol: string) => void
  className?: string
}

/** 顶部滚动行情带：全市场基准快照，点击任意条目即切换标的 */
export function TickerTape({ onSelect, className }: TickerTapeProps) {
  const entries = useMemo(
    () =>
      ALL_INSTRUMENTS.map((security) => ({
        security,
        quote: baselineQuote(security.symbol),
      })).sort((a, b) => b.security.market.localeCompare(a.security.market)),
    [],
  )

  const renderGroup = (keyPrefix: string) => (
    <div className="inline-flex shrink-0 items-center">
      {entries.map(({ security, quote }) => {
        const up = quote.change >= 0
        return (
          <button
            key={`${keyPrefix}-${security.symbol}`}
            type="button"
            onClick={() => onSelect(security.symbol)}
            className="inline-flex shrink-0 items-center gap-2 border-r border-line/70 px-3 py-1.5 transition-colors hover:bg-panel-2"
          >
            <span className="font-mono text-[11px] font-semibold text-ink">{security.symbol}</span>
            <span className="font-mono text-[11px] text-dim">
              {formatPrice(quote.price, quote.currency)}
            </span>
            <span className={cn('font-mono text-[10.5px]', up ? 'text-bull' : 'text-bear')}>
              {up ? '▲' : '▼'} {formatPercent(Math.abs(quote.changePercent), { digits: 2 })}
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div
      className={cn(
        'marquee group relative overflow-hidden border-b border-line bg-void/60',
        className,
      )}
    >
      <div className="marquee-track">
        {renderGroup('a')}
        {renderGroup('b')}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-abyss to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-abyss to-transparent" />
    </div>
  )
}

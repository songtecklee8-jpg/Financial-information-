import { RefreshCw } from 'lucide-react'

import type { MacroRates } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { Panel } from '@/components/ui/Panel'
import { YieldCurveChart } from '@/components/ui/YieldCurveChart'
import { cn } from '@/lib/cn'
import { curveSpreads } from '@/lib/macro'
import { formatDateTime } from '@/lib/format'

interface MacroPanelProps {
  macro: MacroRates
  onRefresh: () => void
  className?: string
}

function RateChip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'gold' | 'ice' | 'iris' | 'neutral'
}) {
  const TONE = {
    gold: 'text-gold',
    ice: 'text-ice',
    iris: 'text-iris',
    neutral: 'text-ink',
  } as const
  return (
    <div className="panel-flat min-w-0 px-2.5 py-2 transition-colors hover:border-line-2">
      <div className="truncate font-mono text-[10px] tracking-[0.08em] text-faint uppercase">{label}</div>
      <div className={cn('mt-1 font-mono text-[15px] leading-none font-medium', TONE[tone])}>
        {value.toFixed(2)}
        <span className="ml-0.5 text-[10px] text-faint">%</span>
      </div>
    </div>
  )
}

/** 利差对比：以 0 为中心的双向条（单位 bp） */
function SpreadRow({ label, value }: { label: string; value: number }) {
  const magnitude = Math.min(Math.abs(value) / 120, 1) * 50
  const positive = value >= 0
  return (
    <div>
      <div className="flex items-center justify-between font-mono text-[10.5px]">
        <span className="text-dim">{label}</span>
        <span className={cn('font-medium', positive ? 'text-bull' : 'text-bear')}>
          {positive ? '+' : ''}
          {value.toFixed(0)} bp
        </span>
      </div>
      <div className="relative mt-1 h-1.5 w-full rounded-full bg-line/70">
        <span className="absolute top-1/2 left-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-line-2" />
        <div
          className={cn(
            'absolute top-0 h-full rounded-full',
            positive ? 'left-1/2 bg-bull/70' : 'right-1/2 bg-bear/70',
          )}
          style={{ width: `${magnitude}%` }}
        />
      </div>
    </div>
  )
}

/** 宏观利率面板：美债 / MGS / OPR + 收益率曲线 + 利差对比 */
export function MacroPanel({ macro, onRefresh, className }: MacroPanelProps) {
  const spreads = curveSpreads(macro)

  return (
    <Panel
      eyebrow="Macro / Rates"
      title="宏观利率环境"
      subtitle={`收益率曲线与政策利率 · 更新于 ${formatDateTime(macro.updatedAt)}`}
      className={className}
      actions={
        <>
          <Badge tone="neutral" title="基准口径：美国国债 / 马来西亚 MGS / BNM OPR">
            10Y 利差 {macro.spread10y.toFixed(2)}%
          </Badge>
          <button
            type="button"
            onClick={onRefresh}
            title="刷新利率"
            className="inline-flex items-center gap-1 rounded-lg border border-line-2 px-2 py-1.5 font-mono text-[10.5px] text-dim transition hover:border-gold/50 hover:text-gold"
          >
            <RefreshCw className="size-3" />
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <YieldCurveChart macro={macro} />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <RateChip label="美国 2Y" value={macro.us2y} tone="gold" />
          <RateChip label="美国 10Y" value={macro.us10y} tone="gold" />
          <RateChip label="美国 30Y" value={macro.us30y} tone="gold" />
          <RateChip label="BNM OPR" value={macro.opr} tone="iris" />
          <RateChip label="MGS 3Y" value={macro.mgs3y} tone="ice" />
          <RateChip label="MGS 5Y" value={macro.mgs5y} tone="ice" />
          <RateChip label="MGS 10Y" value={macro.mgs10y} tone="ice" />
          <RateChip label="美债 10Y−MGS 10Y" value={macro.spread10y} tone="iris" />
        </div>

        <div>
          <div className="mb-2 font-mono text-[10.5px] font-medium tracking-[0.16em] text-gold/80 uppercase">
            利差对比（bp）
          </div>
          <div className="space-y-2.5">
            {spreads.map((spread) => (
              <SpreadRow key={spread.label} label={spread.label} value={spread.value} />
            ))}
          </div>
        </div>
      </div>
    </Panel>
  )
}

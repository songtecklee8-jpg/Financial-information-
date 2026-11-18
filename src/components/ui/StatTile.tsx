import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export type StatTone = 'neutral' | 'bull' | 'bear' | 'gold' | 'ice' | 'iris'

const VALUE_TONE: Record<StatTone, string> = {
  neutral: 'text-ink',
  bull: 'text-bull',
  bear: 'text-bear',
  gold: 'text-gold',
  ice: 'text-ice',
  iris: 'text-iris',
}

interface StatTileProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: StatTone
  className?: string
  /** 数值下方附加的说明 */
  footnote?: ReactNode
}

export function StatTile({ label, value, hint, tone = 'neutral', className, footnote }: StatTileProps) {
  return (
    <div
      className={cn(
        'panel-flat group relative min-w-0 px-2.5 py-2 transition-colors hover:border-line-2',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="truncate font-mono text-[10px] tracking-[0.1em] text-faint uppercase" title={label}>
          {label}
        </span>
        {hint && (
          <span className="shrink-0 cursor-help font-mono text-[10px] text-faint/80" title={String(hint)}>
            ⓘ
          </span>
        )}
      </div>
      <div className={cn('mt-1 truncate font-mono text-base leading-tight font-medium', VALUE_TONE[tone])}>
        {value}
      </div>
      {footnote && <div className="mt-0.5 truncate text-[10px] text-faint">{footnote}</div>}
    </div>
  )
}

/** 迷你行内指标：标签在左、数值在右 */
export function InlineStat({
  label,
  value,
  tone = 'neutral',
  className,
}: {
  label: ReactNode
  value: ReactNode
  tone?: StatTone
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-[3px]', className)}>
      <span className="truncate text-[11px] text-dim">{label}</span>
      <span className={cn('shrink-0 font-mono text-[11.5px] font-medium', VALUE_TONE[tone])}>{value}</span>
    </div>
  )
}

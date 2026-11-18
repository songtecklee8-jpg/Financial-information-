import { cn } from '@/lib/cn'

interface MeterBarProps {
  /** 0-100 */
  value: number
  className?: string
  /** 参考基准线（0-100），例如中性值 50 */
  marker?: number
  tone?: 'bull' | 'bear' | 'gold' | 'ice' | 'auto'
  height?: number
}

function colorFor(value: number, tone: MeterBarProps['tone']): string {
  if (tone && tone !== 'auto') {
    return `var(--color-${tone})`
  }
  if (value >= 62) return 'var(--color-bull)'
  if (value >= 42) return 'var(--color-gold)'
  return 'var(--color-bear)'
}

export function MeterBar({ value, className, marker, tone = 'auto', height = 4 }: MeterBarProps) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-full bg-line', className)}
      style={{ height }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${clamped}%`, background: colorFor(clamped, tone) }}
      />
      {marker !== undefined && (
        <span
          className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-faint/70"
          style={{ left: `${Math.max(0, Math.min(100, marker))}%` }}
        />
      )}
    </div>
  )
}

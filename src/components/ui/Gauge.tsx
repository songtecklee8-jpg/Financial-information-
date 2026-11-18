import { cn } from '@/lib/cn'

interface GaugeProps {
  /** 0-100 */
  value: number
  size?: number
  label?: string
  sublabel?: string
  className?: string
}

function toneOf(value: number): { stroke: string; text: string } {
  if (value >= 62) return { stroke: 'var(--color-bull)', text: 'text-bull' }
  if (value >= 42) return { stroke: 'var(--color-gold)', text: 'text-gold' }
  return { stroke: 'var(--color-bear)', text: 'text-bear' }
}

/** 0-100 综合评分环形仪表盘（270° 弧） */
export function Gauge({ value, size = 132, label, sublabel, className }: GaugeProps) {
  const clamped = Math.max(0, Math.min(100, value))
  const radius = 46
  const circumference = 2 * Math.PI * radius
  const arc = circumference * 0.75
  const tone = toneOf(clamped)

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-[225deg]">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={tone.stroke}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(arc * clamped) / 100} ${circumference}`}
          style={{ transition: 'stroke-dasharray 700ms cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className={cn('font-mono text-3xl leading-none font-semibold', tone.text)}>
          {Math.round(clamped)}
        </div>
        {label && (
          <div className="mt-1 font-mono text-[9px] tracking-[0.16em] text-faint uppercase">{label}</div>
        )}
        {sublabel && <div className={cn('mt-0.5 text-[11px] font-medium', tone.text)}>{sublabel}</div>}
      </div>
    </div>
  )
}

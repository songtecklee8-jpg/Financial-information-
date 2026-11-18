import type { MacroRates } from '@/types'

interface YieldCurveChartProps {
  macro: MacroRates
  className?: string
}

const MATURITIES = [2, 3, 5, 10, 30] as const

const US_POINTS: Array<[number, keyof MacroRates]> = [
  [2, 'us2y'],
  [10, 'us10y'],
  [30, 'us30y'],
]

const MGS_POINTS: Array<[number, keyof MacroRates]> = [
  [3, 'mgs3y'],
  [5, 'mgs5y'],
  [10, 'mgs10y'],
]

const WIDTH = 420
const HEIGHT = 190
const PAD = { top: 16, right: 16, bottom: 26, left: 34 }

/** 对数化的期限轴：短端更离散，便于观察 2Y-10Y 的形态 */
function xScale(maturity: number): number {
  const min = Math.log(MATURITIES[0])
  const max = Math.log(MATURITIES[MATURITIES.length - 1])
  const ratio = (Math.log(maturity) - min) / (max - min)
  return PAD.left + ratio * (WIDTH - PAD.left - PAD.right)
}

export function YieldCurveChart({ macro, className }: YieldCurveChartProps) {
  const values = [
    macro.us2y,
    macro.us10y,
    macro.us30y,
    macro.mgs3y,
    macro.mgs5y,
    macro.mgs10y,
    macro.opr,
  ]
  const min = Math.min(...values) - 0.25
  const max = Math.max(...values) + 0.25
  const yScale = (rate: number): number =>
    HEIGHT - PAD.bottom - ((rate - min) / (max - min)) * (HEIGHT - PAD.top - PAD.bottom)

  const buildPath = (points: Array<[number, keyof MacroRates]>) =>
    points
      .map(([maturity, key], index) => {
        const x = xScale(maturity).toFixed(1)
        const y = yScale(Number(macro[key])).toFixed(1)
        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
      })
      .join(' ')

  const gridValues: number[] = []
  const step = max - min > 1.6 ? 0.5 : 0.25
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) {
    gridValues.push(Number(value.toFixed(2)))
  }

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" style={{ maxHeight: 210 }}>
        {gridValues.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={yScale(value)}
              y2={yScale(value)}
              stroke="var(--color-line)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={yScale(value) + 3}
              textAnchor="end"
              className="fill-faint font-mono"
              style={{ fontSize: 8 }}
            >
              {value.toFixed(2)}
            </text>
          </g>
        ))}

        {MATURITIES.map((maturity) => (
          <text
            key={maturity}
            x={xScale(maturity)}
            y={HEIGHT - 8}
            textAnchor="middle"
            className="fill-faint font-mono"
            style={{ fontSize: 8.5 }}
          >
            {maturity}Y
          </text>
        ))}

        {/* OPR 政策利率参考线 */}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={yScale(macro.opr)}
          y2={yScale(macro.opr)}
          stroke="var(--color-iris)"
          strokeWidth="1"
          strokeDasharray="5 4"
        />
        <text
          x={WIDTH - PAD.right}
          y={yScale(macro.opr) - 4}
          textAnchor="end"
          className="fill-iris font-mono"
          style={{ fontSize: 8.5 }}
        >
          OPR {macro.opr.toFixed(2)}%
        </text>

        <path d={buildPath(MGS_POINTS)} fill="none" stroke="var(--color-ice)" strokeWidth="2" strokeLinecap="round" />
        <path d={buildPath(US_POINTS)} fill="none" stroke="var(--color-gold)" strokeWidth="2" strokeLinecap="round" />

        {MGS_POINTS.map(([maturity, key]) => (
          <circle
            key={`mgs-${maturity}`}
            cx={xScale(maturity)}
            cy={yScale(Number(macro[key]))}
            r="3"
            fill="var(--color-void)"
            stroke="var(--color-ice)"
            strokeWidth="2"
          />
        ))}
        {US_POINTS.map(([maturity, key]) => (
          <circle
            key={`us-${maturity}`}
            cx={xScale(maturity)}
            cy={yScale(Number(macro[key]))}
            r="3"
            fill="var(--color-void)"
            stroke="var(--color-gold)"
            strokeWidth="2"
          />
        ))}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-dim">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[2px] w-4 bg-gold" /> 美国国债
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[2px] w-4 bg-ice" /> 马来西亚 MGS
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[2px] w-4 border-t border-dashed border-iris" /> BNM OPR
        </span>
      </div>
    </div>
  )
}

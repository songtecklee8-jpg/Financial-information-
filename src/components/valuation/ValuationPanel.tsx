import type { ReactNode } from 'react'
import { Calculator, Info } from 'lucide-react'

import type { AiVerdict, Fundamentals, Security, ValuationResult } from '@/types'
import { AiVerdictCard } from '@/components/valuation/AiVerdictCard'
import { Badge } from '@/components/ui/Badge'
import { MeterBar } from '@/components/ui/MeterBar'
import { Panel } from '@/components/ui/Panel'
import { cn } from '@/lib/cn'
import { formatCompact, formatPercent, formatPrice, formatRatio } from '@/lib/format'
import { localVerdict } from '@/lib/gemini'
import { scoreTone } from '@/lib/valuation'

interface ValuationPanelProps {
  security: Security
  fundamentals: Fundamentals
  valuation: ValuationResult
  aiVerdict: AiVerdict | null
  aiRunning: boolean
  aiError: string | null
  hasGemini: boolean
  onRunAi: () => void
  onOpenSettings: () => void
}

type Tone = 'bull' | 'bear' | 'gold' | 'ice' | 'neutral'

const VALUE_TONE: Record<Tone, string> = {
  bull: 'text-bull',
  bear: 'text-bear',
  gold: 'text-gold',
  ice: 'text-ice',
  neutral: 'text-ink',
}

function MetricCard({
  label,
  value,
  hint,
  delta,
  footnote,
}: {
  label: string
  value: ReactNode
  hint?: string
  delta?: { text: string; tone: Tone }
  footnote?: ReactNode
}) {
  return (
    <div className="panel-flat min-w-0 px-2.5 py-2 transition-colors hover:border-line-2">
      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate font-mono text-[10px] tracking-[0.08em] text-faint uppercase" title={label}>
          {label}
        </span>
        {hint && (
          <span className="shrink-0 cursor-help font-mono text-[10px] text-faint/80" title={hint}>
            ⓘ
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-[15px] leading-tight font-medium text-ink">{value}</span>
        {delta && (
          <span className={cn('shrink-0 font-mono text-[10.5px] font-medium', VALUE_TONE[delta.tone])}>
            {delta.text}
          </span>
        )}
      </div>
      {footnote && <div className="mt-0.5 truncate text-[10px] text-faint">{footnote}</div>}
    </div>
  )
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="font-mono text-[10.5px] font-medium tracking-[0.16em] text-gold/80 uppercase">
        {children}
      </h3>
      {action}
    </div>
  )
}

/** 理论合理股价区间条：低区—中枢—高区，并标注当前价格分位 */
function FairValueBand({ valuation }: { valuation: ValuationResult }) {
  const { fairValueLow: low, fairValueHigh: high, fairValueMid: mid, currentPrice: price, currency } =
    valuation
  const span = high - low || 1
  const min = Math.min(low, price) - span * 0.12
  const max = Math.max(high, price) + span * 0.12
  const pct = (value: number) => ((value - min) / (max - min)) * 100

  const bandLeft = pct(low)
  const bandWidth = pct(high) - bandLeft
  const pricePct = Math.max(0, Math.min(100, pct(price)))
  const cheap = price < mid

  return (
    <div className="panel-flat px-3 py-3">
      <div className="flex items-center justify-between font-mono text-[10px] text-faint">
        <span>理论合理股价区间</span>
        <span className={cn('font-medium', cheap ? 'text-bull' : 'text-bear')}>
          {price < low ? '低于合理区间' : price > high ? '高于合理区间' : '落在合理区间内'}
        </span>
      </div>

      <div className="relative mt-4 mb-5 h-2.5 w-full rounded-full bg-line/70">
        <div
          className="absolute inset-y-0 rounded-full bg-gradient-to-r from-bull/45 via-gold/45 to-bear/45"
          style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
        />
        <div
          className="absolute -top-0.5 h-3.5 w-px bg-ink/70"
          style={{ left: `${pct(mid)}%` }}
          title={`中枢 ${formatPrice(mid, currency)}`}
        />
        <div
          className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ left: `${pricePct}%` }}
        >
          <span className="absolute -top-4 font-mono text-[9px] whitespace-nowrap text-ink">
            {formatPrice(price, currency)}
          </span>
          <span className="size-3 rounded-full border-2 border-abyss bg-gold shadow" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="font-mono text-[9px] tracking-[0.08em] text-faint uppercase">低估区</div>
          <div className="font-mono text-[12px] text-bull">{formatPrice(low, currency)}</div>
        </div>
        <div>
          <div className="font-mono text-[9px] tracking-[0.08em] text-faint uppercase">估值中枢</div>
          <div className="font-mono text-[12px] text-gold">{formatPrice(mid, currency)}</div>
        </div>
        <div>
          <div className="font-mono text-[9px] tracking-[0.08em] text-faint uppercase">高估区</div>
          <div className="font-mono text-[12px] text-bear">{formatPrice(high, currency)}</div>
        </div>
      </div>
    </div>
  )
}

export function ValuationPanel({
  security,
  fundamentals,
  valuation: v,
  aiVerdict,
  aiRunning,
  aiError,
  hasGemini,
  onRunAi,
  onOpenSettings,
}: ValuationPanelProps) {
  const resolved = aiVerdict ?? localVerdict(v, security)
  const isAi = Boolean(aiVerdict)

  const peDeltaTone: Tone = v.pePremiumPct > 0 ? 'bear' : 'bull'
  const mosTone: Tone = v.marginOfSafetyPct >= 0 ? 'bull' : 'bear'

  return (
    <Panel
      eyebrow="Equity / Valuation Engine"
      title="深度估值诊断"
      subtitle={`${security.symbol} · ${security.name} · ${security.sector}`}
      actions={
        <Badge tone="neutral" title="综合评分越高代表越具投资价值">
          评分 {v.score}/100
        </Badge>
      }
    >
      <div className="space-y-4">
        <AiVerdictCard
          security={security}
          verdict={resolved}
          isAi={isAi}
          running={aiRunning}
          error={aiError}
          hasGemini={hasGemini}
          onRun={onRunAi}
          onOpenSettings={onOpenSettings}
        />

        <div>
          <SectionTitle>估值指标</SectionTitle>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <MetricCard
              label="当前 PE vs 5 年均值"
              value={formatRatio(v.currentPE, 1)}
              hint="TTM 市盈率；5 年均值来自终端基准估值中枢"
              delta={
                Number.isFinite(v.pePremiumPct)
                  ? {
                      text: `${v.pePremiumPct >= 0 ? '溢价 +' : '折价 '}${v.pePremiumPct.toFixed(1)}%`,
                      tone: peDeltaTone,
                    }
                  : undefined
              }
              footnote={Number.isFinite(v.avgPE5y) ? `5 年均值 ${v.avgPE5y.toFixed(1)}x` : '5 年均值 N/A'}
            />
            <MetricCard
              label="市净率 PB"
              value={formatRatio(v.pb, 2)}
              hint="当前价 / 每股净资产"
              footnote={`BVPS ${fundamentals.bookValuePerShare.toFixed(2)}`}
            />
            <MetricCard
              label="PEG 比率"
              value={formatRatio(v.peg, 2)}
              hint="PE / 近 5 年 EPS 复合增速，<1 通常视为成长性估值合理"
              delta={
                Number.isFinite(v.peg)
                  ? { text: v.peg < 1 ? '偏低' : v.peg < 2 ? '中性' : '偏高', tone: v.peg < 1 ? 'bull' : v.peg < 2 ? 'gold' : 'bear' }
                  : undefined
              }
              footnote={`EPS 增速 ${formatPercent(fundamentals.epsGrowth5y, { digits: 1 })}`}
            />
            <MetricCard
              label="EV / EBITDA"
              value={Number.isFinite(v.evEbitda) ? `${v.evEbitda.toFixed(1)}x` : 'N/A'}
              hint="企业价值倍数（金融板块不适用）"
              footnote={Number.isFinite(v.evEbitda) ? `市值 ${formatCompact(fundamentals.marketCap)}` : '金融板块不适用'}
            />
          </div>
        </div>

        <div>
          <SectionTitle>盈利与分红</SectionTitle>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <MetricCard
              label="ROE 净资产收益率"
              value={formatPercent(v.roe, { digits: 1 })}
              hint="净利润 / 净资产"
              delta={{
                text: v.roe >= 15 ? '优质' : v.roe >= 8 ? '合理' : '偏弱',
                tone: v.roe >= 15 ? 'bull' : v.roe >= 8 ? 'gold' : 'bear',
              }}
            />
            <MetricCard
              label="毛利率"
              value={Number.isFinite(v.grossMargin) ? formatPercent(v.grossMargin, { digits: 1 }) : 'N/A'}
              hint="毛利 / 营业收入（金融板块不适用）"
              footnote={`净利率 ${formatPercent(fundamentals.netMargin, { digits: 1 })}`}
            />
            <MetricCard
              label="股息率 (Dividend Yield)"
              value={formatPercent(v.dividendYield, { digits: 2 })}
              hint="每股股息 / 当前股价"
              delta={v.dividendYield > 0 ? undefined : { text: '无派息', tone: 'neutral' }}
              footnote={
                fundamentals.dividendPerShare > 0
                  ? `DPS ${fundamentals.dividendPerShare.toFixed(3)} · 派息率 ${formatPercent(fundamentals.payoutRatio, { digits: 0 })}`
                  : '当前无现金派息'
              }
            />
            <MetricCard
              label="自由现金流收益率"
              value={formatPercent(fundamentals.fcfYield, { digits: 2 })}
              hint="自由现金流 / 市值"
              footnote={`FCF ${formatCompact(fundamentals.freeCashFlow)}`}
            />
            <MetricCard
              label="净利率"
              value={formatPercent(fundamentals.netMargin, { digits: 1 })}
              hint="净利润 / 营业收入"
              footnote={`净利润 ${formatCompact(fundamentals.netIncomeTTM)}`}
            />
            <MetricCard
              label="资产负债率 (D/E)"
              value={fundamentals.debtToEquity.toFixed(2)}
              hint="总负债 / 股东权益"
              delta={{
                text: fundamentals.debtToEquity <= 1 ? '稳健' : fundamentals.debtToEquity <= 2 ? '中性' : '偏高',
                tone: fundamentals.debtToEquity <= 1 ? 'bull' : fundamentals.debtToEquity <= 2 ? 'gold' : 'bear',
              }}
            />
          </div>
        </div>

        <div>
          <SectionTitle
            action={
              <span className="font-mono text-[10px] text-faint">
                安全边际{' '}
                <span className={cn('font-medium', VALUE_TONE[mosTone])}>
                  {formatPercent(v.marginOfSafetyPct, { signed: true })}
                </span>
              </span>
            }
          >
            算法内在价值
          </SectionTitle>

          <div className="space-y-2.5">
            <FairValueBand valuation={v} />

            <div className="grid gap-2 sm:grid-cols-3">
              <MetricCard
                label="格雷厄姆数字"
                value={Number.isFinite(v.grahamNumber) ? v.grahamNumber.toFixed(2) : 'N/A'}
                hint="√(22.5 × EPS × BVPS) —— 资产与盈利的毛估法"
                footnote="Graham Number"
              />
              <MetricCard
                label="历史中枢回归"
                value={Number.isFinite(v.meanReversionValue) ? v.meanReversionValue.toFixed(2) : 'N/A'}
                hint="5 年平均 PE × TTM EPS，衡量均值回归的价值锚"
                footnote="5Y PE × EPS"
              />
              <MetricCard
                label="行业相对价值"
                value={Number.isFinite(v.industryRelativeValue) ? v.industryRelativeValue.toFixed(2) : 'N/A'}
                hint="行业平均 PE × TTM EPS，衡量相对同业估值"
                footnote={`行业 PE ${security.industryPE.toFixed(1)}x`}
              />
            </div>
          </div>
        </div>

        <div>
          <SectionTitle
            action={
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-faint">
                <Calculator className="size-3" /> 7 因子加权
              </span>
            }
          >
            评分因子拆解
          </SectionTitle>
          <div className="space-y-2">
            {v.factors.map((factor) => (
              <div key={factor.key} className="panel-flat px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[11.5px] text-ink">{factor.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-[10.5px] text-dim">{factor.display}</span>
                    <span className={cn('font-mono text-[11px] font-medium', scoreTone(factor.score))}>
                      {Math.round(factor.score)}
                    </span>
                    <span className="font-mono text-[9.5px] text-faint">
                      权重 {Math.round(factor.weight * 100)}%
                    </span>
                  </span>
                </div>
                <MeterBar value={factor.score} marker={50} className="mt-1.5" height={3} />
                <p className="mt-1.5 text-[11px] leading-relaxed text-faint">{factor.comment}</p>
              </div>
            ))}
          </div>
        </div>

        {v.notes.length > 0 && (
          <div className="panel-flat space-y-1.5 px-3 py-2.5">
            <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-gold/80 uppercase">
              <Info className="size-3" /> 模型说明与风险提示
            </div>
            {v.notes.map((note, index) => (
              <p key={index} className="text-[11px] leading-relaxed text-faint">
                · {note}
              </p>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}

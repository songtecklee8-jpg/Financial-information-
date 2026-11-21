import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Building,
  ChartColumn,
  Coins,
  ExternalLink,
  Landmark,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Zap,
} from 'lucide-react'

import type { ApiSettings, AssetImpact, AssetKey, ImpactDirection, NewsArticle, NewsImpact } from '@/types'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { formatRelayBadge, hasAnyAiConfigured } from '@/lib/aiFallback'
import { cn } from '@/lib/cn'
import { formatRelativeTime } from '@/lib/format'
import { aiRoute, runNewsImpact } from '@/lib/gemini'

interface NewsImpactPanelProps {
  article: NewsArticle
  settings: ApiSettings
  onClose: () => void
}

const ASSET_ICON: Record<AssetKey, typeof ChartColumn> = {
  equities: ChartColumn,
  bonds: Landmark,
  realEstate: Building,
  gold: Coins,
  volatility: Zap,
}

const DIRECTION_META: Record<ImpactDirection, { label: string; className: string }> = {
  bullish: { label: '看涨', className: 'border-bull/40 bg-bull/10 text-bull' },
  bearish: { label: '看跌', className: 'border-bear/40 bg-bear/10 text-bear' },
  neutral: { label: '震荡', className: 'border-gold/40 bg-gold/10 text-gold' },
}

export function AssetRow({ impact }: { impact: AssetImpact }) {
  const Icon = ASSET_ICON[impact.asset]
  const direction = DIRECTION_META[impact.direction]
  return (
    <div className="grid grid-cols-1 gap-2.5 rounded-lg border border-line bg-panel-2/70 p-2.5 sm:grid-cols-[150px_1fr]">
      <div className="flex items-start justify-between gap-2 sm:block">
        <div className="flex items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-gold/80" />
          <span className="text-[12px] font-medium text-ink">{impact.label}</span>
        </div>
        <span
          className={cn(
            'mt-0 shrink-0 rounded-full border px-2 py-[2px] font-mono text-[10px] font-medium sm:mt-1.5 sm:inline-block',
            direction.className,
          )}
        >
          {direction.label}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between font-mono text-[10.5px]">
          <span className="text-bull">上涨 {impact.up}%</span>
          <span className="text-bear">下跌 {impact.down}%</span>
        </div>
        <div className="mt-1 flex h-2.5 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full bg-bull transition-[width] duration-700 ease-out"
            style={{ width: `${impact.up}%` }}
          />
          <div
            className="h-full bg-bear transition-[width] duration-700 ease-out"
            style={{ width: `${impact.down}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-dim">{impact.driver}</p>
        {impact.detail && (
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-faint">{impact.detail}</p>
        )}
      </div>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-flat px-2.5 py-2">
      <div className="font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">{label}</div>
      <p className="mt-1 text-[11px] leading-relaxed text-dim">{value}</p>
    </div>
  )
}

export function NewsImpactPanel({ article, settings, onClose }: NewsImpactPanelProps) {
  const [impact, setImpact] = useState<NewsImpact | null>(null)
  const [loading, setLoading] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  const hasAi = hasAnyAiConfigured(settings)

  const run = useMemo(
    () =>
      (tier: 'flash' | 'pro' = 'flash') => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller
        setLoading(true)
        setImpact(null)
        runNewsImpact(article, settings.geminiKey, aiRoute(settings, tier), controller.signal)
          .then((result) => {
            if (controller.signal.aborted) return
            setImpact(result)
          })
          .catch(() => {
            if (controller.signal.aborted) return
            setImpact(null)
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false)
          })
      },
    [article, settings],
  )

  // 打开即自动运行一次推演
  useEffect(() => {
    run('flash')
    return () => abortRef.current?.abort()
  }, [run])

  const headline = article.titleZh ?? article.title

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-gold" />
          AI 跨市场深度推演
        </span>
      }
      subtitle="点击新闻后自动调用 Gemini 进行结构化金融推演：核心事件拆解 + 五大核心资产涨跌概率"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10.5px] text-faint">
          <span className="flex flex-wrap items-center gap-2">
            {impact?.degraded ? (
              <Badge tone="neutral" title="未配置 AI Key 或均不可用，当前为本地启发式推演">
                本地启发式
              </Badge>
            ) : (
              <Badge tone="gold" dot>
                {hasAi ? 'AI 推演' : '本地推演'}
              </Badge>
            )}
            {impact && (
              <span title={`实际执行模型：${impact.model}`}>
                {formatRelayBadge(impact.model)}
              </span>
            )}
            {impact && <span>置信度 {impact.confidence}%</span>}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => run('pro')}
              disabled={loading || !hasAi}
              className="inline-flex items-center gap-1 rounded-lg border border-iris/40 bg-iris/10 px-2.5 py-1.5 text-iris transition hover:bg-iris/20 disabled:opacity-45"
            >
              <Sparkles className="size-3" />
              Pro 深度推演
            </button>
            <button
              type="button"
              onClick={() => run('flash')}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-lg border border-line-2 px-2.5 py-1.5 text-dim transition hover:border-gold/50 hover:text-gold disabled:opacity-50"
            >
              {loading ? <LoaderCircle className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              重新推演
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line-2 px-3 py-1.5 text-dim transition hover:text-ink"
            >
              关闭
            </button>
          </span>
        </div>
      }
    >
      <div className="space-y-3">
        {/* 新闻标题与来源 */}
        <div className="rounded-lg border border-line bg-void/50 px-3 py-2.5">
          <p className="text-[13px] leading-snug font-medium text-ink">{headline}</p>
          {article.titleZh && article.titleZh !== article.title && (
            <p className="mt-1 text-[10.5px] leading-relaxed text-faint">{article.title}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-faint">
            <span>{article.sourceName}</span>
            <span>·</span>
            <span>{formatRelativeTime(article.publishedAt)}</span>
            {article.url && article.url !== '#' && (
              <a
                href={article.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-0.5 text-gold/90 hover:text-gold"
              >
                原文 <ExternalLink className="size-2.5" />
              </a>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-2 py-14 text-faint">
            <LoaderCircle className="size-5 animate-spin" />
            <p className="font-mono text-[11px]">Gemini 正在推演跨市场传导路径…</p>
          </div>
        ) : !impact ? (
          <div className="flex flex-col items-center gap-2 py-14 text-faint">
            <Activity className="size-5" />
            <p className="font-mono text-[11px]">推演暂不可用，请稍后重试</p>
          </div>
        ) : (
          <>
            {/* 核心事件拆解与传导逻辑 */}
            <div className="space-y-2">
              <div className="panel-flat px-3 py-2.5">
                <div className="font-mono text-[9.5px] tracking-[0.14em] text-gold/80 uppercase">
                  核心事件拆解
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-dim">{impact.eventBreakdown}</p>
              </div>
              <div className="panel-flat px-3 py-2.5">
                <div className="font-mono text-[9.5px] tracking-[0.14em] text-gold/80 uppercase">
                  跨市场传导逻辑
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-dim">{impact.transmission}</p>
              </div>
            </div>

            {/* 流动性 / 利率 / 行业 */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <InfoCard label="宏观流动性" value={impact.liquidity} />
              <InfoCard label="利率预期" value={impact.rateExpectation} />
              <InfoCard label="行业基本面" value={impact.sectorImpact} />
            </div>

            {/* 五大资产涨跌概率仪表盘 */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <ChartColumn className="size-3.5 text-gold/80" />
                <h3 className="font-mono text-[11px] font-medium tracking-[0.14em] text-dim uppercase">
                  五大核心资产 · 上涨 vs 下跌概率
                </h3>
              </div>
              <div className="space-y-2">
                {impact.assets.map((asset) => (
                  <AssetRow key={asset.asset} impact={asset} />
                ))}
              </div>
            </div>

            {/* 关注清单 */}
            {impact.watchlist.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] tracking-[0.1em] text-faint uppercase">
                  值得关注
                </span>
                {impact.watchlist.map((ticker) => (
                  <span
                    key={ticker}
                    className="rounded border border-line bg-void/60 px-1.5 py-[2px] font-mono text-[10px] text-dim"
                  >
                    {ticker}
                  </span>
                ))}
              </div>
            )}

            <p className="border-t border-line/60 pt-2 text-[10px] leading-relaxed text-faint">
              以上为 AI 基于公开资讯的概率化推演，不构成任何投资建议；概率之和恒为 100%。
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}

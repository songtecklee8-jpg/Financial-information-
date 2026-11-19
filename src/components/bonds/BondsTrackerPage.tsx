import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  KeyRound,
  Landmark,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

import type {
  ApiSettings,
  BondAuctionAnalysis,
  BondAuctionItem,
  BondsPayload,
} from '@/types'
import { Badge } from '@/components/ui/Badge'
import { Panel } from '@/components/ui/Panel'
import { StatTile } from '@/components/ui/StatTile'
import { analyzeBondAuctions, fetchBondsTracker } from '@/lib/cloud'
import {
  analyzeBondAuctionsBrowser,
  fetchBondsTrackerBrowser,
} from '@/lib/earningsBondsClient'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { modelDisplayName } from '@/lib/gemini'

interface BondsTrackerPageProps {
  settings: ApiSettings
  onOpenSettings: () => void
}

type BondFilter = 'all' | 'MGS' | 'MGII' | 'upcoming' | 'completed'

const STATUS_META: Record<
  BondAuctionItem['status'],
  { label: string; tone: 'gold' | 'ice' | 'bull' }
> = {
  upcoming: { label: '即将拍卖', tone: 'gold' },
  announced: { label: '已公告发行', tone: 'ice' },
  completed: { label: '已完成拍卖', tone: 'bull' },
}

export function BondsTrackerPage({ settings, onOpenSettings }: BondsTrackerPageProps) {
  const [data, setData] = useState<BondsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<BondFilter>('all')

  const [analysis, setAnalysis] = useState<BondAuctionAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  const hasGemini = settings.geminiKey.trim().length > 0

  const loadBonds = useCallback(
    async (refresh = false) => {
      setLoading(true)
      setError(null)
      const payload =
        (await fetchBondsTracker(settings, refresh)) ??
        (await fetchBondsTrackerBrowser())
      setData(payload)
      setLoading(false)
    },
    [settings],
  )

  useEffect(() => {
    void loadBonds(false)
  }, [loadBonds])

  const runAnalysis = useCallback(async () => {
    if (!data || analyzing) return
    setAnalyzing(true)
    const result =
      (await analyzeBondAuctions(data.benchmarks, data.auctions, settings)) ??
      (await analyzeBondAuctionsBrowser(data.benchmarks, data.auctions, settings))
    setAnalysis(result)
    setAnalyzing(false)
  }, [data, analyzing, settings])

  const filteredAuctions = useMemo(() => {
    const rows = data?.auctions ?? []
    return rows.filter((row) => {
      if (filter === 'MGS') return row.instrument === 'MGS'
      if (filter === 'MGII') return row.instrument === 'MGII'
      if (filter === 'upcoming') return row.status !== 'completed'
      if (filter === 'completed') return row.status === 'completed'
      return true
    })
  }, [data?.auctions, filter])

  const upcomingStats = useMemo(() => {
    const pending = (data?.auctions ?? []).filter((a) => a.status !== 'completed')
    const totalB = pending.reduce(
      (sum, item) => sum + item.estimatedSizeMyrB + (item.privatePlacementMyrB ?? 0),
      0,
    )
    return { count: pending.length, totalB }
  }, [data?.auctions])

  const curvePoints = useMemo(() => {
    if (!data) return []
    const b = data.benchmarks
    return [
      { label: 'MGS 3Y', value: b.mgs3y, tone: 'bg-ice/75' },
      { label: 'MGS 5Y', value: b.mgs5y, tone: 'bg-ice/85' },
      { label: 'MGS 10Y', value: b.mgs10y, tone: 'bg-gold' },
      { label: 'MGS 15Y', value: b.mgs15y, tone: 'bg-iris/80' },
      { label: 'MGS 30Y', value: b.mgs30y, tone: 'bg-iris' },
      { label: 'US 10Y', value: b.us10y, tone: 'bg-bull/80' },
    ]
  }, [data])

  return (
    <main className="mx-auto w-full max-w-[1800px] flex-1 space-y-3 px-3 pt-3 pb-24 sm:px-4">
      {/* 顶部标题区 */}
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Landmark className="size-4 text-ice" />
            <h1 className="text-[14px] font-semibold tracking-wide text-ink">
              固收与马来西亚国债看板 · MGS / MGII Auction &amp; Benchmark Tracker
            </h1>
            {data && (
              <>
                <Badge tone={data.origin === 'live' ? 'bull' : 'neutral'} dot>
                  {data.origin === 'live' ? 'BNM Open API LIVE' : 'BNM 基准日历'}
                </Badge>
                {data.model && (
                  <Badge tone="iris" title={`校验模型：${data.model}`}>
                    Powered by {modelDisplayName(data.model)}
                  </Badge>
                )}
              </>
            )}
          </div>
          <p className="mt-1 font-mono text-[10.5px] text-faint">
            {data?.sourceLabel ?? 'BNM Open API · Bond Info Hub · 美马 10Y 国债收益率利差实时追踪'}
            {data ? ` · 更新于 ${formatDateTime(data.updatedAt)}` : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadBonds(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-2 bg-panel-2 px-3 py-1.5 font-mono text-[11px] text-dim transition hover:border-ice/50 hover:text-ice disabled:opacity-50"
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          刷新 BNM 数据
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-bear/40 bg-bear/10 px-4 py-2.5 font-mono text-[11.5px] text-bear">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="panel flex items-center justify-center gap-2 py-16 font-mono text-[12px] text-dim">
          <LoaderCircle className="size-4 animate-spin text-ice" />
          正在连接 BNM Open API 获取 OPR、USD/MYR 与 MGS / MGII 发债日历…
        </div>
      ) : data ? (
        <>
          {/* 核心国债与利率 KPI 条 */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile
              label="MGS 10Y 基准收益率"
              value={`${data.benchmarks.mgs10y.toFixed(2)}%`}
              footnote={`3Y ${data.benchmarks.mgs3y.toFixed(2)}% · 30Y ${data.benchmarks.mgs30y.toFixed(2)}%`}
              tone="gold"
            />
            <StatTile
              label="BNM OPR 政策利率"
              value={`${data.benchmarks.opr.toFixed(2)}%`}
              footnote={`生效 ${data.benchmarks.oprDate} · 隔夜 ${data.benchmarks.interbankOvernight.toFixed(2)}%`}
              tone="iris"
            />
            <StatTile
              label="US 10Y − MGS 10Y 利差"
              value={`${data.benchmarks.spread10y >= 0 ? '+' : ''}${(data.benchmarks.spread10y * 100).toFixed(0)} bp`}
              footnote={`美债 10Y 报 ${data.benchmarks.us10y.toFixed(2)}%`}
              tone={data.benchmarks.spread10y > 0.8 ? 'bear' : 'bull'}
            />
            <StatTile
              label="USD / MYR 汇率"
              value={data.benchmarks.usdMyr.toFixed(4)}
              footnote="BNM 参考中间价"
              tone="ice"
            />
            <StatTile
              label="待拍卖发行总规模"
              value={`RM ${upcomingStats.totalB.toFixed(1)}B`}
              footnote={`${upcomingStats.count} 场 MGS / MGII 计划中`}
              tone="neutral"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
            {/* 左侧：MGS / MGII 拍卖日历 */}
            <Panel
              eyebrow="BNM Auction Schedule"
              title="马来西亚政府发债与拍卖日历（MGS / MGII）"
              subtitle="涵盖传统国债（MGS）与伊斯兰政府投资票据（MGII）重开及新发计划"
              className="xl:col-span-8"
              actions={
                <div className="flex flex-wrap items-center gap-1">
                  {(
                    [
                      { key: 'all', label: '全部' },
                      { key: 'MGS', label: 'MGS 传统' },
                      { key: 'MGII', label: 'MGII 伊斯兰' },
                      { key: 'upcoming', label: '即将拍卖' },
                      { key: 'completed', label: '已完成' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setFilter(tab.key)}
                      className={cn(
                        'rounded-md border px-2 py-1 font-mono text-[10px] transition',
                        filter === tab.key
                          ? 'border-ice/50 bg-ice/12 text-ice'
                          : 'border-line text-dim hover:border-line-2 hover:text-ink',
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left font-mono text-[11.5px]">
                  <thead>
                    <tr className="border-b border-line text-[10px] tracking-[0.1em] text-faint uppercase">
                      <th className="py-2 pr-2 font-medium">券种 / 期限</th>
                      <th className="py-2 pr-2 font-medium">发债系列与代码</th>
                      <th className="py-2 pr-2 font-medium">招标 / 发行日</th>
                      <th className="py-2 pr-2 text-right font-medium">拟发行规模</th>
                      <th className="py-2 pr-2 text-right font-medium">票息 / 均息</th>
                      <th className="py-2 text-right font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {filteredAuctions.map((item) => {
                      const status = STATUS_META[item.status]
                      const totalSize = item.estimatedSizeMyrB + (item.privatePlacementMyrB ?? 0)
                      return (
                        <tr key={item.id} className="transition-colors hover:bg-panel-2/60">
                          <td className="py-2.5 pr-2 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <Badge tone={item.instrument === 'MGS' ? 'ice' : 'iris'}>
                                {item.instrument}
                              </Badge>
                              <span className="font-semibold text-ink">{item.tenorYears}Y</span>
                            </div>
                          </td>
                          <td className="py-2.5 pr-2">
                            <div className="font-sans text-[12px] font-medium text-ink">
                              {item.series}
                            </div>
                            <div className="text-[10px] text-faint">
                              {item.issueCode} · {item.reopening ? '重开发行 Reopening' : '新发 New Issue'} · 到期 {item.maturityDate}
                            </div>
                          </td>
                          <td className="py-2.5 pr-2 whitespace-nowrap">
                            <div className="text-ink">{item.auctionDate}</div>
                            <div className="text-[10px] text-faint">交割 {item.issueDate}</div>
                          </td>
                          <td className="py-2.5 pr-2 text-right whitespace-nowrap">
                            <div className="font-semibold text-gold">RM {totalSize.toFixed(1)}B</div>
                            {item.privatePlacementMyrB ? (
                              <div className="text-[10px] text-faint">
                                公开 {item.estimatedSizeMyrB.toFixed(1)}B + 私募 {item.privatePlacementMyrB.toFixed(1)}B
                              </div>
                            ) : (
                              <div className="text-[10px] text-faint">全部公开招标</div>
                            )}
                          </td>
                          <td className="py-2.5 pr-2 text-right whitespace-nowrap">
                            <div className="text-ink">
                              {item.yieldAvg !== undefined
                                ? `均息 ${item.yieldAvg.toFixed(2)}%`
                                : item.couponRate !== undefined
                                  ? `票息 ${item.couponRate.toFixed(2)}%`
                                  : '—'}
                            </div>
                            {item.bidToCover !== undefined && (
                              <div className="text-[10px] text-bull">BTC {item.bidToCover.toFixed(2)}x</div>
                            )}
                          </td>
                          <td className="py-2.5 text-right whitespace-nowrap">
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* 右侧：收益率曲线对比 + AI 固收拍卖策略研判 */}
            <div className="space-y-3 xl:col-span-4">
              <Panel
                eyebrow="Benchmark Yield Curve"
                title="MGS 收益率曲线基准"
                subtitle="基于实时 BNM OPR 锚定各期限基准利率并与美债 10Y 对照"
              >
                <div className="space-y-2.5">
                  {curvePoints.map((pt) => {
                    const widthPct = Math.min(100, Math.max(15, (pt.value / 5.5) * 100))
                    return (
                      <div key={pt.label}>
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span className="text-dim">{pt.label}</span>
                          <span className="font-semibold text-ink">{pt.value.toFixed(2)}%</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line/70">
                          <div className={cn('h-full rounded-full', pt.tone)} style={{ width: `${widthPct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Panel>

              <Panel
                eyebrow="Gemini Multi-Model Fixed Income Desk"
                title="AI 国债拍卖与利率研判"
                subtitle="遵循 Pro → Flash → Flash-Lite 自动降级熔断保护"
                actions={
                  <div className="flex items-center gap-1.5">
                    {!hasGemini && (
                      <button
                        type="button"
                        onClick={onOpenSettings}
                        className="inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-2 py-1 font-mono text-[10px] text-gold transition hover:bg-gold/20"
                      >
                        <KeyRound className="size-3" /> 配置 Key
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void runAnalysis()}
                      disabled={analyzing}
                      className="inline-flex items-center gap-1 rounded-md border border-iris/45 bg-iris/15 px-2.5 py-1 font-mono text-[10.5px] text-iris transition hover:bg-iris/25 disabled:opacity-50"
                    >
                      {analyzing ? (
                        <LoaderCircle className="size-3 animate-spin" />
                      ) : (
                        <Sparkles className="size-3" />
                      )}
                      {analysis ? '重新研判' : '生成 AI 研判'}
                    </button>
                  </div>
                }
              >
                {analyzing ? (
                  <div className="flex items-center gap-2 py-6 font-mono text-[11px] text-iris">
                    <LoaderCircle className="size-4 animate-spin" />
                    正在结合 BNM 政策利率、MGS 供给与美马利差生成专业固收研判…
                  </div>
                ) : analysis ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-faint">
                        <ShieldCheck className="size-3 text-bull" />
                        {formatDateTime(analysis.generatedAt)}
                      </span>
                      {analysis.degraded ? (
                        <Badge tone="neutral">本地量化引擎</Badge>
                      ) : (
                        <Badge tone="iris" title={`实际执行模型：${analysis.model}`}>
                          Powered by {modelDisplayName(analysis.model)}
                        </Badge>
                      )}
                    </div>

                    <p className="text-[12.5px] leading-snug font-semibold text-ink">{analysis.headline}</p>

                    <div className="space-y-2 text-[11.5px] leading-relaxed text-dim">
                      <div className="rounded-lg border border-line bg-void/45 p-2.5">
                        <div className="font-mono text-[9.5px] tracking-[0.12em] text-gold uppercase">
                          拍卖认购与机构需求展望
                        </div>
                        <p className="mt-1">{analysis.demandOutlook}</p>
                      </div>
                      <div className="rounded-lg border border-line bg-void/45 p-2.5">
                        <div className="font-mono text-[9.5px] tracking-[0.12em] text-ice uppercase">
                          MGS 收益率曲线形态影响
                        </div>
                        <p className="mt-1">{analysis.yieldImpact}</p>
                      </div>
                      <div className="rounded-lg border border-line bg-void/45 p-2.5">
                        <div className="font-mono text-[9.5px] tracking-[0.12em] text-iris uppercase">
                          MYR 汇率与马股联动
                        </div>
                        <p className="mt-1">{analysis.fxAndEquityImpact}</p>
                      </div>
                    </div>

                    <div>
                      <div className="mb-1.5 font-mono text-[9.5px] tracking-[0.12em] text-faint uppercase">
                        关键观察指标
                      </div>
                      <ul className="space-y-1 text-[11px] text-dim">
                        {analysis.keyWatchPoints.map((pt) => (
                          <li key={pt} className="flex items-start gap-1.5">
                            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-ice" />
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11.5px] leading-relaxed text-dim">
                    点击右上角「生成 AI 研判」，系统将按当前路由模式（{settings.aiRouting}）并启用 Pro → Flash → Flash-Lite 降级保护，综合分析未来几周 MGS/MGII 供需与美马利差对令吉及马股的影响。
                  </p>
                )}
              </Panel>
            </div>
          </div>
        </>
      ) : null}
    </main>
  )
}

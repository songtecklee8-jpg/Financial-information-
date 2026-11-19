import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Building2,
  CalendarRange,
  FileText,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'

import type {
  ApiSettings,
  BursaAnnouncement,
  BursaEarningsDetail,
  EarningsPayload,
  UsEarningsEvent,
} from '@/types'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Panel } from '@/components/ui/Panel'
import { StatTile } from '@/components/ui/StatTile'
import { fetchBursaEarningsDetail, fetchEarningsCalendar } from '@/lib/cloud'
import {
  buildBursaEarningsDetailBrowser,
  fetchEarningsCalendarBrowser,
} from '@/lib/earningsBondsClient'
import { cn } from '@/lib/cn'
import { formatCompact, formatDateTime, formatRelativeTime } from '@/lib/format'
import { modelDisplayName } from '@/lib/gemini'

interface EarningsCalendarPageProps {
  settings: ApiSettings
  onSelectSymbol: (symbol: string) => void
  onOpenSettings: () => void
}

type UsTimingFilter = 'all' | 'bmo' | 'amc' | 'priority'

const PRIORITY_SET = new Set([
  'AAPL',
  'MSFT',
  'NVDA',
  'AMZN',
  'GOOGL',
  'META',
  'TSLA',
  'AMD',
  'AVGO',
  'NFLX',
  'JPM',
  'WMT',
  'COST',
  'CRM',
  'SNOW',
  'PANW',
  'CRWD',
  'DELL',
])

const HOUR_META: Record<UsEarningsEvent['hour'], { label: string; tone: 'gold' | 'ice' | 'iris' | 'neutral' }> = {
  bmo: { label: '盘前 BMO', tone: 'gold' },
  amc: { label: '盘后 AMC', tone: 'iris' },
  dmh: { label: '盘中 DMH', tone: 'ice' },
  unknown: { label: '时间待定', tone: 'neutral' },
}

export function EarningsCalendarPage({
  settings,
  onSelectSymbol,
  onOpenSettings,
}: EarningsCalendarPageProps) {
  const [data, setData] = useState<EarningsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [usFilter, setUsFilter] = useState<UsTimingFilter>('all')

  // 马股公告详情弹窗
  const [selectedBursa, setSelectedBursa] = useState<BursaAnnouncement | null>(null)
  const [detail, setDetail] = useState<BursaEarningsDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const hasMarketKey =
    settings.providers.finnhub.apiKey.trim().length > 0 ||
    settings.providers.fmp.apiKey.trim().length > 0
  const hasGemini = settings.geminiKey.trim().length > 0

  const loadCalendar = useCallback(
    async (refresh = false) => {
      setLoading(true)
      setError(null)
      const payload =
        (await fetchEarningsCalendar(settings, refresh)) ??
        (await fetchEarningsCalendarBrowser(settings))
      setData(payload)
      setLoading(false)
    },
    [settings],
  )

  useEffect(() => {
    void loadCalendar(false)
  }, [loadCalendar])

  const openBursaDetail = useCallback(
    async (item: BursaAnnouncement, refresh = false) => {
      setSelectedBursa(item)
      setDetailLoading(true)
      if (!refresh) setDetail(null)
      const res =
        (await fetchBursaEarningsDetail(item, settings, refresh)) ??
        (await buildBursaEarningsDetailBrowser(item, settings))
      setDetail(res)
      setDetailLoading(false)
    },
    [settings],
  )

  const normalizedQuery = query.trim().toLowerCase()

  const filteredUs = useMemo(() => {
    const list = data?.us ?? []
    return list.filter((ev) => {
      if (usFilter === 'bmo' && ev.hour !== 'bmo') return false
      if (usFilter === 'amc' && ev.hour !== 'amc') return false
      if (usFilter === 'priority' && !PRIORITY_SET.has(ev.symbol)) return false
      if (normalizedQuery) {
        return (
          ev.symbol.toLowerCase().includes(normalizedQuery) ||
          ev.company.toLowerCase().includes(normalizedQuery)
        )
      }
      return true
    })
  }, [data?.us, usFilter, normalizedQuery])

  const filteredBursa = useMemo(() => {
    const list = data?.bursa ?? []
    if (!normalizedQuery) return list
    return list.filter(
      (item) =>
        item.symbol.toLowerCase().includes(normalizedQuery) ||
        item.company.toLowerCase().includes(normalizedQuery) ||
        item.title.toLowerCase().includes(normalizedQuery),
    )
  }, [data?.bursa, normalizedQuery])

  return (
    <main className="mx-auto w-full max-w-[1800px] flex-1 space-y-3 px-3 pt-3 pb-24 sm:px-4">
      {/* 顶部控制栏 */}
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange className="size-4 text-gold" />
            <h1 className="text-[14px] font-semibold tracking-wide text-ink">
              财报日历与最新季报追踪 · US 7-Day &amp; Bursa (.KL)
            </h1>
            {data && (
              <>
                <Badge tone={data.usOrigin === 'live' ? 'bull' : 'neutral'} dot>
                  美股：{data.usOrigin === 'live' ? `${data.usProvider} LIVE` : '7日基准日程'}
                </Badge>
                <Badge tone={data.bursaOrigin === 'live' ? 'ice' : 'neutral'} dot>
                  马股：{data.bursaOrigin === 'live' ? `${data.bursaProvider} LIVE` : 'Bursa 季度公告'}
                </Badge>
                {data.model && (
                  <Badge tone="iris" title={`实际执行模型：${data.model}`}>
                    Powered by {modelDisplayName(data.model)}
                  </Badge>
                )}
              </>
            )}
          </div>
          <p className="mt-1 font-mono text-[10.5px] text-faint">
            美股接入 Finnhub / FMP 未来 7 天财报预期 · 马股（.KL）自动追踪季度业绩并支持 Gemini 多模型 PDF 摘要解析
            {data ? ` · 更新于 ${formatDateTime(data.updatedAt)}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="筛选代码 / 公司名 (如 NVDA, 1155)"
              className="w-56 rounded-lg border border-line bg-void/70 py-1.5 pr-2.5 pl-8 font-mono text-[11px] text-ink placeholder:text-faint focus:border-gold/50 focus:outline-none"
            />
          </div>

          {!hasMarketKey && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1 rounded-lg border border-gold/45 bg-gold/10 px-2.5 py-1.5 font-mono text-[11px] text-gold transition hover:bg-gold/20"
            >
              <KeyRound className="size-3.5" /> 配置 Finnhub / FMP Key
            </button>
          )}

          <button
            type="button"
            onClick={() => void loadCalendar(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-2 bg-panel-2 px-3 py-1.5 font-mono text-[11px] text-dim transition hover:border-gold/50 hover:text-gold disabled:opacity-50"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            刷新日程
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-bear/40 bg-bear/10 px-4 py-2.5 font-mono text-[11.5px] text-bear">
          {error}
        </div>
      )}

      {/* 双栏主体：左美股 7 日 / 右马股 .KL 最新季报 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        {/* 美股未来 7 天财报日程 */}
        <Panel
          eyebrow="US Earnings · Next 7 Days"
          title="美股未来 7 天财报日程"
          subtitle={`共 ${filteredUs.length} 家公司 · 点击代码跳转个股估值诊断`}
          className="xl:col-span-6"
          actions={
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { key: 'all', label: '全部' },
                  { key: 'bmo', label: '盘前 BMO' },
                  { key: 'amc', label: '盘后 AMC' },
                  { key: 'priority', label: '重点权重' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setUsFilter(tab.key)}
                  className={cn(
                    'rounded-md border px-2 py-1 font-mono text-[10px] transition',
                    usFilter === tab.key
                      ? 'border-gold/50 bg-gold/12 text-gold'
                      : 'border-line text-dim hover:border-line-2 hover:text-ink',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          }
        >
          {loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-12 font-mono text-[11.5px] text-dim">
              <LoaderCircle className="size-4 animate-spin text-gold" />
              正在拉取美股未来 7 天财报日程…
            </div>
          ) : filteredUs.length === 0 ? (
            <div className="py-10 text-center font-mono text-[11.5px] text-faint">
              当前筛选条件下暂无财报日程
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left font-mono text-[11.5px]">
                <thead>
                  <tr className="border-b border-line text-[10px] tracking-[0.1em] text-faint uppercase">
                    <th className="py-2 pr-2 font-medium">日期</th>
                    <th className="py-2 pr-2 font-medium">标的</th>
                    <th className="py-2 pr-2 font-medium">时段</th>
                    <th className="py-2 pr-2 text-right font-medium">EPS 预期 / 实际</th>
                    <th className="py-2 text-right font-medium">营收预期</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {filteredUs.map((ev) => {
                    const hour = HOUR_META[ev.hour]
                    const beat =
                      ev.epsActual !== null && ev.epsEstimate !== null
                        ? ev.epsActual >= ev.epsEstimate
                        : null
                    return (
                      <tr key={ev.id} className="transition-colors hover:bg-panel-2/60">
                        <td className="py-2.5 pr-2 whitespace-nowrap text-dim">{ev.date}</td>
                        <td className="py-2.5 pr-2">
                          <button
                            type="button"
                            onClick={() => onSelectSymbol(ev.symbol)}
                            className="group inline-flex items-center gap-1 text-left"
                            title={`查看 ${ev.symbol} 行情与量化估值`}
                          >
                            <span className="font-semibold text-gold group-hover:underline">
                              {ev.symbol}
                            </span>
                            <ArrowUpRight className="size-3 text-faint opacity-0 transition group-hover:opacity-100" />
                          </button>
                          <div className="max-w-[180px] truncate font-sans text-[11px] text-faint">
                            {ev.company}
                          </div>
                        </td>
                        <td className="py-2.5 pr-2 whitespace-nowrap">
                          <Badge tone={hour.tone}>{hour.label}</Badge>
                        </td>
                        <td className="py-2.5 pr-2 text-right whitespace-nowrap">
                          <span className="text-ink">
                            {ev.epsEstimate !== null ? `$${ev.epsEstimate.toFixed(2)}` : '—'}
                          </span>
                          {ev.epsActual !== null && (
                            <span
                              className={cn(
                                'ml-1.5 font-semibold',
                                beat === true ? 'text-bull' : beat === false ? 'text-bear' : 'text-ink',
                              )}
                            >
                              / ${ev.epsActual.toFixed(2)}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap text-dim">
                          {ev.revenueEstimate !== null ? `$${formatCompact(ev.revenueEstimate, 2)}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* 马股 (.KL) 最新季度财报公告 */}
        <Panel
          eyebrow="Bursa Malaysia (.KL) · Quarterly Results"
          title="大马交易所最新季度财报公告"
          subtitle="点击「查看财报与 PDF 摘要」触发 Gemini 多模型深度财报解读"
          className="xl:col-span-6"
          actions={
            !hasGemini && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1 rounded-md border border-iris/40 bg-iris/10 px-2 py-1 font-mono text-[10px] text-iris transition hover:bg-iris/20"
              >
                <Sparkles className="size-3" /> 配置 Gemini 解读 PDF
              </button>
            )
          }
        >
          {loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-12 font-mono text-[11.5px] text-dim">
              <LoaderCircle className="size-4 animate-spin text-ice" />
              正在同步 Bursa Malaysia 最新季度财报列表…
            </div>
          ) : filteredBursa.length === 0 ? (
            <div className="py-10 text-center font-mono text-[11.5px] text-faint">
              未匹配到符合条件的马股财报公告
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredBursa.map((item) => {
                const profitUp = item.netProfitYoY.includes('+')
                return (
                  <div
                    key={item.id}
                    className="panel-flat space-y-2 p-3 transition-colors hover:border-line-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSelectSymbol(item.symbol)}
                            className="inline-flex items-center gap-1 rounded border border-ice/35 bg-ice/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ice transition hover:bg-ice/20"
                            title={`切换至 ${item.symbol} K线与估值`}
                          >
                            {item.symbol}
                          </button>
                          <span className="text-[12.5px] font-semibold text-ink">{item.company}</span>
                          <Badge tone="gold">{item.quarterLabel}</Badge>
                        </div>
                        <p className="mt-1 line-clamp-1 text-[11px] text-dim" title={item.title}>
                          {item.title}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-faint">
                        {formatRelativeTime(item.publishedAt)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded-lg border border-line/70 bg-void/45 px-2.5 py-1.5">
                        <div className="font-mono text-[9.5px] text-faint">季度营收</div>
                        <div className="mt-0.5 font-mono text-[12px] font-semibold text-ink">
                          {item.revenueMyr}
                        </div>
                        <div className="font-mono text-[9.5px] text-dim">{item.revenueYoY}</div>
                      </div>
                      <div className="rounded-lg border border-line/70 bg-void/45 px-2.5 py-1.5">
                        <div className="font-mono text-[9.5px] text-faint">季度净利润</div>
                        <div
                          className={cn(
                            'mt-0.5 font-mono text-[12px] font-semibold',
                            profitUp ? 'text-bull' : 'text-ink',
                          )}
                        >
                          {item.netProfitMyr}
                        </div>
                        <div className={cn('font-mono text-[9.5px]', profitUp ? 'text-bull' : 'text-dim')}>
                          {item.netProfitYoY}
                        </div>
                      </div>
                      <div className="rounded-lg border border-line/70 bg-void/45 px-2.5 py-1.5">
                        <div className="font-mono text-[9.5px] text-faint">每股盈利 EPS</div>
                        <div className="mt-0.5 font-mono text-[12px] font-semibold text-ink">
                          {item.epsSen}
                        </div>
                      </div>
                      <div className="rounded-lg border border-line/70 bg-void/45 px-2.5 py-1.5">
                        <div className="font-mono text-[9.5px] text-faint">派息 DPS</div>
                        <div className="mt-0.5 font-mono text-[12px] font-semibold text-gold">
                          {item.dividendSen ?? '—'}
                        </div>
                      </div>
                    </div>

                    {item.summaryPoints.length > 0 && (
                      <ul className="space-y-1 text-[11px] leading-relaxed text-dim">
                        {item.summaryPoints.slice(0, 2).map((pt) => (
                          <li key={pt} className="flex items-start gap-1.5">
                            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-gold/70" />
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2">
                      <a
                        href={item.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[10.5px] text-faint transition hover:text-ice"
                      >
                        <Building2 className="size-3" /> Bursa 原公告链接
                      </a>
                      <button
                        type="button"
                        onClick={() => void openBursaDetail(item)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-iris/45 bg-iris/12 px-2.5 py-1 font-mono text-[10.5px] font-medium text-iris transition hover:bg-iris/22"
                      >
                        <FileText className="size-3.5" />
                        查看财报与 PDF 摘要
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      {/* 马股财报 & PDF 摘要详情弹窗 */}
      <Modal
        open={selectedBursa !== null}
        onClose={() => {
          setSelectedBursa(null)
          setDetail(null)
        }}
        size="lg"
        title={
          selectedBursa ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-ice">{selectedBursa.symbol}</span>
              <span>{selectedBursa.company}</span>
              <Badge tone="gold">{selectedBursa.quarterLabel}</Badge>
            </span>
          ) : (
            '马股财报摘要'
          )
        }
        subtitle={selectedBursa?.title}
        footer={
          selectedBursa && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <a
                href={detail?.pdfUrl || selectedBursa.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line-2 px-3 py-1.5 font-mono text-[11px] text-dim transition hover:border-ice/50 hover:text-ice"
              >
                <FileText className="size-3.5" /> 打开 Bursa 原公告 / PDF
                <ArrowUpRight className="size-3" />
              </a>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void openBursaDetail(selectedBursa, true)}
                  disabled={detailLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-iris/45 bg-iris/15 px-3 py-1.5 font-mono text-[11px] text-iris transition hover:bg-iris/25 disabled:opacity-50"
                >
                  <Sparkles className="size-3.5" /> 重新 AI 解析
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSelectSymbol(selectedBursa.symbol)
                    setSelectedBursa(null)
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-gold/45 bg-gold/12 px-3 py-1.5 font-mono text-[11px] text-gold transition hover:bg-gold/20"
                >
                  跳至个股估值 →
                </button>
              </div>
            </div>
          )
        }
      >
        {detailLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 font-mono text-[12px] text-iris">
            <LoaderCircle className="size-5 animate-spin" />
            <span>正在通过 Gemini 多模型故障转移链路深度提取财报与 PDF 核心摘要…</span>
          </div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[10.5px] text-faint">
                报告期：{selectedBursa?.periodEnd} · 生成于 {formatDateTime(detail.generatedAt)}
              </span>
              {detail.degraded ? (
                <Badge tone="neutral">本地量化引擎（配置 Gemini Key 后启用深度 PDF 提炼）</Badge>
              ) : (
                <Badge tone="iris" title={`实际执行模型：${detail.model}`}>
                  Powered by {modelDisplayName(detail.model)}
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatTile label="营业额 Revenue" value={detail.revenueMyr} footnote={detail.revenueYoY} tone="neutral" />
              <StatTile label="净利润 Net Profit" value={detail.netProfitMyr} footnote={detail.netProfitYoY} tone="bull" />
              <StatTile label="每股盈利 EPS" value={detail.epsSen} tone="ice" />
              <StatTile label="宣布股息 DPS" value={detail.dividendSen ?? '未派息'} tone="gold" />
            </div>

            <div className="rounded-xl border border-line bg-void/50 p-3.5">
              <div className="mb-2 font-mono text-[10.5px] font-semibold tracking-[0.14em] text-gold uppercase">
                PDF / 季报核心摘要要点
              </div>
              <ul className="space-y-1.5 text-[12px] leading-relaxed text-ink">
                {detail.summaryPoints.map((pt) => (
                  <li key={pt} className="flex items-start gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold" />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div className="rounded-xl border border-bull/25 bg-bull/[0.04] p-3">
                <div className="font-mono text-[10px] tracking-[0.12em] text-bull uppercase">经营亮点</div>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-dim">{detail.highlights}</p>
              </div>
              <div className="rounded-xl border border-ice/25 bg-ice/[0.04] p-3">
                <div className="font-mono text-[10px] tracking-[0.12em] text-ice uppercase">前景展望</div>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-dim">{detail.outlook}</p>
              </div>
              <div className="rounded-xl border border-bear/25 bg-bear/[0.04] p-3">
                <div className="font-mono text-[10px] tracking-[0.12em] text-bear uppercase">风险提示</div>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-dim">{detail.risks}</p>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </main>
  )
}

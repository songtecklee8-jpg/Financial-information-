import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  KeyRound,
  Languages,
  LoaderCircle,
  Newspaper,
  Radio,
  RefreshCw,
  Sparkles,
} from 'lucide-react'

import type { ApiSettings, NewsArticle, NewsCategory, NewsSourceId } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { NewsReaderPanel } from '@/components/news/NewsReaderPanel'
import { useNews } from '@/hooks/useNews'
import { cn } from '@/lib/cn'
import { formatRelativeTime } from '@/lib/format'
import { translateArticles, aiRoute, modelDisplayName } from '@/lib/gemini'
import { NEWS_SOURCES, sourceMeta } from '@/lib/news'

interface NewsHubPageProps {
  settings: ApiSettings
  symbol: string
  onOpenSettings: () => void
}

type RegionFilter = 'all' | 'global' | 'malaysia' | 'crypto'

const REGION_TABS: Array<{ key: RegionFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'global', label: '美股与全球' },
  { key: 'malaysia', label: '马来西亚' },
  { key: 'crypto', label: '加密资产' },
]

const CATEGORY_LABEL: Record<NewsCategory, string> = {
  macro: '宏观',
  equities: '股票',
  rates: '利率',
  energy: '能源',
  tech: '科技',
  crypto: '加密',
  corporate: '公司',
}

const CATEGORY_ORDER: NewsCategory[] = ['macro', 'equities', 'rates', 'tech', 'energy', 'crypto', 'corporate']

const SENTIMENT_META = {
  bullish: { dot: 'bg-bull', label: '偏多' },
  bearish: { dot: 'bg-bear', label: '偏空' },
  neutral: { dot: 'bg-dim', label: '中性' },
} as const

const SOURCE_TONE: Record<string, 'gold' | 'ice' | 'iris' | 'bull' | 'bear' | 'neutral'> = {
  gold: 'gold',
  ice: 'ice',
  iris: 'iris',
  bull: 'bull',
  bear: 'bear',
  neutral: 'neutral',
}

export function NewsHubPage({ settings, symbol, onOpenSettings }: NewsHubPageProps) {
  const news = useNews(settings, symbol)
  const [region, setRegion] = useState<RegionFilter>('all')
  const [category, setCategory] = useState<NewsCategory | 'all'>('all')
  const [source, setSource] = useState<NewsSourceId | 'all'>('all')
  const [selected, setSelected] = useState<NewsArticle | null>(null)
  const [showOriginal, setShowOriginal] = useState<Record<string, boolean>>({})

  // 华文翻译结果（Gemini · Lite 层级）；未配置 Key 时保持 null，直接显示原文
  const [translated, setTranslated] = useState<NewsArticle[] | null>(null)
  const [translatedModel, setTranslatedModel] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const translateAbort = useRef<AbortController | null>(null)

  const hasGemini = settings.geminiKey.trim().length > 0
  const articles = translated ?? news.articles

  const autoTranslate = useCallback(async () => {
    if (!hasGemini || news.articles.length === 0) return
    translateAbort.current?.abort()
    const controller = new AbortController()
    translateAbort.current = controller
    setTranslating(true)
    try {
      const result = await translateArticles(
        news.articles,
        settings.geminiKey,
        aiRoute(settings, 'lite'),
        controller.signal,
      )
      if (!controller.signal.aborted) {
        setTranslated(result.articles)
        setTranslatedModel(result.model)
      }
    } catch {
      // 翻译失败：保留原文
    } finally {
      if (!controller.signal.aborted) setTranslating(false)
    }
  }, [
    hasGemini,
    news.articles,
    settings.geminiKey,
    settings.aiRouting,
    settings.geminiModel,
    settings,
  ])

  // 新闻更新后自动翻译（仅英文源）
  useEffect(() => {
    setTranslated(null)
    setTranslatedModel(null)
    if (!hasGemini) return
    const pending = news.articles.some((item) => item.lang === 'en' && item.translation !== 'done')
    if (!pending) return
    autoTranslate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [news.articles, hasGemini, settings.aiRouting, settings.geminiModel])

  useEffect(() => () => translateAbort.current?.abort(), [])

  const filtered = useMemo(() => {
    return articles.filter((article) => {
      if (region === 'global' && article.region !== 'global') return false
      if (region === 'malaysia' && article.region !== 'malaysia') return false
      if (region === 'crypto' && !article.categories.includes('crypto')) return false
      if (category !== 'all' && !article.categories.includes(category)) return false
      if (source !== 'all' && article.sourceId !== source) return false
      return true
    })
  }, [articles, region, category, source])

  const availableSources = useMemo(() => {
    const ids = new Set(articles.map((article) => article.sourceId))
    return NEWS_SOURCES.filter((meta) => ids.has(meta.id))
  }, [articles])

  const translatedCount = articles.filter((article) => article.translation === 'done').length

  const toggleOriginal = (id: string) =>
    setShowOriginal((prev) => ({ ...prev, [id]: !prev[id] }))

  return (
    <main className="mx-auto w-full max-w-[1800px] flex-1 px-3 pt-3 pb-16 sm:px-4">
      {/* 头部 */}
      <section className="panel hairline-top mb-3 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Newspaper className="size-4 text-gold" />
              <h1 className="text-base font-semibold tracking-wide text-ink">
                全球与马股实时财经新闻中心
              </h1>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
              聚合 Finnhub · Alpha Vantage · GDELT · BERNAMA · The Star · NST · The Edge · Bursa ·
              CNBC · WSJ · Yahoo Finance 等 12 个源；后台 24 小时定时同步，
              <span className="text-gold">点击任意新闻即打开 AI 深度阅读器（核心摘要 + 完整全文 + 五大资产推演）</span>。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {news.status === 'cloud' ? (
              <Badge tone="ice" dot title="数据由云端后台 24 小时定时同步，首屏毫秒级直接读取">
                CLOUD SYNC
              </Badge>
            ) : news.status === 'live' ? (
              <Badge tone="bull" dot>
                LIVE FEED
              </Badge>
            ) : news.status === 'loading' ? (
              <Badge tone="neutral" dot>
                加载中
              </Badge>
            ) : (
              <Badge tone="neutral" title="外部源不可达，已回退内置基准新闻流">
                BASELINE
              </Badge>
            )}
            <button
              type="button"
              onClick={news.refresh}
              className="inline-flex items-center gap-1 rounded-lg border border-line-2 px-2.5 py-1.5 font-mono text-[11px] text-dim transition hover:border-gold/50 hover:text-gold"
            >
              {news.status === 'loading' ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              刷新
            </button>
          </div>
        </div>

        {/* 翻译状态条 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line/60 pt-2.5 font-mono text-[10.5px]">
          {hasGemini ? (
            translating ? (
              <span className="flex items-center gap-1.5 text-gold">
                <LoaderCircle className="size-3 animate-spin" /> Gemini 正在翻译为华文…
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-bull">
                <Languages className="size-3" /> 华文翻译已就绪（{translatedCount}/{articles.length} 条）
                {translatedModel && (
                  <span className="text-faint">· Powered by {modelDisplayName(translatedModel)}</span>
                )}
              </span>
            )
          ) : (
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 text-gold transition hover:text-gold/80"
            >
              <KeyRound className="size-3" /> 配置 Gemini Key 可自动翻译为华文并启用 AI 推演
            </button>
          )}
          <span className="text-faint">
            {news.lastUpdated ? `更新于 ${formatRelativeTime(news.lastUpdated)}` : '正在获取…'}
          </span>
          {news.cloudMeta && (
            <span className="flex items-center gap-1 text-ice/85" title="云端后台定时同步状态">
              <Radio className="size-3" /> 云端同步
              <span className="text-faint">
                ·{' '}
                {news.cloudMeta.trigger === 'cron'
                  ? 'Vercel Cron'
                  : news.cloudMeta.trigger === 'external'
                    ? '外部唤醒'
                    : '手动'}
                {news.cloudMeta.usingUpstash ? ' · Upstash' : ' · 本地降级'}
              </span>
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-faint">
            <Globe className="size-3" /> 追踪标的 <span className="text-dim">{symbol || '—'}</span>
          </span>
        </div>
      </section>

      {/* 筛选 */}
      <div className="mb-3 flex flex-col gap-2">
        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto">
          {REGION_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setRegion(tab.key)}
              className={cn(
                'rounded-full border px-3 py-1 font-mono text-[11px] whitespace-nowrap transition',
                region === tab.key
                  ? 'border-gold/50 bg-gold/12 text-gold'
                  : 'border-line bg-panel-2 text-dim hover:border-line-2 hover:text-ink',
              )}
            >
              {tab.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-line-2" />
          <button
            type="button"
            onClick={() => setCategory('all')}
            className={cn(
              'rounded-full border px-2.5 py-1 font-mono text-[10.5px] whitespace-nowrap transition',
              category === 'all'
                ? 'border-ice/50 bg-ice/10 text-ice'
                : 'border-line bg-panel-2 text-dim hover:border-line-2 hover:text-ink',
            )}
          >
            全部分类
          </button>
          {CATEGORY_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              className={cn(
                'rounded-full border px-2.5 py-1 font-mono text-[10.5px] whitespace-nowrap transition',
                category === key
                  ? 'border-ice/50 bg-ice/10 text-ice'
                  : 'border-line bg-panel-2 text-dim hover:border-line-2 hover:text-ink',
              )}
            >
              {CATEGORY_LABEL[key]}
            </button>
          ))}
        </div>

        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setSource('all')}
            className={cn(
              'rounded border px-2 py-[3px] font-mono text-[10px] whitespace-nowrap transition',
              source === 'all'
                ? 'border-gold/50 bg-gold/10 text-gold'
                : 'border-line bg-void/50 text-faint hover:text-ink',
            )}
          >
            全部来源
          </button>
          {availableSources.map((meta) => (
            <button
              key={meta.id}
              type="button"
              onClick={() => setSource(meta.id)}
              className={cn(
                'rounded border px-2 py-[3px] font-mono text-[10px] whitespace-nowrap transition',
                source === meta.id
                  ? 'border-gold/50 bg-gold/10 text-gold'
                  : 'border-line bg-void/50 text-faint hover:text-ink',
              )}
            >
              {meta.name}
            </button>
          ))}
        </div>
      </div>

      {/* 新闻网格 */}
      {filtered.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 py-16 text-faint">
          <Newspaper className="size-7" />
          <p className="text-[12px]">当前筛选条件下暂无新闻</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((article) => {
            const sentiment = SENTIMENT_META[article.sentiment]
            const meta = sourceMeta(article.sourceId)
            const showZh = Boolean(article.titleZh) && !showOriginal[article.id]
            const isCrypto = article.categories.includes('crypto')
            return (
              <article
                key={article.id}
                className="panel hairline-top group flex flex-col p-3 transition-colors hover:border-gold/35"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={cn('size-1.5 shrink-0 rounded-full', sentiment.dot)} title={sentiment.label} />
                    <Badge tone={SOURCE_TONE[meta.accent]}>{article.sourceName}</Badge>
                    <span className="font-mono text-[9.5px] text-faint">
                      {article.region === 'malaysia' ? '🇲🇾' : isCrypto ? '₿' : '🇺🇸'}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-faint">
                    {formatRelativeTime(article.publishedAt)}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setSelected(article)}
                  className="mt-2 text-left"
                >
                  <p className="text-[12.5px] leading-snug font-medium text-ink transition-colors group-hover:text-gold">
                    {showZh ? article.titleZh : article.title}
                  </p>
                  {article.titleZh && showOriginal[article.id] && (
                    <p className="mt-1 text-[10.5px] leading-relaxed text-faint italic">{article.title}</p>
                  )}
                  <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-dim">
                    {(showZh && article.summaryZh) || article.summary}
                  </p>
                </button>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {article.categories.slice(0, 3).map((key) => (
                    <span
                      key={key}
                      className="rounded border border-line bg-void/50 px-1.5 py-[1px] font-mono text-[9.5px] text-faint"
                    >
                      {CATEGORY_LABEL[key]}
                    </span>
                  ))}
                  {article.tickers.slice(0, 3).map((ticker) => (
                    <span
                      key={ticker}
                      className="rounded border border-gold/25 bg-gold/[0.06] px-1.5 py-[1px] font-mono text-[9.5px] text-gold/90"
                    >
                      {ticker}
                    </span>
                  ))}
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line/60 pt-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelected(article)}
                      className="inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-2 py-1 font-mono text-[10px] text-gold transition hover:bg-gold/20"
                    >
                      <Sparkles className="size-3" /> AI 深度阅读
                    </button>
                    {article.titleZh && (
                      <button
                        type="button"
                        onClick={() => toggleOriginal(article.id)}
                        className="inline-flex items-center gap-0.5 rounded-md border border-line px-2 py-1 font-mono text-[10px] text-faint transition hover:text-ink"
                      >
                        {showOriginal[article.id] ? (
                          <>
                            华文 <ChevronUp className="size-2.5" />
                          </>
                        ) : (
                          <>
                            原文 <ChevronDown className="size-2.5" />
                          </>
                        )}
                      </button>
                    )}
                  </div>
                  {article.url && article.url !== '#' && (
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-0.5 font-mono text-[10px] text-faint transition hover:text-gold"
                    >
                      来源 <ExternalLink className="size-2.5" />
                    </a>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {selected && (
        <NewsReaderPanel
          article={selected}
          settings={settings}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  )
}

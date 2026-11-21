import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  KeyRound,
  Languages,
  LoaderCircle,
  Newspaper,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'

import type { ApiSettings, NewsArticle, NewsCategory, NewsSourceId, RelayMeta } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { NewsReaderPanel } from '@/components/news/NewsReaderPanel'
import { useNews } from '@/hooks/useNews'
import { cn } from '@/lib/cn'
import { formatRelayBadge, hasAnyAiConfigured } from '@/lib/aiFallback'
import { formatRelativeTime } from '@/lib/format'
import { aiRoute, generateText, parseJsonBlock, translateArticles } from '@/lib/gemini'
import { NEWS_SOURCES, sourceMeta } from '@/lib/news'

interface NewsHubPageProps {
  settings: ApiSettings
  symbol: string
  onOpenSettings: () => void
}

type RegionFilter = 'all' | 'global' | 'malaysia' | 'crypto'

interface BriefSummaryResult {
  queryLabel: string
  sentiment: 'bullish' | 'bearish' | 'neutral'
  sentimentLabel: string
  headline: string
  bullets: string[]
  rationale: string
  relay: RelayMeta
}

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
  bullish: { dot: 'bg-bull', label: '利好', tone: 'text-bull' },
  bearish: { dot: 'bg-bear', label: '利空', tone: 'text-bear' },
  neutral: { dot: 'bg-dim', label: '中性', tone: 'text-faint' },
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

  // 公司名 / 关键词实时拉取状态
  const [keyword, setKeyword] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [searchArticles, setSearchArticles] = useState<NewsArticle[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // 一键 AI 摘要 + 利好/利空情绪判断
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefResult, setBriefResult] = useState<BriefSummaryResult | null>(null)
  const [briefError, setBriefError] = useState<string | null>(null)

  // 华文批量翻译状态
  const [translated, setTranslated] = useState<NewsArticle[] | null>(null)
  const [translatedModel, setTranslatedModel] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const translateAbort = useRef<AbortController | null>(null)

  const hasAi = hasAnyAiConfigured(settings)
  const baseArticles = searchArticles ?? news.articles
  const articles = translated ?? baseArticles

  const autoTranslate = useCallback(
    async (list: NewsArticle[]) => {
      if (!hasAi || list.length === 0) return
      translateAbort.current?.abort()
      const controller = new AbortController()
      translateAbort.current = controller
      setTranslating(true)
      try {
        const result = await translateArticles(
          list,
          settings.geminiKey,
          aiRoute(settings, 'lite'),
          controller.signal,
        )
        if (!controller.signal.aborted) {
          setTranslated(result.articles)
          setTranslatedModel(result.model)
        }
      } catch {
        // 保留原文
      } finally {
        if (!controller.signal.aborted) setTranslating(false)
      }
    },
    [hasAi, settings],
  )

  useEffect(() => {
    setTranslated(null)
    setTranslatedModel(null)
    if (!hasAi) return
    const pending = baseArticles.some((item) => item.lang === 'en' && item.translation !== 'done')
    if (!pending) return
    void autoTranslate(baseArticles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseArticles, hasAi, settings.aiRouting, settings.geminiModel, settings.aiFallback])

  useEffect(() => () => translateAbort.current?.abort(), [])

  const handleKeywordSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const q = keyword.trim()
    if (!q) {
      setActiveQuery('')
      setSearchArticles(null)
      setSearchError(null)
      return
    }
    setSearching(true)
    setSearchError(null)
    setActiveQuery(q)

    try {
      const res = await fetch('/api/news/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          query: q,
          newsDataKey: settings.newsDataKey ?? '',
          finnhubKey: settings.providers?.finnhub?.apiKey ?? '',
        }),
      })
      if (res.ok && (res.headers.get('content-type') ?? '').includes('application/json')) {
        const data = (await res.json()) as { ok?: boolean; articles?: NewsArticle[] }
        if (data.ok && Array.isArray(data.articles) && data.articles.length > 0) {
          setSearchArticles(data.articles)
          setSearching(false)
          return
        }
      }
    } catch {
      // 后端不可达时回退本地关键词匹配
    }

    // 兜底：从当前新闻流按关键词过滤
    const lower = q.toLowerCase()
    const localHits = news.articles.filter(
      (a) =>
        a.title.toLowerCase().includes(lower) ||
        (a.titleZh ?? '').toLowerCase().includes(lower) ||
        a.summary.toLowerCase().includes(lower) ||
        a.tickers.some((t) => t.toLowerCase().includes(lower)),
    )
    setSearchArticles(localHits)
    if (localHits.length === 0) {
      setSearchError(`未在当前缓存或在线源中找到关于“${q}”的近期新闻，请尝试英文代码如 NVDA、AAPL 或 Fed。`)
    }
    setSearching(false)
  }

  const clearSearch = () => {
    setKeyword('')
    setActiveQuery('')
    setSearchArticles(null)
    setSearchError(null)
  }

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

  const handleGenerateBrief = async () => {
    const sample = filtered.slice(0, 12)
    if (sample.length === 0) {
      setBriefError('当前列表暂无新闻可供总结')
      return
    }
    setBriefLoading(true)
    setBriefError(null)

    const digest = sample
      .map(
        (item, idx) =>
          `${idx + 1}. [${item.sourceName}] ${item.titleZh ?? item.title} (${formatRelativeTime(item.publishedAt)})\n摘要：${(item.summaryZh ?? item.summary).slice(0, 200)}`,
      )
      .join('\n\n')

    const system = `你是顶级买方投研分析师。请基于以下财经新闻列表，提炼一份精炼、客观的简体中文「核心要点 + 利好/利空情绪判断」。
严格输出合法 JSON 对象，字段如下：
{
  "headline": "一句话总结当前核心主线（30字以内）",
  "sentiment": "bullish" | "bearish" | "neutral",
  "sentimentLabel": "整体偏多（利好）" | "整体偏空（利空）" | "多空交织（中性）",
  "bullets": ["核心要点1（含具体实体或数据）", "核心要点2", "核心要点3", "核心要点4"],
  "rationale": "情绪判断核心依据与短期交易/观察重点（80字以内）"
}`

    try {
      const res = await generateText({
        apiKey: settings.geminiKey,
        route: aiRoute(settings, 'flash'),
        systemInstruction: system,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `分析主题：${activeQuery ? `关键词 "${activeQuery}"` : '当前筛选财经资讯'}\n\n新闻清单：\n${digest}`,
              },
            ],
          },
        ],
        temperature: 0.25,
        maxOutputTokens: 1600,
      })

      const parsed = parseJsonBlock<Partial<BriefSummaryResult>>(res.text)
      const sentiment: 'bullish' | 'bearish' | 'neutral' =
        parsed.sentiment === 'bullish' || parsed.sentiment === 'bearish'
          ? parsed.sentiment
          : 'neutral'
      setBriefResult({
        queryLabel: activeQuery || '当前筛选财经情报',
        sentiment,
        sentimentLabel:
          parsed.sentimentLabel ||
          (sentiment === 'bullish' ? '整体利好（偏多）' : sentiment === 'bearish' ? '整体利空（偏空）' : '中性震荡'),
        headline: parsed.headline || '最新市场资讯核心总结',
        bullets: Array.isArray(parsed.bullets)
          ? parsed.bullets.map((b) => String(b).trim()).filter(Boolean).slice(0, 5)
          : [],
        rationale: parsed.rationale || '',
        relay: res.relay,
      })
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : 'AI 摘要生成失败，请检查接力赛配置')
    } finally {
      setBriefLoading(false)
    }
  }

  const availableSources = useMemo(() => {
    const ids = new Set(articles.map((article) => article.sourceId))
    return NEWS_SOURCES.filter((meta) => ids.has(meta.id))
  }, [articles])

  const translatedCount = articles.filter((article) => article.translation === 'done').length

  const toggleOriginal = (id: string) =>
    setShowOriginal((prev) => ({ ...prev, [id]: !prev[id] }))

  return (
    <main className="mx-auto w-full max-w-[1800px] flex-1 px-3 pt-3 pb-16 sm:px-4">
      {/* 头部：检索 + 一键 AI 摘要 */}
      <section className="panel hairline-top mb-3 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Newspaper className="size-4 text-gold" />
              <h1 className="text-base font-semibold tracking-wide text-ink">
                多源财经新闻聚合与 AI 情绪摘要
              </h1>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
              支持按公司名或关键词即时拉取 NewsData.io · Finnhub · GDELT · WSJ · The Edge · BERNAMA 等实时资讯，一键提炼核心要点与利好/利空判断。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {searchArticles !== null ? (
              <Badge tone="gold" dot>
                检索结果 · {activeQuery}
              </Badge>
            ) : news.status === 'cloud' ? (
              <Badge tone="ice" dot title="云端后台定时聚合新闻流">
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
              <Badge tone="neutral">BASELINE</Badge>
            )}
            <button
              type="button"
              onClick={() => {
                clearSearch()
                news.refresh()
              }}
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

        {/* 公司 / 关键词搜索 + 一键 AI 摘要工具栏 */}
        <form onSubmit={(e) => void handleKeywordSearch(e)} className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="输入公司名、股票代码或关键词（如 NVIDIA、AAPL、Maybank、Fed、降息）"
              className="w-full rounded-lg border border-line bg-void/70 py-2 pr-8 pl-9 font-mono text-[12px] text-ink transition placeholder:text-faint/70 focus:border-gold/55"
            />
            {keyword && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-faint hover:text-ink"
                title="清空检索"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={searching}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ice/45 bg-ice/12 px-3.5 py-2 font-mono text-[11.5px] font-medium text-ice transition hover:bg-ice/20 disabled:opacity-50"
          >
            {searching ? <LoaderCircle className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            拉取公司/主题新闻
          </button>
          <button
            type="button"
            disabled={briefLoading || filtered.length === 0}
            onClick={() => void handleGenerateBrief()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gold/50 bg-gold/18 px-3.5 py-2 font-mono text-[11.5px] font-medium text-gold transition hover:bg-gold/25 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {briefLoading ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            一键生成核心要点 + 利好/利空判断
          </button>
        </form>

        {searchError && (
          <p className="mt-2 font-mono text-[11px] text-bear">{searchError}</p>
        )}
        {briefError && (
          <p className="mt-2 font-mono text-[11px] text-bear">{briefError}</p>
        )}

        {/* AI 核心要点 + 情绪判断结果卡 */}
        {briefResult && (
          <div className="mt-3 rounded-xl border border-gold/30 bg-panel-2/80 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                {briefResult.sentiment === 'bullish' ? (
                  <TrendingUp className="size-4 text-bull" />
                ) : briefResult.sentiment === 'bearish' ? (
                  <TrendingDown className="size-4 text-bear" />
                ) : (
                  <Sparkles className="size-4 text-gold" />
                )}
                <span className="font-mono text-[12px] font-semibold text-ink">
                  {briefResult.headline}
                </span>
                <span
                  className={cn(
                    'rounded border px-2 py-0.5 font-mono text-[10px] font-semibold',
                    briefResult.sentiment === 'bullish'
                      ? 'border-bull/40 bg-bull/12 text-bull'
                      : briefResult.sentiment === 'bearish'
                        ? 'border-bear/40 bg-bear/12 text-bear'
                        : 'border-gold/40 bg-gold/12 text-gold',
                  )}
                >
                  {briefResult.sentimentLabel}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded border border-gold/30 bg-gold/10 px-2 py-0.5 font-mono text-[10px] text-gold">
                  {formatRelayBadge(briefResult.relay)}
                </span>
                <button
                  type="button"
                  onClick={() => setBriefResult(null)}
                  className="rounded p-1 text-faint hover:text-ink"
                  aria-label="关闭摘要"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>

            <ul className="mt-2.5 space-y-1.5">
              {briefResult.bullets.map((bullet, idx) => (
                <li key={idx} className="flex items-start gap-2 text-[12px] leading-relaxed text-dim">
                  <span className="mt-0.5 font-mono text-[10px] text-gold tabular-nums">
                    {idx + 1}.
                  </span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
            {briefResult.rationale && (
              <p className="mt-2.5 border-t border-line/50 pt-2 text-[11.5px] leading-relaxed text-ink/90">
                <span className="font-mono text-[10.5px] text-gold">判断依据：</span>
                {briefResult.rationale}
              </p>
            )}
          </div>
        )}

        {/* 翻译与同步状态条 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line/60 pt-2.5 font-mono text-[10.5px]">
          {hasAi ? (
            translating ? (
              <span className="flex items-center gap-1.5 text-gold">
                <LoaderCircle className="size-3 animate-spin" /> AI 接力引擎正在批量翻译新闻…
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-2 text-bull">
                <span className="inline-flex items-center gap-1">
                  <Languages className="size-3" /> 华文摘要就绪（{translatedCount}/{articles.length} 条）
                </span>
                {(translatedModel ?? news.cloudModel) && (
                  <span className="rounded border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] text-gold">
                    {formatRelayBadge((translatedModel ?? news.cloudModel)!)}
                  </span>
                )}
              </span>
            )
          ) : (
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 text-gold transition hover:text-gold/80"
            >
              <KeyRound className="size-3" /> 配置 Gemini 或接力赛密钥可开启全自动华文翻译与 AI 摘要
            </button>
          )}
          <span className="text-faint">
            {news.lastUpdated ? `更新于 ${formatRelativeTime(news.lastUpdated)}` : '正在获取…'}
          </span>
          {news.cloudMeta && (
            <span className="flex items-center gap-1 text-ice/85">
              <Radio className="size-3" /> 云端同步
            </span>
          )}
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
            const meta =
              NEWS_SOURCES.find((item) => item.id === article.sourceId) ?? sourceMeta('gdelt')
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
                    <span className={cn('font-mono text-[9.5px]', sentiment.tone)}>{sentiment.label}</span>
                    <Badge tone={SOURCE_TONE[meta.accent]}>{article.sourceName}</Badge>
                    <span className="font-mono text-[9.5px] text-faint">
                      {article.region === 'malaysia' ? 'MY' : isCrypto ? 'CRYPTO' : 'GLOBAL'}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-faint tabular-nums">
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

                <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[9.5px] text-faint">
                  <span>{article.categories.slice(0, 3).map((k) => CATEGORY_LABEL[k]).join(' · ')}</span>
                  {article.tickers.length > 0 && (
                    <span className="text-gold/90">· {article.tickers.slice(0, 3).join(' / ')}</span>
                  )}
                </div>

                <div className="mt-auto pt-2.5">
                  <div className="flex items-center justify-between gap-2 border-t border-line/60 pt-2">
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
                        className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-[10px] text-dim transition hover:border-gold/50 hover:text-gold"
                      >
                        原文链接 <ExternalLink className="size-2.5" />
                      </a>
                    )}
                  </div>
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

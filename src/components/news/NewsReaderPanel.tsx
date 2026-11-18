import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChartColumn,
  ExternalLink,
  Globe,
  Languages,
  LoaderCircle,
  Newspaper,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'

import type { ApiSettings, NewsArticle, NewsDetail, NewsImpact, ReaderMode } from '@/types'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { AssetRow } from '@/components/news/NewsImpactPanel'
import { cn } from '@/lib/cn'
import { formatRelativeTime } from '@/lib/format'
import { fetchNewsDetail } from '@/lib/cloud'
import { aiRoute, modelDisplayName, runNewsImpact } from '@/lib/gemini'

interface NewsReaderPanelProps {
  article: NewsArticle
  settings: ApiSettings
  onClose: () => void
}

const READER_TABS: Array<{ key: ReaderMode; label: string }> = [
  { key: 'zh', label: '华文全篇翻译' },
  { key: 'en', label: '英文原版' },
  { key: 'both', label: '双语对照' },
]

const EXTRACTION_META: Record<NewsDetail['extraction'], { label: string; tone: 'bull' | 'gold' | 'neutral' }> = {
  readability: { label: '正文已提取', tone: 'bull' },
  fallback: { label: '启发式提取', tone: 'gold' },
  unavailable: { label: '正文不可用', tone: 'neutral' },
}

/** 无云端详情时，用导语切分为摘要要点 */
function fallbackPoints(article: NewsArticle): string[] {
  const text = article.summaryZh ?? article.summary
  const points = text
    .split(/[。．.!?！？；;\n]+/)
    .map((line) => line.trim())
    .filter(Boolean)
  return points.slice(0, 5)
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n{1,}/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function NewsReaderPanel({ article, settings, onClose }: NewsReaderPanelProps) {
  const [detail, setDetail] = useState<NewsDetail | null>(null)
  const [impact, setImpact] = useState<NewsImpact | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<ReaderMode>('zh')
  const abortRef = useRef<AbortController | null>(null)

  const hasGemini = settings.geminiKey.trim().length > 0

  const load = useCallback(
    async (refresh: boolean) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)

      // 1) 云端后台优先：全文抓取 + AI 摘要 + 推演一次到位（Redis 缓存秒开）
      const remote = await fetchNewsDetail({
        id: article.id,
        url: article.url,
        title: article.title,
        summary: article.summary,
        sourceId: article.sourceId,
        sourceName: article.sourceName,
        publishedAt: article.publishedAt,
        region: article.region,
        lang: article.lang,
        tickers: article.tickers,
        refresh,
      })
      if (controller.signal.aborted) return

      if (remote) {
        setDetail(remote)
        setImpact(remote.impact)
        setLoading(false)
        return
      }

      // 2) 云端不可用：回落浏览器端 AI 推演，正文以导语兜底
      try {
        const localImpact = await runNewsImpact(
          article,
          settings.geminiKey,
          aiRoute(settings, 'flash'),
          controller.signal,
        )
        if (controller.signal.aborted) return
        setImpact(localImpact)
      } catch {
        if (controller.signal.aborted) return
        setImpact(null)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [article, settings.geminiKey, settings.aiRouting, settings.geminiModel, settings],
  )

  useEffect(() => {
    void load(false)
    return () => abortRef.current?.abort()
  }, [load])

  const headline = detail?.titleZh ?? article.titleZh ?? article.title
  const originalTitle = detail?.title ?? article.title

  const summaryPoints = detail?.summaryPoints?.length ? detail.summaryPoints : fallbackPoints(article)

  const fullText = detail?.fullText ?? ''
  const fullTextZh = detail?.fullTextZh ?? ''
  const hasFullText = fullText.length > 0
  const hasZh = fullTextZh.length > 0

  const extraction = detail?.extraction ?? 'unavailable'
  const extractionMeta = EXTRACTION_META[extraction]

  const model = detail?.model ?? impact?.model
  const degraded = !detail && (!impact || impact.degraded)

  const zhParagraphs = useMemo(() => paragraphs(fullTextZh), [fullTextZh])
  const enParagraphs = useMemo(() => paragraphs(fullText), [fullText])

  const openUrl = article.url && article.url !== '#' ? article.url : null

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Newspaper className="size-4 text-gold" />
          AI 深度阅读器
        </span>
      }
      subtitle="顶部：AI 核心摘要 + 五大资产涨跌概率推演 · 中部：抓取清洗后的完整新闻全文（可切换华文 / 原文 / 双语）"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10.5px] text-faint">
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={extractionMeta.tone}>{extractionMeta.label}</Badge>
            {degraded ? (
              <Badge tone="neutral" title="云端详情不可用，当前为浏览器端降级推演">
                本地降级
              </Badge>
            ) : (
              <Badge tone="gold" dot>
                云端 AI
              </Badge>
            )}
            {model && !degraded && (
              <span title={`实际执行模型：${model}`}>Powered by {modelDisplayName(model)}</span>
            )}
            {impact && <span>置信度 {impact.confidence}%</span>}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-lg border border-line-2 px-2.5 py-1.5 text-dim transition hover:border-gold/50 hover:text-gold disabled:opacity-50"
            >
              {loading ? <LoaderCircle className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              重新生成
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
      <div className="space-y-3.5">
        {/* 标题与出处 */}
        <div className="rounded-lg border border-line bg-void/50 px-3 py-2.5">
          <p className="text-[13.5px] leading-snug font-medium text-ink">{headline}</p>
          {article.titleZh && originalTitle !== headline && (
            <p className="mt-1 text-[10.5px] leading-relaxed text-faint italic">{originalTitle}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-faint">
            <span>{article.sourceName}</span>
            <span>·</span>
            <span>{formatRelativeTime(article.publishedAt)}</span>
            {detail?.cachedAt && (
              <>
                <span>·</span>
                <span title="云端缓存时间">缓存于 {formatRelativeTime(detail.cachedAt)}</span>
              </>
            )}
            {openUrl && (
              <a
                href={openUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-0.5 text-gold/90 hover:text-gold"
              >
                原文出处 <ExternalLink className="size-2.5" />
              </a>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-2 py-14 text-faint">
            <LoaderCircle className="size-5 animate-spin" />
            <p className="font-mono text-[11px]">正在抓取全文并生成 AI 摘要与跨市场推演…</p>
          </div>
        ) : (
          <>
            {/* ============ 顶部区域：AI 核心摘要 ============ */}
            <section>
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="size-3.5 text-gold/80" />
                <h3 className="font-mono text-[11px] font-medium tracking-[0.14em] text-dim uppercase">
                  AI 核心摘要 · 结构化华文要点
                </h3>
              </div>
              {summaryPoints.length > 0 ? (
                <ol className="space-y-1.5">
                  {summaryPoints.map((point, index) => (
                    <li
                      key={index}
                      className="flex gap-2 rounded-lg border border-line bg-panel-2/60 px-3 py-2 text-[12px] leading-relaxed text-dim"
                    >
                      <span className="mt-[3px] font-mono text-[10px] text-gold">{index + 1}</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[11.5px] text-faint">摘要暂不可用，请点击「重新生成」。</p>
              )}
            </section>

            {/* ============ 顶部区域：五大资产概率仪表盘 ============ */}
            {impact ? (
              <section>
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
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="panel-flat px-2.5 py-2">
                    <div className="font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">宏观流动性</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-dim">{impact.liquidity}</p>
                  </div>
                  <div className="panel-flat px-2.5 py-2">
                    <div className="font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">利率预期</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-dim">{impact.rateExpectation}</p>
                  </div>
                  <div className="panel-flat px-2.5 py-2">
                    <div className="font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">行业基本面</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-dim">{impact.sectorImpact}</p>
                  </div>
                </div>
              </section>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-line bg-panel-2/50 px-3 py-2.5 text-[11.5px] text-faint">
                <TriangleAlert className="size-3.5" /> 跨市场推演暂不可用，请稍后重试。
              </div>
            )}

            {/* ============ 中部区域：完整新闻全文 ============ */}
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Globe className="size-3.5 text-gold/80" />
                  <h3 className="font-mono text-[11px] font-medium tracking-[0.14em] text-dim uppercase">
                    完整新闻全文
                  </h3>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-line bg-panel-2 p-0.5">
                  {READER_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setMode(tab.key)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-mono text-[10.5px] transition',
                        mode === tab.key ? 'bg-gold/15 text-gold' : 'text-faint hover:text-ink',
                      )}
                    >
                      {tab.key !== 'en' && <Languages className="size-3" />}
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {!hasFullText ? (
                <div className="rounded-lg border border-line bg-panel-2/50 px-3 py-2.5">
                  <p className="flex items-center gap-2 text-[11.5px] text-faint">
                    <TriangleAlert className="size-3.5" /> 未能提取到完整正文（源站可能限制抓取），以下为导语。
                  </p>
                  <p className="mt-2 text-[12px] leading-relaxed text-dim">
                    {article.summaryZh ?? article.summary}
                  </p>
                  {openUrl && (
                    <a
                      href={openUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-2 inline-flex items-center gap-1 font-mono text-[10.5px] text-gold hover:text-gold/80"
                    >
                      前往原文阅读完整内容 <ExternalLink className="size-2.5" />
                    </a>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-line bg-void/40 p-3.5">
                  {mode === 'both' ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-2.5">
                        <div className="font-mono text-[9.5px] tracking-[0.14em] text-gold/70 uppercase">华文</div>
                        {hasZh ? (
                          zhParagraphs.map((paragraph, index) => (
                            <p key={index} className="text-[12.5px] leading-[1.85] text-dim">
                              {paragraph}
                            </p>
                          ))
                        ) : (
                          <p className="text-[11.5px] text-faint">华文翻译暂不可用。</p>
                        )}
                      </div>
                      <div className="space-y-2.5 md:border-l md:border-line md:pl-4">
                        <div className="font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">原文</div>
                        {enParagraphs.map((paragraph, index) => (
                          <p key={index} className="text-[12.5px] leading-[1.85] text-dim">
                            {paragraph}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : mode === 'zh' ? (
                    hasZh ? (
                      <div className="space-y-2.5">
                        {zhParagraphs.map((paragraph, index) => (
                          <p key={index} className="text-[13px] leading-[1.9] text-ink/90">
                            {paragraph}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <p className="flex items-center gap-1.5 font-mono text-[10.5px] text-faint">
                          <TriangleAlert className="size-3" /> 华文全篇翻译暂不可用，以下显示原文。
                        </p>
                        {enParagraphs.map((paragraph, index) => (
                          <p key={index} className="text-[12.5px] leading-[1.85] text-dim">
                            {paragraph}
                          </p>
                        ))}
                      </div>
                    )
                  ) : (
                    <div className="space-y-2.5">
                      {enParagraphs.map((paragraph, index) => (
                        <p key={index} className="text-[13px] leading-[1.85] text-ink/90">
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {openUrl && hasFullText && (
                <a
                  href={openUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2 inline-flex items-center gap-1 font-mono text-[10.5px] text-faint transition hover:text-gold"
                >
                  原文出处 <ExternalLink className="size-2.5" />
                </a>
              )}
            </section>

            <p className="border-t border-line/60 pt-2 text-[10px] leading-relaxed text-faint">
              {hasGemini
                ? '以上内容由 AI 抓取、翻译与概率化推演，仅供研究参考，不构成任何投资建议；概率之和恒为 100%。'
                : '当前未配置 Gemini Key，仅提供降级推演。配置后台 GEMINI_API_KEY 可启用完整全文翻译与深度推演。'}
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}

import { useState } from 'react'
import { Brain, FileText, LoaderCircle, Sparkles, Copy, Check, ShieldAlert } from 'lucide-react'

import type { ApiSettings } from '@/types'
import { generateText, aiRoute } from '@/lib/gemini'
import { formatBackupModelDisplay } from '@/lib/aiFallback'

interface EarningsAnalysisWorkspaceProps {
  settings: ApiSettings
  onOpenSettings: () => void
}

const SAMPLE_REPORTS = [
  {
    title: '苹果 (AAPL) 最新财报电话会议摘要片段',
    company: 'Apple Inc. (AAPL)',
    text: `Apple today announced financial results for its fiscal 2026 first quarter. Quarterly revenue was $124.3 billion, up 4.5% year over year, and quarterly diluted earnings per share was $2.42, up 8% year over year. Services revenue reached an all-time record of $26.3 billion, driven by strong growth in App Store, iCloud, and Apple Pay. Greater China revenue recovered to $21.2 billion, supported by strong demand for iPhone Pro models. Gross margin expanded to 46.5% due to favorable product mix and operational efficiencies. Operating cash flow for the quarter was a robust $39.5 billion, with return of capital to shareholders totaling over $27 billion through dividends and share repurchases. Management highlighted continued R&D investments in spatial computing and on-device machine intelligence.`,
  },
  {
    title: '马来亚银行 (1155.KL) 季度业绩公告片段',
    company: 'Maybank (1155.KL)',
    text: `Malayan Banking Berhad (Maybank) reported a net profit of RM2.58 billion for the third quarter, representing a 6.2% increase year-on-year, driven by healthier net interest margins and robust loan growth across key home markets (Malaysia and Indonesia). Net interest income grew 5.4% to RM3.72 billion, while non-interest income expanded by 8.1% due to higher fee income and treasury gains. Asset quality remained resilient, with gross impaired loans (GIL) ratio improving slightly to 1.34% and loan loss coverage remaining strong at over 125%. Total gross loans expanded 6.8% annualized. The Group declared an interim dividend of 30 sen per share. Management noted a cautious outlook for global trade headwinds but remains confident in domestic credit demand and ASEAN regional connectivity.`,
  },
]

export function EarningsAnalysisWorkspace({ settings, onOpenSettings }: EarningsAnalysisWorkspaceProps) {
  const [company, setCompany] = useState('Apple Inc. (AAPL)')
  const [text, setText] = useState(SAMPLE_REPORTS[0]!.text)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ report: string; model: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleAnalyze = async () => {
    if (!text.trim()) {
      setError('请输入或粘贴需要分析的财报、电话会议纪要或研报长文')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)

    const system = `你是一位资深的华尔街与大马证券高级金融分析师。请对用户提供的财报、电话会议纪要或研报长文进行深度解析，并严格按以下四个结构化板块输出专业严谨的投研分析报告（使用专业金融中文）：
1. 核心业绩亮点（营收, 利润, 超预期指标及核心驱动力）
2. 关键财务指标变化（毛利率, 净利率, 现金流, 资产负债表与股息率/派息情况）
3. 潜在风险点（宏观逆风, 成本压力, 供应链, 政策监管或减值风险）
4. 后续关注点（下一季度指引, 关键产品/业务落地节点, 资本开支）`

    const prompt = `分析标的: ${company}\n\n长文内容：\n${text}`

    try {
      const res = await generateText({
        apiKey: settings.geminiKey,
        route: aiRoute(settings, 'pro'),
        systemInstruction: system,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        temperature: 0.2,
        maxOutputTokens: 3072,
      })
      setResult({
        report: res.text,
        model: formatBackupModelDisplay(res.model),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 分析失败，请检查 API Key 配置')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    if (!result?.report) return
    navigator.clipboard.writeText(result.report)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 pt-4 pb-24 sm:px-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-mono text-base font-bold text-gold text-glow-gold">
            <Brain className="size-5" />
            财报长文与自定义文本 AI 深度分析工作台
          </h1>
          <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
            直接粘贴财报段落、电话会议纪要或研报原文，调用高级大模型一键生成四维度结构化深度投研报告。
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-lg border border-line-2 bg-panel-2 px-3 py-1.5 font-mono text-[11px] text-dim transition hover:border-gold/50 hover:text-gold"
        >
          配置 AI 模型与 Key
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* 输入面板 */}
        <div className="space-y-4 lg:col-span-5">
          <div className="panel p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <label className="font-mono text-[11px] tracking-[0.1em] text-dim uppercase">
                分析标的 / 公司名称
              </label>
              <div className="flex items-center gap-1.5">
                {SAMPLE_REPORTS.map((sample, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setCompany(sample.company)
                      setText(sample.text)
                    }}
                    className="rounded border border-line px-2 py-0.5 font-mono text-[10px] text-faint transition hover:border-gold/40 hover:text-gold"
                  >
                    {idx === 0 ? '加载苹果范例' : '加载大马银行范例'}
                  </button>
                ))}
              </div>
            </div>

            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="例如 Apple Inc. (AAPL) 或 Maybank (1155.KL)"
              className="w-full rounded-lg border border-line bg-void/70 px-3 py-2 font-mono text-[12px] text-ink transition placeholder:text-faint/70 focus:border-gold/55"
            />

            <div>
              <label className="font-mono text-[11px] tracking-[0.1em] text-dim uppercase">
                粘贴财报、电话会议纪要或研报正文
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                placeholder="请在此粘贴长文、财报亮点、新闻稿或纪要..."
                className="mt-1.5 w-full rounded-lg border border-line bg-void/70 p-3 font-mono text-[11.5px] leading-relaxed text-ink transition placeholder:text-faint/70 focus:border-gold/55"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-bear/40 bg-bear/10 p-2.5 text-[11px] text-bear">
                <ShieldAlert className="size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="button"
              disabled={loading || !text.trim()}
              onClick={() => void handleAnalyze()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gold/50 bg-gold/20 py-2.5 font-mono text-[12px] font-medium text-gold transition hover:bg-gold/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  <span>AI 正在进行深度四维解析与拆解…</span>
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  <span>开始 AI 深度结构化研报分析</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 输出结果展示面板 */}
        <div className="lg:col-span-7">
          <div className="panel p-4 min-h-[580px] flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-gold" />
                  <span className="font-mono text-xs font-semibold text-ink">
                    结构化投研报告输出区
                  </span>
                </div>
                {result && (
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-gold/30 bg-gold/10 px-2 py-0.5 font-mono text-[10px] text-gold">
                      {result.model}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 font-mono text-[10px] text-dim transition hover:border-gold/50 hover:text-gold"
                    >
                      {copied ? <Check className="size-3 text-bull" /> : <Copy className="size-3" />}
                      {copied ? '已复制' : '复制报告'}
                    </button>
                  </div>
                )}
              </div>

              {loading ? (
                <div className="flex flex-col items-center justify-center py-28 text-center">
                  <LoaderCircle className="size-8 animate-spin text-gold" />
                  <p className="mt-3 font-mono text-xs text-dim">
                    正在执行多维财务推演、业绩亮点提炼与风险评估…
                  </p>
                </div>
              ) : result ? (
                <div className="prose prose-invert max-w-none text-[12.5px] leading-relaxed text-ink whitespace-pre-wrap font-sans">
                  {result.report}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-28 text-center text-faint">
                  <Brain className="size-10 opacity-30 text-gold" />
                  <p className="mt-3 font-mono text-xs">
                    请在左侧输入标的名称并粘贴长文，点击“开始 AI 深度结构化研报分析”
                  </p>
                  <p className="mt-1 text-[11px] text-faint/70">
                    将自动按：1. 核心业绩亮点 2. 关键财务指标变化 3. 潜在风险点 4. 后续关注点 结构化输出
                  </p>
                </div>
              )}
            </div>

            <div className="border-t border-line/60 pt-3 mt-4 text-[10.5px] text-faint font-mono flex items-center justify-between">
              <span>Apex Research · 投研长文深度解析引擎</span>
              <span>所有内容由 AI 自动生成，仅供专业研究参考</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

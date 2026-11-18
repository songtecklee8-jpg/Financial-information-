import type {
  AiVerdict,
  Fundamentals,
  MacroRates,
  NewsArticle,
  Quote,
  Security,
  ValuationResult,
} from '@/types'
import { formatCompact, formatPercent, formatRatio } from '@/lib/format'

export interface AiContextInput {
  security: Security
  quote: Quote
  fundamentals: Fundamentals
  valuation: ValuationResult
  macro: MacroRates
  news: NewsArticle[]
}

function line(label: string, value: string): string {
  return `${label}: ${value}`
}

/** 把终端内的实时数据打包成结构化上下文，供 Gemini 分析 */
export function buildAiContext(input: AiContextInput): string {
  const { security, quote, fundamentals: f, valuation: v, macro, news } = input
  const cur = security.currency
  const related = news
    .filter(
      (item) =>
        item.tickers.includes(security.symbol) ||
        item.tickers.some((t) => t.startsWith(security.symbol.split('.')[0] ?? '')),
    )
    .slice(0, 4)
  const pool = related.length > 0 ? related : news.slice(0, 5)

  return [
    '=== 标的档案 ===',
    line('代码', security.symbol),
    line('名称', security.name),
    line('交易所', security.exchange),
    line('市场', security.market === 'BURSA' ? 'Bursa Malaysia (马股)' : 'United States (美股)'),
    line('行业', security.sector),
    line('计价货币', cur),

    '=== 实时行情 ===',
    line('最新价', `${cur} ${quote.price.toFixed(3)}`),
    line('涨跌幅', formatPercent(quote.changePercent, { signed: true })),
    line('日内区间', `${quote.dayLow.toFixed(2)} ~ ${quote.dayHigh.toFixed(2)}`),
    line('52 周区间', `${quote.fiftyTwoWeekLow.toFixed(2)} ~ ${quote.fiftyTwoWeekHigh.toFixed(2)}`),
    line('市值', formatCompact(quote.marketCap)),
    line('数据来源', quote.origin === 'live' ? 'Twelve Data 实时接口' : '终端内置基准数据'),

    '=== 基本面（TTM）===',
    line('EPS', f.eps.toFixed(4)),
    line('远期 EPS', f.forwardEps.toFixed(4)),
    line('每股净资产 (BVPS)', f.bookValuePerShare.toFixed(2)),
    line('营收', formatCompact(f.revenueTTM)),
    line('净利润', formatCompact(f.netIncomeTTM)),
    line('EBITDA', formatCompact(f.ebitda)),
    line('自由现金流', formatCompact(f.freeCashFlow)),
    line('ROE', `${f.roe.toFixed(1)}%`),
    line('毛利率', `${f.grossMargin.toFixed(1)}%`),
    line('净利率', `${f.netMargin.toFixed(1)}%`),
    line('自由现金流收益率', `${f.fcfYield.toFixed(2)}%`),
    line('每股股息', f.dividendPerShare.toFixed(4)),
    line('股息率', `${f.dividendYield.toFixed(2)}%`),
    line('派息率', `${f.payoutRatio.toFixed(1)}%`),
    line('近 5 年 EPS 增速', `${f.epsGrowth5y.toFixed(1)}%`),
    line('资产负债率 (D/E)', f.debtToEquity.toFixed(2)),
    line('流动比率', f.currentRatio.toFixed(2)),

    '=== 估值与量化诊断（终端引擎输出）===',
    line('当前 PE', formatRatio(v.currentPE, 1)),
    line('5 年平均 PE', Number.isFinite(v.avgPE5y) ? `${v.avgPE5y.toFixed(1)}x` : 'N/A'),
    line('PE 溢价/折价', formatPercent(v.pePremiumPct, { signed: true })),
    line('PB', formatRatio(v.pb, 2)),
    line('PEG', formatRatio(v.peg, 2)),
    line('EV/EBITDA', formatRatio(v.evEbitda, 1)),
    line('格雷厄姆数字', Number.isFinite(v.grahamNumber) ? v.grahamNumber.toFixed(2) : 'N/A'),
    line('历史中枢回归价值', Number.isFinite(v.meanReversionValue) ? v.meanReversionValue.toFixed(2) : 'N/A'),
    line('行业相对价值', Number.isFinite(v.industryRelativeValue) ? v.industryRelativeValue.toFixed(2) : 'N/A'),
    line('理论合理区间', `${v.fairValueLow.toFixed(2)} ~ ${v.fairValueHigh.toFixed(2)}`),
    line('安全边际', formatPercent(v.marginOfSafetyPct, { signed: true })),
    line('引擎综合评分', `${v.score}/100`),
    line('引擎裁决', v.verdict),
    ...v.factors.map((factor) => `  因子 ${factor.label}: ${factor.display} → ${Math.round(factor.score)}/100`),

    '=== 宏观利率环境 ===',
    line('美国 2Y 国债', `${macro.us2y.toFixed(2)}%`),
    line('美国 10Y 国债', `${macro.us10y.toFixed(2)}%`),
    line('美国 30Y 国债', `${macro.us30y.toFixed(2)}%`),
    line('马来西亚 MGS 3Y', `${macro.mgs3y.toFixed(2)}%`),
    line('马来西亚 MGS 5Y', `${macro.mgs5y.toFixed(2)}%`),
    line('马来西亚 MGS 10Y', `${macro.mgs10y.toFixed(2)}%`),
    line('BNM 隔夜政策利率 OPR', `${macro.opr.toFixed(2)}%`),
    line('美债 10Y - MGS 10Y 利差', `${macro.spread10y.toFixed(2)}%`),

    '=== 相关新闻（标题）===',
    ...pool.map((item) => `[${item.sourceName}] ${item.titleZh ?? item.title}`),
  ].join('\n')
}

export const VERDICT_INSTRUCTION = `你是一位资深的全球股票研究分析师，同时覆盖美股与马来西亚 Bursa 市场。
你会收到一份由终端量化引擎生成的结构化财务快照。请基于这些数据作出独立、克制的综合价值裁决。

要求：
1. verdict 必须是 UNDERVALUED / FAIRLY VALUED / OVERVALUED 三者之一，且必须与数据逻辑一致（不要与引擎评分明显矛盾而不解释）。
2. score 为 0-100 的综合性价比评分，分数越高代表越具投资价值。
3. 必须结合宏观利率（美国 10Y 国债、马来西亚 10Y MGS、BNM OPR）讨论贴现率与股息吸引力的关系；马来西亚标的需以令吉利率为基准。
4. 金融板块（银行）不适用 EV/EBITDA 与毛利率，请以 PB-ROE 与股息可持续性替代。
5. 若标的属于马股，请额外考虑令吉汇率、Bursa 流动性与本地机构资金流向。
6. 全部输出使用简体中文；专业术语可保留英文缩写。数字必须来自给定数据，禁止编造。
7. thesis 控制在 120 字以内；bullish / bearish 各 2-4 条，每条 30 字以内；catalyst 与 risks 各不超过 60 字。`

export function buildVerdictPayload(input: AiContextInput): string {
  return `${buildAiContext(input)}\n\n请基于以上数据输出 JSON 格式的综合价值裁决。`
}

export function buildChatSystemInstruction(): string {
  return `你是「APEX Terminal」内置的 AI 金融研究助理，服务对象是专业投资者。
你可以访问当前终端的实时快照数据（行情、基本面、估值诊断、宏观利率与新闻）。
回答要求：
1. 用简体中文，语气专业、克制、结论先行。
2. 必须引用给定数据中的具体数字来支撑结论，不要编造未提供的数据。
3. 若用户要求「重新调整计算权重」，请明确给出你建议的新权重表（例如 PE 历史中枢 30%、安全边际 25% …），并说明调整后的评分方向。
4. 涉及马股时以令吉与 BNM 政策利率为分析基准。
5. 不提供投资建议或买卖指令，只做基于数据的分析。回答尽量控制在 400 字以内。`
}

export function buildChatContextBlock(input: AiContextInput): string {
  return `以下为当前终端正在查看的标的快照，请以此为事实基础回答用户问题：\n\n${buildAiContext(input)}`
}

/** 未配置 Gemini Key 时的本地裁决（由量化引擎结果直接推导，保证卡片永不空白） */
export function localVerdict(valuation: ValuationResult, security: Security): AiVerdict {
  const { score, verdict } = valuation
  const bias =
    verdict === 'UNDERVALUED'
      ? '当前定价低于量化模型的内在价值中枢'
      : verdict === 'OVERVALUED'
        ? '当前定价已高于量化模型的内在价值中枢'
        : '当前定价与量化模型的内在价值中枢基本吻合'

  const top = [...valuation.factors].sort((a, b) => b.score * b.weight - a.score * a.weight).slice(0, 3)
  const weak = [...valuation.factors].sort((a, b) => a.score - b.score).slice(0, 3)

  return {
    verdict,
    score,
    headline: `${security.symbol} ${bias}`,
    thesis: `${security.name} 的量化综合评分为 ${score}/100，安全边际为 ${formatPercent(valuation.marginOfSafetyPct, {
      signed: true,
    })}，理论合理股价区间为 ${valuation.fairValueLow.toFixed(2)} ~ ${valuation.fairValueHigh.toFixed(2)}。${bias}。此为本地量化引擎结论，配置 Gemini API Key 后可获取结合宏观利率与新闻的深度研报。`,
    bullish: top.map((factor) => `${factor.label}：${factor.comment}`),
    bearish: weak.map((factor) => `${factor.label}：${factor.comment}`),
    catalyst: '需要后续财报验证盈利趋势与股息可持续性，配置 Gemini Key 可获得完整催化剂分析。',
    risks: '本地结论仅基于量化口径，未纳入最新管理层指引、行业事件与政策变动。',
    generatedAt: new Date().toISOString(),
    model: 'local-quant-engine',
  }
}

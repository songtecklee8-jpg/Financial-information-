import type {
  Currency,
  Fundamentals,
  MacroRates,
  ScoreFactor,
  Security,
  ValuationResult,
  Verdict,
} from '@/types'
import { clamp } from '@/lib/format'

/**
 * 量化估值引擎
 * ---------------------------------------------------------------------------
 * 内在价值中枢由 4 条互相独立的价值锚合成（缺失的锚会被剔除并按剩余权重归一化）：
 *   1. 历史中枢回归   : 5 年平均 PE × TTM EPS
 *   2. 远期盈利锚     : 远期 EPS × (5 年平均 PE 与行业 PE 的均值)
 *   3. 行业相对锚     : 行业 PE × TTM EPS
 *   4. 格雷厄姆数字   : √(22.5 × EPS × BVPS)
 *
 * 格雷厄姆数字是"资产+盈利"的毛估法，对轻资产 / 因回购导致账面净资产极低的
 * 公司会系统性低估，因此仅当它落在当期股价的 0.35× ~ 2.5× 区间内才纳入中枢。
 */

const ANCHOR_WEIGHTS = {
  meanReversion: 0.35,
  forward: 0.25,
  industry: 0.2,
  graham: 0.2,
} as const

const FACTOR_WEIGHTS = {
  peVsHistory: 0.24,
  marginOfSafety: 0.26,
  peg: 0.16,
  roe: 0.13,
  dividend: 0.09,
  evEbitda: 0.06,
  fcfYield: 0.06,
} as const

export interface ValuationInput {
  security: Security
  fundamentals: Fundamentals
  price: number
  currency: Currency
  macro: MacroRates
}

function riskFreeRate(currency: Currency, macro: MacroRates): number {
  return currency === 'MYR' ? macro.mgs10y : macro.us10y
}

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return Number.NaN
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function grahamNumber(eps: number, bookValuePerShare: number): number {
  if (!(eps > 0) || !(bookValuePerShare > 0)) return Number.NaN
  return Math.sqrt(22.5 * eps * bookValuePerShare)
}

/** 综合性价比评分 + 裁决 */
export function computeValuation(input: ValuationInput): ValuationResult {
  const { security, price, currency, macro } = input
  const f = input.fundamentals
  const isFinancial = security.sector === 'Financials'
  const rf = riskFreeRate(currency, macro)

  const currentPE = price > 0 && f.eps > 0 ? price / f.eps : Number.NaN
  const pb = f.bookValuePerShare > 0 ? price / f.bookValuePerShare : Number.NaN
  const avgPE5y = f.pe5yAvg > 0 ? f.pe5yAvg : Number.NaN
  const pePremiumPct =
    Number.isFinite(currentPE) && Number.isFinite(avgPE5y)
      ? ((currentPE - avgPE5y) / avgPE5y) * 100
      : Number.NaN

  const notes: string[] = []
  const anchors: Array<{ key: string; value: number; weight: number }> = []

  const meanReversionValue = Number.isFinite(avgPE5y) && f.eps > 0 ? avgPE5y * f.eps : Number.NaN
  if (Number.isFinite(meanReversionValue) && meanReversionValue > 0) {
    anchors.push({ key: 'meanReversion', value: meanReversionValue, weight: ANCHOR_WEIGHTS.meanReversion })
  }

  const blendedPE =
    Number.isFinite(avgPE5y) && security.industryPE > 0
      ? (avgPE5y + security.industryPE) / 2
      : Number.isFinite(avgPE5y)
        ? avgPE5y
        : security.industryPE
  const forwardEps = f.forwardEps > 0 ? f.forwardEps : f.eps
  const forwardValue = forwardEps > 0 && blendedPE > 0 ? blendedPE * forwardEps : Number.NaN
  if (Number.isFinite(forwardValue) && forwardValue > 0) {
    anchors.push({ key: 'forward', value: forwardValue, weight: ANCHOR_WEIGHTS.forward })
  }

  const industryValue = security.industryPE > 0 && f.eps > 0 ? security.industryPE * f.eps : Number.NaN
  if (Number.isFinite(industryValue) && industryValue > 0) {
    anchors.push({ key: 'industry', value: industryValue, weight: ANCHOR_WEIGHTS.industry })
  }

  const g = grahamNumber(f.eps, f.bookValuePerShare)
  const grahamRatio = Number.isFinite(g) && price > 0 ? g / price : Number.NaN
  const grahamUsable =
    Number.isFinite(grahamRatio) && grahamRatio >= 0.35 && grahamRatio <= 2.5
  if (grahamUsable) {
    anchors.push({ key: 'graham', value: g, weight: ANCHOR_WEIGHTS.graham })
  } else if (Number.isFinite(g) && grahamRatio < 0.35) {
    notes.push(
      '格雷厄姆数字（资产+盈利毛估法）对轻资产、高 ROE 或大额回购的公司会系统性偏低，本模型已将其从内在价值中枢中剔除，仅作参考。',
    )
  } else if (Number.isFinite(g) && grahamRatio > 2.5) {
    notes.push(
      '格雷厄姆数字显著高于市价，通常源于每股净资产被一次性项目或资产重估推高，模型已将其从中枢中剔除以避免高估。',
    )
  }

  const totalWeight = anchors.reduce((sum, a) => sum + a.weight, 0)
  const fairValueMid =
    totalWeight > 0
      ? anchors.reduce((sum, a) => sum + a.value * a.weight, 0) / totalWeight
      : price

  // 离散度决定合理区间宽度（各锚分歧越大，区间越宽）
  let spread = 0.08
  if (anchors.length > 1) {
    const mean = anchors.reduce((s, a) => s + a.value, 0) / anchors.length
    const variance =
      anchors.reduce((s, a) => s + (a.value - mean) ** 2, 0) / anchors.length
    spread = Number.isFinite(mean) && mean > 0 ? Math.sqrt(variance) / mean : 0.08
  }
  const band = clamp(spread, 0.06, 0.22) + 0.02
  const fairValueLow = fairValueMid * (1 - band)
  const fairValueHigh = fairValueMid * (1 + band)

  const marginOfSafetyPct =
    fairValueMid > 0 ? ((fairValueMid - price) / fairValueMid) * 100 : Number.NaN

  // ------------------------------------------------------------------ 分项打分
  const factors: ScoreFactor[] = []

  if (Number.isFinite(pePremiumPct)) {
    const discount = -pePremiumPct / 100
    factors.push({
      key: 'peVsHistory',
      label: 'PE vs 5 年均值',
      display: `${currentPE.toFixed(1)}x / ${avgPE5y.toFixed(1)}x`,
      score: clamp(50 + discount * 160, 3, 97),
      weight: FACTOR_WEIGHTS.peVsHistory,
      comment:
        discount >= 0
          ? `较 5 年均值折价 ${(discount * 100).toFixed(1)}%，估值处于历史低位区间。`
          : `较 5 年均值溢价 ${(-discount * 100).toFixed(1)}%，需要盈利增长消化。`,
    })
  } else {
    factors.push({
      key: 'peVsHistory',
      label: 'PE vs 5 年均值',
      display: 'N/A',
      score: 35,
      weight: FACTOR_WEIGHTS.peVsHistory,
      comment: 'TTM 每股收益为负，市盈率口径失效，估值以市净率与资产质量为主。',
    })
    if (f.eps <= 0) {
      notes.push('当前 TTM EPS 为负值，PE、PEG 与格雷厄姆数字均不适用，模型已自动降级为 PB / 股息主导的评分。')
    }
  }

  if (Number.isFinite(marginOfSafetyPct)) {
    factors.push({
      key: 'marginOfSafety',
      label: '安全边际 (Margin of Safety)',
      display: `${marginOfSafetyPct >= 0 ? '+' : ''}${marginOfSafetyPct.toFixed(1)}%`,
      score: clamp(50 + marginOfSafetyPct * 1.6, 3, 97),
      weight: FACTOR_WEIGHTS.marginOfSafety,
      comment:
        marginOfSafetyPct >= 15
          ? '价格显著低于模型中枢，具备较厚的价值缓冲垫。'
          : marginOfSafetyPct >= 0
            ? '价格略低于模型中枢，安全边际偏薄。'
            : '价格高于模型中枢，买入即承担估值回归风险。',
    })
  }

  const pegValue =
    Number.isFinite(f.peg) && f.peg > 0 ? f.peg : Number.NaN
  if (f.epsGrowth5y > 0.5 && Number.isFinite(pegValue)) {
    factors.push({
      key: 'peg',
      label: 'PEG 比率',
      display: `${pegValue.toFixed(2)}x`,
      score: clamp(115 - pegValue * 30, 3, 97),
      weight: FACTOR_WEIGHTS.peg,
      comment:
        pegValue < 1
          ? 'PEG 低于 1，盈利增速足以支撑当前估值。'
          : pegValue < 2
            ? 'PEG 处于 1~2 区间，估值与增速基本匹配。'
            : 'PEG 明显高于 2，估值已大幅透支未来增长。',
    })
  } else {
    factors.push({
      key: 'peg',
      label: 'PEG 比率',
      display: 'N/A',
      score: f.epsGrowth5y <= 0.5 ? 30 : 50,
      weight: FACTOR_WEIGHTS.peg,
      comment:
        f.epsGrowth5y <= 0.5
          ? `近 5 年 EPS 增速为 ${f.epsGrowth5y.toFixed(1)}%，盈利缺乏增长动能，PEG 不适用。`
          : '缺少可靠的长期盈利增速数据，PEG 不适用。',
    })
  }

  if (Number.isFinite(f.roe)) {
    const effRoe = clamp(f.roe, 0, 25)
    factors.push({
      key: 'roe',
      label: 'ROE（净资产收益率）',
      display: `${f.roe.toFixed(1)}%`,
      score: clamp(30 + effRoe * 2.6, 3, 97),
      weight: FACTOR_WEIGHTS.roe,
      comment:
        f.roe >= 15
          ? 'ROE 高于 15%，具备优质复利能力。'
          : f.roe >= 8
            ? 'ROE 处于合理水平，股东回报能力中等。'
            : 'ROE 偏低，资本使用效率有待改善。',
    })
  }

  {
    const yieldGap = f.dividendYield - rf
    factors.push({
      key: 'dividend',
      label: '股息率 vs 无风险利率',
      display: f.dividendYield > 0 ? `${f.dividendYield.toFixed(2)}%` : '无派息',
      score: f.dividendYield > 0 ? clamp(35 + yieldGap * 10, 3, 97) : 25,
      weight: FACTOR_WEIGHTS.dividend,
      comment:
        f.dividendYield <= 0
          ? '公司当前不派息，现金回报依赖资本利得。'
          : yieldGap >= 0
            ? `股息率较 ${currency === 'MYR' ? '马来西亚 10Y MGS' : '美国 10Y 国债'} 高出 ${yieldGap.toFixed(2)} 个百分点，具备类债券吸引力。`
            : `股息率低于无风险利率 ${(-yieldGap).toFixed(2)} 个百分点，收益吸引力有限。`,
    })
  }

  if (!isFinancial && Number.isFinite(f.evEbitda)) {
    factors.push({
      key: 'evEbitda',
      label: 'EV / EBITDA',
      display: `${f.evEbitda.toFixed(1)}x`,
      score: clamp(75 - (f.evEbitda - 6) * 5, 3, 97),
      weight: FACTOR_WEIGHTS.evEbitda,
      comment:
        f.evEbitda < 10
          ? '企业价值倍数偏低，整体收购成本不高。'
          : f.evEbitda < 18
            ? '企业价值倍数处于中性区间。'
            : '企业价值倍数偏高，隐含较高的增长预期。',
    })
  } else if (isFinancial) {
    notes.push('金融板块（银行/保险）的 EV/EBITDA 与毛利率口径不具可比性，模型已自动改由 PB-ROE、股息与盈利质量维度主导评分。')
  }

  if (!isFinancial && Number.isFinite(f.fcfYield)) {
    factors.push({
      key: 'fcfYield',
      label: '自由现金流收益率',
      display: `${f.fcfYield.toFixed(2)}%`,
      score: clamp(35 + f.fcfYield * 7, 3, 97),
      weight: FACTOR_WEIGHTS.fcfYield,
      comment:
        f.fcfYield >= 5
          ? '自由现金流充沛，内生造血能力强。'
          : f.fcfYield >= 2
            ? '自由现金流收益率中等，资本开支压力可控。'
            : '自由现金流收益率偏低，需关注盈利质量。',
    })
  }

  const weightSum = factors.reduce((sum, factor) => sum + factor.weight, 0)
  const score =
    weightSum > 0
      ? factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0) / weightSum
      : 50

  let verdict: Verdict = 'FAIRLY VALUED'
  if (score >= 62) verdict = 'UNDERVALUED'
  else if (score < 42) verdict = 'OVERVALUED'

  if (Number.isFinite(marginOfSafetyPct) && marginOfSafetyPct >= 20 && verdict === 'UNDERVALUED') {
    notes.push('股价低于模型中枢 20% 以上，安全边际充足，但仍需核查是否存在基本面恶化或价值陷阱。')
  }

  return {
    currentPrice: price,
    currency,
    currentPE: round(currentPE, 2),
    avgPE5y: Number.isFinite(avgPE5y) ? round(avgPE5y, 2) : Number.NaN,
    pePremiumPct: round(pePremiumPct, 1),
    pb: round(pb, 2),
    peg: round(f.peg, 2),
    evEbitda: isFinancial ? Number.NaN : round(f.evEbitda, 1),
    roe: round(f.roe, 1),
    grossMargin: isFinancial ? Number.NaN : round(f.grossMargin, 1),
    dividendYield: round(f.dividendYield, 2),
    grahamNumber: round(g, 2),
    meanReversionValue: round(meanReversionValue, 2),
    industryRelativeValue: round(industryValue, 2),
    fairValueLow: round(fairValueLow, 2),
    fairValueHigh: round(fairValueHigh, 2),
    fairValueMid: round(fairValueMid, 2),
    marginOfSafetyPct: round(marginOfSafetyPct, 1),
    score: Math.round(clamp(score, 0, 100)),
    verdict,
    factors,
    notes,
  }
}

export const VERDICT_META: Record<
  Verdict,
  { label: string; zh: string; tone: string; ring: string; text: string; bg: string }
> = {
  UNDERVALUED: {
    label: 'UNDERVALUED',
    zh: '低估',
    tone: 'bull',
    ring: 'border-bull/45',
    text: 'text-bull',
    bg: 'bg-bull/12',
  },
  'FAIRLY VALUED': {
    label: 'FAIRLY VALUED',
    zh: '合理',
    tone: 'gold',
    ring: 'border-gold/45',
    text: 'text-gold',
    bg: 'bg-gold/12',
  },
  OVERVALUED: {
    label: 'OVERVALUED',
    zh: '高估',
    tone: 'bear',
    ring: 'border-bear/45',
    text: 'text-bear',
    bg: 'bg-bear/12',
  },
}

export function scoreTone(score: number): string {
  if (score >= 62) return 'text-bull'
  if (score >= 42) return 'text-gold'
  return 'text-bear'
}

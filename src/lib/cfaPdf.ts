import type { CfaTopicId, CfaUnit } from '@/types'

export interface CfaTopicMeta {
  id: CfaTopicId
  code: string
  nameEn: string
  nameZh: string
  weight2027: string
}

export const CFA_TOPICS: CfaTopicMeta[] = [
  { id: 'ethics', code: 'ETH', nameEn: 'Ethical and Professional Standards', nameZh: '道德与职业准则', weight2027: '15%–20%' },
  { id: 'quant', code: 'QM', nameEn: 'Quantitative Methods', nameZh: '数量分析', weight2027: '6%–9%' },
  { id: 'econ', code: 'ECON', nameEn: 'Economics', nameZh: '经济学', weight2027: '6%–9%' },
  { id: 'fsa', code: 'FSA', nameEn: 'Financial Statement Analysis', nameZh: '财务报表分析', weight2027: '11%–14%' },
  { id: 'corp', code: 'CI', nameEn: 'Corporate Issuers', nameZh: '公司发行人', weight2027: '6%–9%' },
  { id: 'equity', code: 'EQ', nameEn: 'Equity Investments', nameZh: '权益投资', weight2027: '11%–14%' },
  { id: 'fi', code: 'FI', nameEn: 'Fixed Income', nameZh: '固定收益', weight2027: '11%–14%' },
  { id: 'deriv', code: 'DER', nameEn: 'Derivatives', nameZh: '衍生品', weight2027: '5%–8%' },
  { id: 'alt', code: 'ALT', nameEn: 'Alternative Investments', nameZh: '另类投资', weight2027: '7%–10%' },
  { id: 'pm', code: 'PM', nameEn: 'Portfolio Management', nameZh: '投资组合管理', weight2027: '8%–12%' },
]

export function topicMeta(id: CfaTopicId): CfaTopicMeta {
  return CFA_TOPICS.find((t) => t.id === id) ?? CFA_TOPICS[0]!
}

/**
 * 浏览器端纯本地 PDF 文本提取（基于 pdfjs-dist，不上传服务器）。
 */
export async function extractTextFromPdf(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  const buffer = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: buffer })
  const doc = await loadingTask.promise
  const totalPages = doc.numPages
  const pageTexts: string[] = []

  for (let i = 1; i <= totalPages; i += 1) {
    onProgress?.(i, totalPages)
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const lines = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (lines) {
      pageTexts.push(`[Page ${i}]\n${lines}`)
    }
  }

  return {
    text: pageTexts.join('\n\n'),
    pages: totalPages,
  }
}

function makeUnitId(topicId: CfaTopicId, idx: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)
  return `${topicId}-${Date.now().toString(36)}-${idx}-${slug || 'unit'}`
}

/**
 * 基于规则将 2027 Handbook 原文自动拆分为 Topic -> Unit (Learning Module) 结构。
 * 支持常见标识：Learning Module / LM / Reading / Chapter / Module。
 */
export function splitHandbookTextRuleBased(
  rawText: string,
  topicId: CfaTopicId,
  sourceName: string,
  startOrder = 1,
  customSingleTitle?: string,
): CfaUnit[] {
  const cleaned = rawText.replace(/\r\n/g, '\n').trim()
  if (!cleaned) return []

  if (customSingleTitle?.trim()) {
    const meta = topicMeta(topicId)
    return [
      {
        id: makeUnitId(topicId, startOrder, customSingleTitle),
        topicId,
        code: `${meta.code} LM ${startOrder}`,
        title: customSingleTitle.trim(),
        rawText: cleaned,
        sourceName: sourceName || '2027 Handbook 导入',
        status: 'not_started',
        order: startOrder,
      },
    ]
  }

  const headingRegex =
    /(?:^|\n)\s*((?:Learning\s+Module|LM|Reading|Module|Chapter)\s+\d+(?:\.\d+)?[:.\s-]*[^\n]{2,90})/gi
  const matches = Array.from(cleaned.matchAll(headingRegex))
  const meta = topicMeta(topicId)

  if (matches.length >= 2) {
    const units: CfaUnit[] = []
    for (let i = 0; i < matches.length; i += 1) {
      const m = matches[i]!
      const start = m.index ?? 0
      const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? cleaned.length) : cleaned.length
      const chunk = cleaned.slice(start, end).trim()
      if (chunk.length < 40) continue
      const headerLine = m[1]!.trim().replace(/\s+/g, ' ')
      const codeMatch = /^(?:Learning\s+Module|LM|Reading|Module|Chapter)\s+(\d+(?:\.\d+)?)/i.exec(headerLine)
      const lmNo = codeMatch ? codeMatch[1] : String(startOrder + units.length)
      const cleanTitle = headerLine
        .replace(/^(?:Learning\s+Module|LM|Reading|Module|Chapter)\s+\d+(?:\.\d+)?[:.\s-]*/i, '')
        .trim()
      units.push({
        id: makeUnitId(topicId, startOrder + units.length, cleanTitle || headerLine),
        topicId,
        code: `${meta.code} LM ${lmNo}`,
        title: cleanTitle || headerLine,
        rawText: chunk,
        sourceName: sourceName || '2027 Handbook PDF/原文',
        status: 'not_started',
        order: startOrder + units.length,
      })
    }
    if (units.length > 0) return units
  }

  // 若未检测到多个显式 LM 标题，则作为单个完整 Learning Module 导入（如超长则提示按字数自动分节）
  if (cleaned.length > 26_000) {
    const chunkSize = 16_000
    const parts: CfaUnit[] = []
    for (let offset = 0, idx = 0; offset < cleaned.length; offset += chunkSize, idx += 1) {
      const slice = cleaned.slice(offset, offset + chunkSize).trim()
      if (!slice) continue
      const firstLine =
        slice
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.length >= 4 && l.length <= 80) ?? `Part ${idx + 1}`
      parts.push({
        id: makeUnitId(topicId, startOrder + idx, firstLine),
        topicId,
        code: `${meta.code} LM ${startOrder + idx}`,
        title: `${firstLine.slice(0, 48)}${idx > 0 ? ` (Part ${idx + 1})` : ''}`,
        rawText: slice,
        sourceName: sourceName || '2027 Handbook',
        status: 'not_started',
        order: startOrder + idx,
      })
    }
    return parts
  }

  const firstHeading =
    cleaned
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length >= 4 && l.length <= 90 && !l.startsWith('[Page ')) ??
    `${meta.nameZh} Learning Module ${startOrder}`

  return [
    {
      id: makeUnitId(topicId, startOrder, firstHeading),
      topicId,
      code: `${meta.code} LM ${startOrder}`,
      title: firstHeading,
      rawText: cleaned,
      sourceName: sourceName || '2027 Handbook',
      status: 'not_started',
      order: startOrder,
    },
  ]
}

/** 预置两节 2027 CFA L1 示例 Learning Module，开箱即可体验精讲、BA II Plus 按键与刷题 */
export const STARTER_CFA_UNITS: CfaUnit[] = [
  {
    id: 'starter-qm-lm1',
    topicId: 'quant',
    code: 'QM LM 1',
    title: 'Rates and Returns & Time Value of Money',
    sourceName: '2027 CFA L1 Handbook Starter Sample',
    status: 'not_started',
    order: 1,
    rawText: `CFA Level I Quantitative Methods — Learning Module: Rates and Returns & Time Value of Money (2027 Curriculum).
1. Components of an Interest Rate: The required interest rate on a security equals the real risk-free rate plus expected inflation plus default risk premium plus liquidity risk premium plus maturity risk premium.
r = r_real + E(I) + DRP + LRP + MRP.
The nominal risk-free rate is approximated as r_f ≈ r_real + E(I), or exactly (1 + r_nominal) = (1 + r_real)(1 + E(I)).
2. Effective Annual Rate (EAR): When stated annual rate r_s is compounded m times per year, EAR = (1 + r_s / m)^m - 1. For continuous compounding, EAR = e^(r_s) - 1.
3. Holding Period Return (HPR): HPR = (P_1 - P_0 + D_1) / P_0. Money-weighted rate of return (MWRR) is the internal rate of return (IRR) setting PV of cash inflows equal to PV of cash outflows (sensitive to timing and size of cash flows, computed using BA II Plus [CF] and [IRR]). Time-weighted rate of return (TWRR) measures compound growth rate of $1 invested over the evaluation period without distortion from external cash inflows/outflows: TWRR = [(1+HPR_1)(1+HPR_2)...(1+HPR_n)]^(1/n) - 1.
4. Time Value of Money (TVM) & Annuities:
Ordinary annuity pays at the end of each period (BA II Plus END mode). Annuity due pays at the beginning of each period (BA II Plus BGN mode; PV_due = PV_ordinary * (1 + r)).
Perpetuity present value: PV = PMT / r (first cash flow at t = 1). If first payment is deferred, discount back to t = 0.
BA II Plus TVM keys: [N], [I/Y] (entered as percentage, e.g. 6 for 6%), [PV], [PMT], [FV], [CPT]. Remember sign convention: cash inflows positive, cash outflows negative.`,
  },
  {
    id: 'starter-fi-lm1',
    topicId: 'fi',
    code: 'FI LM 1',
    title: 'Fixed-Income Bond Valuation, Yield Measures & Duration',
    sourceName: '2027 CFA L1 Handbook Starter Sample',
    status: 'not_started',
    order: 2,
    rawText: `CFA Level I Fixed Income — Learning Module: Bond Valuation, Yield Measures and Duration (2027 Curriculum).
1. Bond Pricing & Cash Flow Discounting: A fixed-coupon bond price equals the present value of expected coupon payments and par value discounted at the market yield-to-maturity (YTM). Using BA II Plus for a semiannual bond: N = years * 2, I/Y = annual YTM / 2, PMT = (Coupon Rate * Par) / 2, FV = Par, then CPT PV.
2. Price-Yield Relationship: Bond prices and market yields move inversely. Because of positive convexity on option-free bonds, the percentage price increase when yield falls is larger than the percentage price decrease when yield rises by the same basis points.
3. Clean vs. Dirty Price: Full (dirty) price = Flat (clean) price + Accrued Interest (AI). AI = (t / T) * PMT, where t is days since last coupon and T is days in coupon period. Bond dealers quote flat (clean) prices, while buyers pay the full (dirty) price at settlement.
4. Yield Measures: Current yield = Annual Coupon / Flat Price. Yield-to-Call (YTC) assumes bond is called at the first call date at the call price. Yield-to-Worst (YTW) is the minimum of YTM and all YTCs.
5. Macaulay, Modified, and Effective Duration:
Macaulay Duration (MacDur) is the weighted average time to receipt of cash flows.
Modified Duration (ModDur) = MacDur / (1 + r), where r is yield per period. Approximate ModDur = (PV_- - PV_+) / (2 * ΔYield * PV_0). Estimated %ΔPV ≈ -ModDur * ΔY + 0.5 * Convexity * (ΔY)^2.
Effective Duration (EffDur) must be used for bonds with embedded options (callable/putable) because future cash flows change when yields shift: EffDur = (PV_- - PV_+) / (2 * ΔCurve * PV_0).`,
  },
]

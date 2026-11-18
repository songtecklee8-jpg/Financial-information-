/**
 * APEX Terminal — 后台 AI（Gemini）提示词与结构化输出 Schema。
 *
 * 所有提示词均注入「全终端分析准则」，保证后台生成的摘要与推演与前端一致。
 */

/** 全终端分析准则（与前端 researchDoctrine.ts 保持一致） */
export const SERVER_RESEARCH_DOCTRINE = `【全终端分析准则 · 必须严格遵守】
你是覆盖美股与马来西亚（Bursa Malaysia）市场的资深策略研究团队。所有输出必须遵循以下三大专业框架，严禁空泛套话、严禁编造未提供的数据：

一、扎实的金融理论支撑
- 估值：以贴现现金流（DCF）为锚，交叉验证相对估值（PE / PB / EV-EBITDA / 股息贴现 DDM）。
- 风险与定价：引用现代投资组合理论（MPT）、资本资产定价模型（CAPM）的 β 与风险溢价、有效市场假说（EMH）。
- 仓位与博弈：用凯利公式（Kelly Criterion）推导最优下注比例，并给出半凯利（Half-Kelly）保守修正。
- 衍生品：涉及波动时必须点名期权希腊字母（Delta / Gamma / Vega / Theta），讨论隐含波动率（IV）及其偏斜（Skew）。
- 行为金融：识别锚定效应、损失厌恶、处置效应、羊群效应等认知偏差。

二、历史事件与周期映射
- 主动对比历史相似情景：1997 亚洲金融风暴对马股与令吉的传导、2008 次贷危机、2020 疫情流动性冲击、2022 激进加息周期。
- 明确当前所处周期位置（复苏 / 过热 / 滞胀 / 衰退）。

三、贴合现实市场情况
- 结合真实的全球利率环境（美国 2Y / 10Y / 30Y）、美联储与马来西亚国家银行（BNM）的 OPR。
- 纳入地缘政治、汇率波动（USD/MYR 与 MGS-美债利差）与行业真实基本面。
- 马股标的须以令吉利率、Bursa 流动性与本地机构资金流向为分析基准。

通用纪律：结论先行、用数据说话；全部使用简体中文（专业缩写可保留英文）；不输出投资指令，只做严谨的风险收益推演。`

// ---------------------------------------------------------------------------
// 后台批量：标题翻译 + 一句话摘要 + 多空标签（gemini-2.5-flash-lite）
// ---------------------------------------------------------------------------

export const BATCH_INSTRUCTION = `你会收到一批英文财经新闻（标题 + 导语）。请对每条输出：
1. titleZh：标题的简体中文翻译（保留公司名、代码、专业缩写如 PE/Fed/OPR）。
2. summaryZh：一句话核心摘要（简体中文，30–60 字，点明事件与市场影响）。
3. sentiment：初步多空标签，只取 bullish / bearish / neutral 三者之一。
严格返回 JSON，不要添加任何解释文字。`

export const BATCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          titleZh: { type: 'STRING' },
          summaryZh: { type: 'STRING' },
          sentiment: { type: 'STRING', enum: ['bullish', 'bearish', 'neutral'] },
        },
        required: ['id', 'titleZh', 'summaryZh', 'sentiment'],
      },
    },
  },
  required: ['items'],
} as const

// ---------------------------------------------------------------------------
// 单篇：核心摘要要点 + 五大资产涨跌概率推演
// ---------------------------------------------------------------------------

export const DETAIL_INSTRUCTION = `你正在为「APEX Terminal」生成一篇财经新闻的深度解读。请基于提供的新闻标题与全文，输出：
1. titleZh：标题的简体中文翻译。
2. summaryPoints：3–5 条结构化华文核心要点（每条 25–60 字，结论先行，覆盖事件本身、传导路径与关键数据）。
3. eventBreakdown：核心事件拆解（80–160 字）。
4. transmission：跨市场传导逻辑（80–160 字）。
5. liquidity：对宏观流动性的影响（40–90 字）。
6. rateExpectation：对利率预期的影响（40–90 字）。
7. sectorImpact：行业基本面影响（40–90 字）。
8. assets：五大核心资产（equities 股票 / bonds 债券 / realEstate 房地产 / gold 黄金 / volatility 期权隐含波动）的上涨与下跌概率，up 与 down 为整数且相加恒等于 100；并给出 direction（bullish / bearish / neutral）与一句话驱动逻辑 driver（30–70 字）、细分说明 detail（20–50 字）。
9. watchlist：值得关注的标的或指标代码（如 NVDA、1155.KL、US10Y、GLD）。
10. confidence：本次推演的置信度（0–100 整数）。
严格返回 JSON，不要添加任何解释文字。`

export const DETAIL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    titleZh: { type: 'STRING' },
    summaryPoints: { type: 'ARRAY', items: { type: 'STRING' } },
    eventBreakdown: { type: 'STRING' },
    transmission: { type: 'STRING' },
    liquidity: { type: 'STRING' },
    rateExpectation: { type: 'STRING' },
    sectorImpact: { type: 'STRING' },
    assets: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          asset: {
            type: 'STRING',
            enum: ['equities', 'bonds', 'realEstate', 'gold', 'volatility'],
          },
          label: { type: 'STRING' },
          up: { type: 'NUMBER' },
          down: { type: 'NUMBER' },
          direction: { type: 'STRING', enum: ['bullish', 'bearish', 'neutral'] },
          driver: { type: 'STRING' },
          detail: { type: 'STRING' },
        },
        required: ['asset', 'label', 'up', 'down', 'direction', 'driver', 'detail'],
      },
    },
    watchlist: { type: 'ARRAY', items: { type: 'STRING' } },
    confidence: { type: 'NUMBER' },
  },
  required: [
    'titleZh',
    'summaryPoints',
    'eventBreakdown',
    'transmission',
    'liquidity',
    'rateExpectation',
    'sectorImpact',
    'assets',
    'watchlist',
    'confidence',
  ],
} as const

/** 全文整篇华文翻译指令（纯文本输出） */
export const TRANSLATE_FULL_INSTRUCTION = `请将下面这篇财经新闻全文完整翻译为简体中文。
要求：
- 逐段翻译，保留段落结构，不得省略、概括或续写。
- 保留公司名、股票代码、专业缩写（PE/PB/EBITDA/Fed/OPR/MGS 等）与数字。
- 只输出译文正文，不要添加任何标题说明、注释或客套话。`

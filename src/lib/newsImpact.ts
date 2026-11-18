import type { AssetImpact, AssetKey, ImpactDirection, NewsArticle, NewsImpact } from '@/types'
import { hashString, mulberry32 } from '@/lib/prng'

/**
 * 未配置 Gemini Key 时的本地跨市场推演兜底。
 * 依据新闻情绪与代码做确定性推导，保证「AI 跨市场深度推演面板」永不空白。
 */

const ASSET_LABELS: Record<AssetKey, string> = {
  equities: '股票 Equities',
  bonds: '债券 Bonds',
  realEstate: '房地产 / REITs',
  gold: '黄金 Gold',
  volatility: '期权与波动率 Options',
}

export const ASSET_KEYS: AssetKey[] = ['equities', 'bonds', 'realEstate', 'gold', 'volatility']

export function assetLabel(key: AssetKey): string {
  return ASSET_LABELS[key]
}

function directionOf(up: number): ImpactDirection {
  if (up >= 58) return 'bullish'
  if (up <= 42) return 'bearish'
  return 'neutral'
}

function clampProbability(value: number): number {
  return Math.max(8, Math.min(92, Math.round(value)))
}

/** 各资产对「风险偏好上行」的方向敏感度（正=利多，负=利空） */
const SENSITIVITY: Record<AssetKey, number> = {
  equities: 16,
  bonds: -10,
  realEstate: -7,
  gold: -6,
  volatility: -13,
}

const DRIVERS: Record<AssetKey, (bias: number) => string> = {
  equities: (bias) =>
    bias > 0
      ? '风险偏好回暖，资金回流权益资产，美股大盘与科技股受益，马股外资净流入预期升温。'
      : bias < 0
        ? '避险情绪抬头压制估值扩张，高贝塔科技股与马股中小盘首当其冲。'
        : '多空因素相互抵消，指数大概率维持区间震荡。',
  bonds: (bias) =>
    bias > 0
      ? '增长与通胀预期走强，国债收益率易上难下，债券价格承压（美债与马股 MGS 同步）。'
      : bias < 0
        ? '避险买盘推动收益率回落，债券价格获得支撑，长端美债与 MGS 尤甚。'
        : '利率预期稳定，债券价格以票息收益为主。',
  realEstate: (bias) =>
    bias > 0
      ? '无风险利率上行抬高资本化率，商业地产与 REITs 估值分母端承压。'
      : bias < 0
        ? '利率下行预期改善融资成本，REITs 的股息吸引力相对提升。'
        : '利率与通胀预期变化有限，REITs 主要跟随租金基本面。',
  gold: (bias) =>
    bias > 0
      ? '实际利率走强、美元偏强，削弱无息资产吸引力，金价短线承压。'
      : bias < 0
        ? '避险需求与实际利率回落共同利多现货黄金。'
        : '美元与实际利率双向拉扯，金价维持震荡。',
  volatility: (bias) =>
    bias > 0
      ? '情绪修复令隐含波动率（IV）趋于回落，卖出波动率与 Put 策略占优。'
      : bias < 0
        ? '不确定性抬升 IV，保护性 Put 与做多波动率策略性价比上升。'
        : 'IV 处于中性区间，Call/Put 策略倾向均衡。',
}

const DETAILS: Record<AssetKey, string> = {
  equities: '美股大盘 / 科技股与马股（Bursa Malaysia）相关板块分开评估',
  bonds: '美债收益率与马来西亚 MGS 政府债券价格方向',
  realEstate: '商业地产与马股 / 美股 REITs 的利率敏感度',
  gold: '现货黄金对避险情绪与美元强弱的反应',
  volatility: '隐含波动率（IV）升降与 Call / Put 策略倾向',
}

export function localNewsImpact(article: NewsArticle): NewsImpact {
  const rand = mulberry32(hashString(`${article.id}:impact`))
  const bias = article.sentiment === 'bullish' ? 1 : article.sentiment === 'bearish' ? -1 : 0

  const assets: AssetImpact[] = ASSET_KEYS.map((key) => {
    const up = clampProbability(50 + bias * SENSITIVITY[key] + (rand() - 0.5) * 10)
    return {
      asset: key,
      label: ASSET_LABELS[key],
      up,
      down: 100 - up,
      direction: directionOf(up),
      driver: DRIVERS[key](bias),
      detail: DETAILS[key],
    }
  })

  const tone = bias > 0 ? '偏多' : bias < 0 ? '偏空' : '中性'
  return {
    articleId: article.id,
    headline: article.titleZh ?? article.title,
    eventBreakdown: `本条新闻整体情绪${tone}。核心事件围绕「${(article.titleZh ?? article.title).slice(0, 40)}」，需要结合后续官方表态与资金流数据验证其持续性。`,
    transmission: `传导路径：消息 → 风险偏好与利率预期 → 贴现率与盈利预期 → 各类资产定价。情绪${tone}会率先反映在与该事件关联度最高的板块上，再向跨市场蔓延。`,
    liquidity: bias >= 0 ? '流动性环境偏宽松，风险资产承接力较强。' : '流动性边际收紧，资金倾向防御性资产。',
    rateExpectation: bias >= 0 ? '利率预期中性偏上行，需关注央行措辞。' : '降息预期升温，长端利率有下行空间。',
    sectorImpact: article.tickers.length > 0 ? `直接相关标的：${article.tickers.slice(0, 6).join('、')}。` : '暂未识别到明确的直接受益 / 受损标的。',
    assets,
    watchlist: article.tickers.slice(0, 6),
    confidence: 42,
    generatedAt: new Date().toISOString(),
    model: 'local-heuristic',
    degraded: true,
  }
}

import type {
  ApiSettings,
  CfaLectureNote,
  CfaQaMessage,
  CfaQuestion,
  CfaQuestionMode,
  CfaUnit,
  RelayMeta,
} from '@/types'
import { topicMeta } from '@/lib/cfaPdf'
import { aiRoute, generateText, parseJsonBlock } from '@/lib/gemini'

function normalizeQuestion(
  raw: Record<string, unknown>,
  unit: CfaUnit,
  idx: number,
): CfaQuestion | null {
  const stem = String(raw.stem ?? '').trim()
  if (!stem) return null
  const opts =
    raw.options && typeof raw.options === 'object'
      ? (raw.options as Record<string, unknown>)
      : {}
  const optA = String(opts.A ?? '').trim()
  const optB = String(opts.B ?? '').trim()
  const optC = String(opts.C ?? '').trim()
  if (!optA || !optB || !optC) return null
  const ansRaw = String(raw.answer ?? 'A').trim().toUpperCase()
  const answer: 'A' | 'B' | 'C' = ansRaw === 'B' ? 'B' : ansRaw === 'C' ? 'C' : 'A'

  const rawDist =
    raw.distractorAnalysis && typeof raw.distractorAnalysis === 'object'
      ? (raw.distractorAnalysis as Record<string, unknown>)
      : null
  const distractorAnalysis: Partial<Record<'A' | 'B' | 'C', string>> | undefined = rawDist
    ? {
        ...(typeof rawDist.A === 'string' && rawDist.A.trim() ? { A: rawDist.A.trim() } : {}),
        ...(typeof rawDist.B === 'string' && rawDist.B.trim() ? { B: rawDist.B.trim() } : {}),
        ...(typeof rawDist.C === 'string' && rawDist.C.trim() ? { C: rawDist.C.trim() } : {}),
      }
    : undefined
  const hasDistractorNotes =
    distractorAnalysis && Object.keys(distractorAnalysis).length > 0

  return {
    id: `${unit.id}-q-${Date.now().toString(36)}-${idx}`,
    unitId: unit.id,
    unitTitle: `${unit.code} · ${unit.title}`,
    topicId: unit.topicId,
    stem,
    options: { A: optA, B: optB, C: optC },
    answer,
    explanation: String(raw.explanation ?? '').trim() || '请参考 Handbook 原文公式与边界条件推导。',
    distractorAnalysis: hasDistractorNotes ? distractorAnalysis : undefined,
    examTrap:
      typeof raw.examTrap === 'string' && raw.examTrap.trim() ? raw.examTrap.trim() : undefined,
    ba2Tip: typeof raw.ba2Tip === 'string' && raw.ba2Tip.trim() ? raw.ba2Tip.trim() : undefined,
    kind: raw.kind === 'calculation' ? 'calculation' : 'conceptual',
  }
}

function buildModeDirective(mode: CfaQuestionMode, isQuiz: boolean): string {
  if (mode === 'calculation') {
    return isQuiz
      ? '【出题偏好：计算题为主】请命制至少 4 道需要数值代入、公式转换或 BA II Plus 实务计算的题（若该章节纯定性如 Ethics，则转为复杂合规情景与数量化边界判定），仅保留不超过 1 道高难度概念边界题。'
      : '【出题偏好：计算题为主】本次必须优先命制带有明确财务数据条件、公式代入或 BA II Plus 计算步骤的实务计算题（kind="calculation"）；仅当该章完全不含可算指标时才改出高阶实务情景判定题。'
  }
  if (mode === 'conceptual') {
    return isQuiz
      ? '【出题偏好：概念/准则辨析为主】请侧重命制 CFA 经典情景判断、相似指标对比、公式前提假设与 MOST/LEAST likely 陷阱辨析题（可保留 1 道公式敏感性判断）。'
      : '【出题偏好：概念/准则辨析为主】本次必须命制聚焦易混概念辨析、公式适用前提/局限性、或准则细节判断的定性情景题（kind="conceptual"），严禁直接问教材死背定义。'
  }
  return isQuiz
    ? '【出题偏好：混合模拟真题】对齐真实 CFA Level 1 考场比例，均衡涵盖 2–3 道核心计算/公式推导题 与 2–3 道高迷惑性概念/情景辨析题。'
    : '【出题偏好：混合模拟真题】结合该单元考点特征，随机命制贴近历年真题难度的计算实务题或情景概念辨析题，确保题目具有区分度。'
}

export async function generateUnitLecture(
  unit: CfaUnit,
  settings: ApiSettings,
): Promise<CfaLectureNote> {
  const meta = topicMeta(unit.topicId)
  const system = `你是 CFA Level 1 (2027 考纲) 首席金牌讲师，擅长“跟着 Handbook 原文跟课式精讲”。
请严格基于用户提供的 2027 Handbook 本节原文，生成结构化跟课讲义（严禁脱离原文胡编未提及的数据，缺失细节须注明“原文未展开”）。
要求输出合法 JSON 对象，字段如下：
{
  "coreConcepts": [
    {
      "termEn": "英文金融专业术语",
      "termZh": "对应简体中文标准译名",
      "plainExplanation": "大白话+直观机制拆解，讲透为什么",
      "example": "紧扣本节的简明生活化/数字案例"
    }
  ],
  "formulasAndCalculator": [
    {
      "name": "公式或财务计算器模型名称",
      "formula": "数学表达式（清晰写出符号）",
      "variables": "每个变量含义与单位/正负号约定",
      "ba2PlusSteps": "德州仪器 TI BA II Plus 按键逻辑（例如：[2nd][CLR TVM] → 5 [N] → 6 [I/Y] → -1000 [PV] → [CPT][FV]；纯定性概念写明“本公式无需计算器按键”）"
    }
  ],
  "examFocus2027": [
    {
      "point": "2027 考纲高频考点/核心 LOS 动作词要求",
      "trap": "考场常见命题陷阱与避坑提示"
    }
  ],
  "summaryTakeaway": "100字以内的本节通关精华总结"
}
请输出 3-5 个核心概念、2-4 个必背公式/BA II Plus 按键（如为定性科目如 Ethics 则重点给判定标准与合规流程）、2-4 条 2027 考纲考点与陷阱。只输出 JSON，不要多余解释。`

  const res = await generateText({
    apiKey: settings.geminiKey,
    route: aiRoute(settings, 'pro'),
    systemInstruction: system,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `科目：${meta.nameEn} (${meta.nameZh})\n章节：${unit.code} - ${unit.title}\n\n2027 Handbook 原文：\n${unit.rawText.slice(0, 16_000)}`,
          },
        ],
      },
    ],
    temperature: 0.25,
    maxOutputTokens: 3500,
  })

  const parsed = parseJsonBlock<{
    coreConcepts?: Array<Record<string, unknown>>
    formulasAndCalculator?: Array<Record<string, unknown>>
    examFocus2027?: Array<Record<string, unknown>>
    summaryTakeaway?: string
  }>(res.text)

  return {
    unitId: unit.id,
    coreConcepts: Array.isArray(parsed.coreConcepts)
      ? parsed.coreConcepts.map((c) => ({
          termEn: String(c.termEn ?? '').trim(),
          termZh: String(c.termZh ?? '').trim(),
          plainExplanation: String(c.plainExplanation ?? '').trim(),
          example: String(c.example ?? '').trim(),
        })).filter((c) => c.termEn || c.plainExplanation)
      : [],
    formulasAndCalculator: Array.isArray(parsed.formulasAndCalculator)
      ? parsed.formulasAndCalculator.map((f) => ({
          name: String(f.name ?? '').trim(),
          formula: String(f.formula ?? '').trim(),
          variables: String(f.variables ?? '').trim(),
          ba2PlusSteps: String(f.ba2PlusSteps ?? '').trim(),
        })).filter((f) => f.name || f.formula)
      : [],
    examFocus2027: Array.isArray(parsed.examFocus2027)
      ? parsed.examFocus2027.map((e) => ({
          point: String(e.point ?? '').trim(),
          trap: String(e.trap ?? '').trim(),
        })).filter((e) => e.point)
      : [],
    summaryTakeaway: String(parsed.summaryTakeaway ?? '').trim(),
    generatedAt: new Date().toISOString(),
    relay: res.relay,
  }
}

export async function askUnitFollowup(
  unit: CfaUnit,
  question: string,
  history: CfaQaMessage[],
  settings: ApiSettings,
): Promise<{ answer: string; relay: RelayMeta }> {
  const meta = topicMeta(unit.topicId)
  const system = `你是 CFA Level 1 (2027 考纲) 一对一跟课辅导老师。
请严格依据以下已导入的 2027 Handbook 章节原文回答考生提问；若涉计算请顺带写出 BA II Plus 按键顺序与正负号约定，若考纲未涉及则诚实提示。回答条理清晰、通俗易懂，保留核心英文术语括号标注。

当前章节：${meta.nameZh} · ${unit.code} ${unit.title}
Handbook 原文节选：
${unit.rawText.slice(0, 12_000)}`

  const contents = [
    ...history.slice(-6).map((m) => ({
      role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      parts: [{ text: m.content }],
    })),
    { role: 'user' as const, parts: [{ text: question }] },
  ]

  const res = await generateText({
    apiKey: settings.geminiKey,
    route: aiRoute(settings, 'flash'),
    systemInstruction: system,
    contents,
    temperature: 0.3,
    maxOutputTokens: 1800,
  })

  return { answer: res.text.trim(), relay: res.relay }
}

const PAST_EXAM_STANDARD_RULES = `【CFA Level 1 历年真题命题规范（必须严格遵守）】
1. 标准格式与真实考场问法：
   - 严格三选一（A / B / C）。
   - 题干以 1–3 句简洁客观的真实金融情景或财务数据开篇（地道 CFA 英文机考题干风格，关键英文专业术语保持原汁原味），题尾必须使用标准 CFA 考试问法之一：
     • "Which of the following is MOST likely...?"
     • "Which of the following is LEAST likely...?"
     • "The analyst's conclusion (or statement) is MOST likely...?"
     • "The ... is CLOSEST to:"（计算题标准问法）
2. 考点聚焦（禁止泛泛问定义）：
   - 严禁“What is the definition of...?”类低质量记忆题。
   - 必须考察 2027 考纲核心 LOS 动作词、高频易混对比（如 MWRR vs TWRR、BGN vs END、MacDur vs ModDur vs EffDur、Clean vs Dirty Price 等）、公式边界条件或方向性结论判断。
3. 真题级干扰项设计（绝对禁止凑数废选项）：
   - 两个错误选项必须精准对应真实考生常见失误，例如：算错复利/付息期数（如半年付息忘记把 YTM/Coupon 除以 2 或 N 乘以 2）、漏掉应计利息/股息/税率、把定义或正负关系反向表述、混淆两个相邻指标或准则条款。
   - A / B / C 三个选项的篇幅结构、数值数量级必须高度一致，不能一眼看出答案。
4. 真题级逐项解析：
   - explanation：简体中文写出完整推导过程；计算题必须写出公式、数据代入与关键中间计算结果！
   - distractorAnalysis：分别写出 A、B、C 三个选项的正误诊断（正确项说明依据，两个错项点出具体对应哪一类常见计算失误或概念混淆）。
   - examTrap：提炼 1 句直击痛点的【考场避坑点】（如提醒关注 LEAST/MOST、半年复利调整、含权债券不可用 ModDur 等）。`

export async function generateUnitCheckpointQuiz(
  unit: CfaUnit,
  settings: ApiSettings,
  questionMode: CfaQuestionMode = 'mixed',
): Promise<{ questions: CfaQuestion[]; relay: RelayMeta }> {
  const meta = topicMeta(unit.topicId)
  const modeDirective = buildModeDirective(questionMode, true)
  const system = `你是 CFA Institute Level 1 资深真题命题专家。请严格围绕用户提供的 2027 Handbook 本节原文，命制 5 道高度还原真实 CFA Level 1 历年考题风格的过关测验题。

${PAST_EXAM_STANDARD_RULES}

${modeDirective}

严格输出合法 JSON 对象：
{
  "questions": [
    {
      "kind": "conceptual" | "calculation",
      "stem": "标准 CFA 英文情景题干，结尾使用 MOST likely / LEAST likely / CLOSEST to 等标准问法",
      "options": {
        "A": "选项 A",
        "B": "选项 B",
        "C": "选项 C"
      },
      "answer": "A" | "B" | "C",
      "explanation": "简体中文完整推导步骤（计算题写明公式代入与中间数值）",
      "distractorAnalysis": {
        "A": "说明 A 为何正确或对应哪类典型计算失误/概念混淆",
        "B": "说明 B 为何正确或对应哪类典型计算失误/概念混淆",
        "C": "说明 C 为何正确或对应哪类典型计算失误/概念混淆"
      },
      "examTrap": "简明考场避坑提示（提醒读题审题陷阱或公式前提边界）",
      "ba2Tip": "若为计算题，给出 TI BA II Plus 精确按键顺序；否则留空字符串"
    }
  ]
}
必须恰好返回 5 道题，只输出 JSON，禁止任何额外文字或 Markdown 说明。`

  const res = await generateText({
    apiKey: settings.geminiKey,
    route: aiRoute(settings, 'pro'),
    systemInstruction: system,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `科目：${meta.nameEn} (${meta.nameZh})\n章节：${unit.code} - ${unit.title}\n\n2027 Handbook 原文：\n${unit.rawText.slice(0, 15_000)}`,
          },
        ],
      },
    ],
    temperature: 0.35,
    maxOutputTokens: 4096,
  })

  const parsed = parseJsonBlock<{ questions?: Array<Record<string, unknown>> }>(res.text)
  const list = Array.isArray(parsed.questions)
    ? parsed.questions
        .map((q, idx) => normalizeQuestion(q, unit, idx))
        .filter((q): q is CfaQuestion => q !== null)
    : []

  if (list.length === 0) {
    throw new Error('模型未生成有效过关测验题目，请点击重试')
  }
  return { questions: list.slice(0, 5), relay: res.relay }
}

export async function generateInfiniteDrillQuestion(
  completedUnits: CfaUnit[],
  recentStems: string[],
  settings: ApiSettings,
  questionMode: CfaQuestionMode = 'mixed',
): Promise<{ question: CfaQuestion; relay: RelayMeta }> {
  if (completedUnits.length === 0) {
    throw new Error('请先至少完成 1 个章节（Unit）的过关测验，解锁对应知识范围后再开启无限刷题')
  }

  // 随机挑选一个已完成 Unit，确保绝对不超纲
  const chosenUnit =
    completedUnits[Math.floor(Math.random() * completedUnits.length)] ?? completedUnits[0]!
  const meta = topicMeta(chosenUnit.topicId)
  const modeDirective = buildModeDirective(questionMode, false)
  const recentSnippet =
    recentStems.length > 0
      ? `\n\n【去重提示】以下题干刚练习过，本次请换一个新考点、反向问法（如 MOST 换 LEAST）或全新数字情景：\n- ${recentStems
          .slice(-8)
          .map((s) => s.slice(0, 90))
          .join('\n- ')}`
      : ''

  const system = `你是 CFA Institute Level 1 历年真题题库首席命题官。考生正在进行「已学进度内无限刷题」。
你只能从指定已完成单元的 2027 Handbook 原文中出题，严禁考察任何未提供给你的后续章节内容！

${PAST_EXAM_STANDARD_RULES}

${modeDirective}

严格输出合法 JSON 对象：
{
  "kind": "conceptual" | "calculation",
  "stem": "标准 CFA 英文情景题干（含真实数据/情景，结尾用 MOST likely / LEAST likely / CLOSEST to 等标准问法）",
  "options": {
    "A": "选项 A",
    "B": "选项 B",
    "C": "选项 C"
  },
  "answer": "A" | "B" | "C",
  "explanation": "简体中文完整推导步骤（计算题写明公式、代入与中间结果）",
  "distractorAnalysis": {
    "A": "说明 A 为何正确或对应哪类典型计算失误/概念混淆",
    "B": "说明 B 为何正确或对应哪类典型计算失误/概念混淆",
    "C": "说明 C 为何正确或对应哪类典型计算失误/概念混淆"
  },
  "examTrap": "简明考场避坑提示（一句点破本题易掉入的审题/计算陷阱）",
  "ba2Tip": "若为计算题，写出 TI BA II Plus 按键顺序；否则留空字符串"
}
只输出合法 JSON，禁止多余解释。`

  const res = await generateText({
    apiKey: settings.geminiKey,
    route: aiRoute(settings, 'flash'),
    systemInstruction: system,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `允许出题范围（仅限此已完成单元）：\n科目：${meta.nameEn} (${meta.nameZh})\n章节：${chosenUnit.code} - ${chosenUnit.title}\n\n原文：\n${chosenUnit.rawText.slice(0, 12_000)}${recentSnippet}`,
          },
        ],
      },
    ],
    temperature: 0.55,
    maxOutputTokens: 2200,
  })

  const parsed = parseJsonBlock<Record<string, unknown>>(res.text)
  const q = normalizeQuestion(parsed, chosenUnit, 0)
  if (!q) {
    throw new Error('生成刷题题目格式异常，请再点一次「下一题」')
  }
  return { question: q, relay: res.relay }
}

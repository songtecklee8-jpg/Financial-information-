import type {
  ApiSettings,
  CfaLectureNote,
  CfaQaMessage,
  CfaQuestion,
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
  return {
    id: `${unit.id}-q-${Date.now().toString(36)}-${idx}`,
    unitId: unit.id,
    unitTitle: `${unit.code} · ${unit.title}`,
    topicId: unit.topicId,
    stem,
    options: { A: optA, B: optB, C: optC },
    answer,
    explanation: String(raw.explanation ?? '').trim() || '请参考 Handbook 原文定义与计算步骤。',
    ba2Tip: typeof raw.ba2Tip === 'string' && raw.ba2Tip.trim() ? raw.ba2Tip.trim() : undefined,
    kind: raw.kind === 'calculation' ? 'calculation' : 'conceptual',
  }
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

export async function generateUnitCheckpointQuiz(
  unit: CfaUnit,
  settings: ApiSettings,
): Promise<{ questions: CfaQuestion[]; relay: RelayMeta }> {
  const meta = topicMeta(unit.topicId)
  const system = `你是 CFA Institute Level 1 资深命题官。请严格围绕用户提供的 2027 Handbook 本节原文，命制 5 道高仿真 CFA L1 标准三选一单选题（A / B / C），确保涵盖概念辨析（conceptual）与计算/公式应用（calculation，如本节偏定性则可侧重实务场景判断）。
严格输出合法 JSON 对象：
{
  "questions": [
    {
      "kind": "conceptual" | "calculation",
      "stem": "专业 CFA 英文或中英双语题干（重要英文术语附英文，便于备考适应真实机考，题干清晰无歧义）",
      "options": {
        "A": "选项 A",
        "B": "选项 B",
        "C": "选项 C"
      },
      "answer": "A" | "B" | "C",
      "explanation": "简体中文深度解析（说明正确答案推导过程，并逐一指出另两项错因）",
      "ba2Tip": "若涉及数值计算，给出 TI BA II Plus 按键顺序；否则留空字符串"
    }
  ]
}
必须恰好返回 5 道题，只输出 JSON，禁止任何多余文字。`

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
    maxOutputTokens: 3200,
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
): Promise<{ question: CfaQuestion; relay: RelayMeta }> {
  if (completedUnits.length === 0) {
    throw new Error('请先至少完成 1 个章节（Unit）的过关测验，解锁对应知识范围后再开启无限刷题')
  }

  // 随机挑选一个已完成 Unit，确保绝对不超纲
  const chosenUnit =
    completedUnits[Math.floor(Math.random() * completedUnits.length)] ?? completedUnits[0]!
  const meta = topicMeta(chosenUnit.topicId)
  const recentSnippet =
    recentStems.length > 0
      ? `\n\n【去重提示】以下题干刚练习过，本次请换一个新考点或新数字情景：\n- ${recentStems
          .slice(-8)
          .map((s) => s.slice(0, 90))
          .join('\n- ')}`
      : ''

  const system = `你是 CFA Level 1 题库命题官。考生正在进行「已学进度内无限刷题」。
你只能从指定已完成单元的 2027 Handbook 原文中出题，严禁考察任何未提供给你的后续章节内容！
请生成 1 道全新、高质量、陷阱设置巧妙的 CFA Level 1 三选一单选题（A / B / C）。
严格输出合法 JSON 对象：
{
  "kind": "conceptual" | "calculation",
  "stem": "题干（含真实机考常用英文专业术语与清晰数值条件）",
  "options": {
    "A": "选项 A",
    "B": "选项 B",
    "C": "选项 C"
  },
  "answer": "A" | "B" | "C",
  "explanation": "完整中文解析与干扰项辨析",
  "ba2Tip": "若为计算题，写出 BA II Plus 按键顺序；否则留空"
}`

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
    maxOutputTokens: 1600,
  })

  const parsed = parseJsonBlock<Record<string, unknown>>(res.text)
  const q = normalizeQuestion(parsed, chosenUnit, 0)
  if (!q) {
    throw new Error('生成刷题题目格式异常，请再点一次「下一题」')
  }
  return { question: q, relay: res.relay }
}

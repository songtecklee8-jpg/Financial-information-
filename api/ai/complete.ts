import type { VercelRequest, VercelResponse } from '@vercel/node'

import {
  type AllAiProviderId,
  type BackupProviderId,
  RELAY_ORDER,
  callBackupProvider,
  collectMergedGeminiKeys,
  isBackupConfigured,
  mergeBackupKeys,
  testBackupProviderServer,
} from '../_lib/aiProviders.js'
import { loadKeys } from '../_lib/env.js'
import {
  generateServer,
  resolveServerModel,
  testGeminiServer,
} from '../_lib/geminiServer.js'

const VALID_BACKUPS = new Set<BackupProviderId>(RELAY_ORDER)

/**
 * POST /api/ai/complete
 *
 * 服务端统一 AI 接力赛代理与探测接口（不向外泄露环境变量中的任何密钥原文）：
 * - `action: 'status'`：返回 Vercel 服务端已配置的环境变量状态布尔标记；
 * - `action: 'test'`：测试指定接力棒（gemini 或第 2–10 棒）的连通性；
 * - `action: 'relay'`：严格按第 1 棒 Gemini → 第 2~10 棒备用通道执行完整接力，并返回 `baton` 与模型信息；
 * - `action: 'complete'`（指定 `provider`）：代理转发单家通道请求。
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' })
    return
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const envKeys = loadKeys()
  const keys = mergeBackupKeys(envKeys, body.aiFallback)
  const geminiKeys = collectMergedGeminiKeys(envKeys, body.aiFallback, body.geminiKey)

  if (body.action === 'status') {
    res.status(200).json({
      ok: true,
      envConfigured: {
        gemini1: Boolean(envKeys.geminiKeys[0]),
        gemini2: envKeys.geminiKeys.length >= 2,
        gemini3: envKeys.geminiKeys.length >= 3,
        geminiCount: envKeys.geminiKeys.length,
        groq: Boolean(envKeys.groq),
        openrouter: Boolean(envKeys.openrouter),
        cerebras: Boolean(envKeys.cerebras),
        nvidia: Boolean(envKeys.nvidia),
        cloudflare: Boolean(envKeys.cloudflareAccountId && envKeys.cloudflareApiToken),
        mistral: Boolean(envKeys.mistral),
        cohere: Boolean(envKeys.cohere),
        custom1: Boolean(envKeys.custom1Url && envKeys.custom1Key),
        custom2: Boolean(envKeys.custom2Url && envKeys.custom2Key),
        newsdata: Boolean(envKeys.newsData),
        finnhub: Boolean(envKeys.finnhub),
      },
    })
    return
  }

  if (body.action === 'test') {
    const provider = String(body.provider ?? '') as AllAiProviderId
    if (provider === 'gemini') {
      if (geminiKeys.length === 0) {
        res.status(200).json({ ok: false, message: '未配置 Gemini API Key（服务端环境变量与本地均为空）' })
        return
      }
      const result = await testGeminiServer(geminiKeys)
      res.status(200).json(result)
      return
    }
    if (!VALID_BACKUPS.has(provider as BackupProviderId)) {
      res.status(400).json({ ok: false, error: '未知 AI 接力通道' })
      return
    }
    const testKeys = { ...keys, enabled: true }
    if (!isBackupConfigured(provider as BackupProviderId, testKeys)) {
      res.status(200).json({ ok: false, message: `${provider} 未配置密钥` })
      return
    }
    const result = await testBackupProviderServer(provider as BackupProviderId, testKeys)
    res.status(200).json(result)
    return
  }

  const system = typeof body.system === 'string' ? body.system : ''
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  const tierRaw = String(body.tier ?? 'flash')
  const tier = tierRaw === 'lite' || tierRaw === 'pro' ? tierRaw : 'flash'
  const aiRouting = typeof body.aiRouting === 'string' ? body.aiRouting : undefined
  const customModel = typeof body.customModel === 'string' ? body.customModel : undefined
  const temperature = typeof body.temperature === 'number' ? body.temperature : undefined
  const maxOutputTokens = typeof body.maxOutputTokens === 'number' ? body.maxOutputTokens : undefined
  const expectJson = Boolean(body.expectJson)
  const responseSchema =
    body.responseSchema && typeof body.responseSchema === 'object' ? body.responseSchema : undefined
  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>)
    : undefined

  try {
    if (body.action === 'relay' || !body.provider) {
      const targetModel = resolveServerModel(tier, aiRouting, customModel)
      const result = await generateServer({
        apiKeys: geminiKeys,
        model: targetModel,
        system,
        prompt,
        messages,
        temperature,
        maxOutputTokens,
        responseSchema: responseSchema ?? (expectJson ? undefined : undefined),
        backupKeys: keys,
      })
      res.status(200).json({
        ok: true,
        text: result.text,
        model: result.model,
        provider: result.provider,
        providerName: result.providerName,
        baton: result.baton,
      })
      return
    }

    const provider = String(body.provider) as AllAiProviderId
    if (provider === 'gemini') {
      const targetModel = resolveServerModel(tier, aiRouting, customModel)
      const result = await generateServer({
        apiKeys: geminiKeys,
        model: targetModel,
        system,
        prompt,
        messages,
        temperature,
        maxOutputTokens,
        responseSchema,
        backupKeys: { enabled: false },
      })
      res.status(200).json({
        ok: true,
        text: result.text,
        model: result.model,
        provider: result.provider,
        providerName: result.providerName,
        baton: result.baton,
      })
      return
    }

    if (!VALID_BACKUPS.has(provider as BackupProviderId)) {
      res.status(400).json({ ok: false, error: '未知 AI 接力通道' })
      return
    }

    const result = await callBackupProvider(provider as BackupProviderId, {
      system,
      prompt,
      tier,
      temperature,
      maxOutputTokens,
      expectJson,
      keys,
      messages,
    })
    res.status(200).json({
      ok: true,
      text: result.text,
      model: result.model,
      provider: result.provider,
      providerName: result.providerName,
      baton: result.baton,
    })
  } catch (error) {
    res.status(200).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

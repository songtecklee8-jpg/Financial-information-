import type { VercelRequest, VercelResponse } from '@vercel/node'

import {
  type BackupProviderId,
  callBackupProvider,
  callBackupProvidersServer,
  mergeBackupKeys,
  testBackupProviderServer,
} from '../_lib/aiProviders.js'
import { loadKeys } from '../_lib/env.js'

const VALID_BACKUPS = new Set<BackupProviderId>([
  'groq',
  'openrouter',
  'mistral',
  'cloudflare',
  'nvidia',
])

/**
 * POST /api/ai/complete
 *
 * 为浏览器端提供两项轻量支持：
 * 1. `action: 'test'`：在【API 设置】面板测试单家永久免费服务商的连通性；
 * 2. `action: 'complete'`（默认）：当浏览器直连某些不支持 CORS 的服务商（如 Cloudflare Workers AI / NVIDIA NIM）
 *    受阻时，代为安全转发 OpenAI 兼容请求，仍遵守仅在 Gemini 限额/并发受限时的兜底原则。
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' })
    return
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const envKeys = loadKeys()
  const keys = mergeBackupKeys(envKeys, body.aiFallback)

  if (body.action === 'test') {
    const provider = String(body.provider ?? '') as BackupProviderId
    if (!VALID_BACKUPS.has(provider)) {
      res.status(400).json({ ok: false, error: '未知 AI 服务商' })
      return
    }
    const result = await testBackupProviderServer(provider, { ...keys, enabled: true })
    res.status(200).json(result)
    return
  }

  const system = typeof body.system === 'string' ? body.system : ''
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  const tierRaw = String(body.tier ?? 'flash')
  const tier = tierRaw === 'lite' || tierRaw === 'pro' ? tierRaw : 'flash'
  const temperature = typeof body.temperature === 'number' ? body.temperature : undefined
  const maxOutputTokens = typeof body.maxOutputTokens === 'number' ? body.maxOutputTokens : undefined
  const expectJson = Boolean(body.expectJson)
  const rotate = Boolean(body.rotate)
  const provider = VALID_BACKUPS.has(body.provider as BackupProviderId)
    ? (body.provider as BackupProviderId)
    : undefined
  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>)
    : undefined

  try {
    const result = provider
      ? await callBackupProvider(provider, {
          system,
          prompt,
          tier,
          temperature,
          maxOutputTokens,
          expectJson,
          keys,
          messages,
        })
      : await callBackupProvidersServer({
          system,
          prompt,
          tier,
          temperature,
          maxOutputTokens,
          expectJson,
          keys,
          rotate,
          messages,
        })
    res.status(200).json({ ok: true, text: result.text, model: result.model, provider: result.provider })
  } catch (error) {
    res.status(200).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

import { useCallback, useEffect, useState } from 'react'

import type { AiRoutingMode, ApiSettings, ProviderConfig, ProviderId, ServerEnvStatus } from '@/types'
import {
  DEFAULT_AI_FALLBACK,
  collectClientGeminiKeys,
  countConfiguredBackupAi,
  hasAnyAiConfigured,
  normalizeAiFallback,
  probeServerEnvStatus,
  setActiveAiFallbackConfig,
  setServerEnvStatus,
} from '@/lib/aiFallback'
import { PROVIDER_IDS, isProviderConfigured } from '@/lib/market/registry'

const STORAGE_KEY = 'apex-terminal:api-settings:v2'
const LEGACY_KEY = 'apex-terminal:api-settings:v1'

const LEGACY_MODEL_VALUES = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
])

function emptyProviders(): Record<ProviderId, ProviderConfig> {
  const out = {} as Record<ProviderId, ProviderConfig>
  for (const id of PROVIDER_IDS) out[id] = { apiKey: '', secretKey: '' }
  return out
}

export const DEFAULT_API_SETTINGS: ApiSettings = {
  geminiKey: '',
  geminiModel: '',
  aiRouting: 'auto',
  aiFallback: { ...DEFAULT_AI_FALLBACK },
  newsDataKey: '',
  providers: emptyProviders(),
}

function readRouting(value: unknown): AiRoutingMode {
  return value === 'pro' || value === 'flash' || value === 'lite' ? value : 'auto'
}

function read(): ApiSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_API_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY)
    if (!raw) return DEFAULT_API_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ApiSettings> & { twelveDataKey?: string }
    const providers = emptyProviders()
    if (parsed.providers) {
      for (const id of PROVIDER_IDS) {
        const config = parsed.providers[id]
        if (config) {
          providers[id] = {
            apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
            secretKey: typeof config.secretKey === 'string' ? config.secretKey : '',
          }
        }
      }
    }
    const legacyModel = typeof parsed.geminiModel === 'string' ? parsed.geminiModel.trim() : ''
    const geminiModel = LEGACY_MODEL_VALUES.has(legacyModel) ? '' : legacyModel
    return {
      geminiKey: typeof parsed.geminiKey === 'string' ? parsed.geminiKey : '',
      geminiModel,
      aiRouting: readRouting(parsed.aiRouting),
      aiFallback: normalizeAiFallback(parsed.aiFallback),
      newsDataKey: typeof parsed.newsDataKey === 'string' ? parsed.newsDataKey : '',
      providers,
    }
  } catch {
    return DEFAULT_API_SETTINGS
  }
}

export interface ApiSettingsController {
  settings: ApiSettings
  save: (next: ApiSettings) => void
  reset: () => void
  hasGemini: boolean
  geminiCount: number
  hasAnyAi: boolean
  backupAiCount: number
  configuredCount: number
  serverEnv: ServerEnvStatus | null
  refreshServerEnv: () => Promise<void>
}

export function useApiSettings(): ApiSettingsController {
  const [settings, setSettings] = useState<ApiSettings>(() => {
    const initial = read()
    setActiveAiFallbackConfig(initial.aiFallback)
    return initial
  })
  const [serverEnv, setServerEnv] = useState<ServerEnvStatus | null>(null)

  const refreshServerEnv = useCallback(async () => {
    const status = await probeServerEnvStatus()
    setServerEnvStatus(status)
    setServerEnv(status)
  }, [])

  useEffect(() => {
    void refreshServerEnv()
  }, [refreshServerEnv])

  useEffect(() => {
    setActiveAiFallbackConfig(settings.aiFallback)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      /* 隐私模式下 localStorage 不可写，忽略 */
    }
  }, [settings])

  const save = useCallback((next: ApiSettings) => {
    const normalized: ApiSettings = {
      ...next,
      aiFallback: normalizeAiFallback(next.aiFallback),
    }
    setActiveAiFallbackConfig(normalized.aiFallback)
    setSettings(normalized)
  }, [])

  const reset = useCallback(() => {
    setActiveAiFallbackConfig(DEFAULT_API_SETTINGS.aiFallback)
    setSettings(DEFAULT_API_SETTINGS)
  }, [])

  const configuredCount = PROVIDER_IDS.filter((id) =>
    isProviderConfigured(
      id,
      settings.providers[id]?.apiKey ?? '',
      settings.providers[id]?.secretKey ?? '',
    ),
  ).length

  const clientGeminiCount = collectClientGeminiKeys(settings).length
  const envGeminiCount = serverEnv?.geminiCount ?? 0
  const geminiCount = Math.max(clientGeminiCount, envGeminiCount)
  const hasGemini = geminiCount > 0

  return {
    settings,
    save,
    reset,
    hasGemini,
    geminiCount,
    hasAnyAi: hasAnyAiConfigured(settings) || Boolean(serverEnv && (serverEnv.geminiCount > 0 || serverEnv.groq || serverEnv.openrouter || serverEnv.cerebras || serverEnv.nvidia || serverEnv.cloudflare || serverEnv.mistral || serverEnv.cohere || serverEnv.custom1 || serverEnv.custom2)),
    backupAiCount: countConfiguredBackupAi(normalizeAiFallback(settings.aiFallback)),
    configuredCount,
    serverEnv,
    refreshServerEnv,
  }
}

/**
 * APEX Terminal — 云端持久化存储抽象层。
 *
 * 优先使用 Upstash Redis（`@upstash/redis`，通过 UPSTASH_REDIS_REST_URL /
 * UPSTASH_REDIS_REST_TOKEN 环境变量连接）；当环境变量缺失（本地开发 / 未配置）时，
 * 自动降级为「进程内存 + 临时文件」的本地存储，保证功能可完整跑通。
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Redis } from '@upstash/redis'

// ---------------------------------------------------------------------------
// Upstash 客户端（惰性初始化）
// ---------------------------------------------------------------------------

let client: Redis | null = null
let clientResolved = false

function getClient(): Redis | null {
  if (clientResolved) return client
  clientResolved = true
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  if (url && token) {
    try {
      client = new Redis({ url, token })
    } catch {
      client = null
    }
  }
  return client
}

/** 是否已接入 Upstash Redis */
export function usingUpstash(): boolean {
  return getClient() !== null
}

// ---------------------------------------------------------------------------
// 本地降级存储（内存 + 临时文件，仅在没有 Upstash 时启用）
// ---------------------------------------------------------------------------

const memory = new Map<string, { value: unknown; expiresAt: number | null }>()

const FILE_PATH = path.join(os.tmpdir(), 'apex-terminal-store.json')
let fileLoaded = false

async function loadFile(): Promise<void> {
  if (fileLoaded) return
  fileLoaded = true
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, { value: unknown; expiresAt: number | null }>
    for (const [key, entry] of Object.entries(parsed)) {
      memory.set(key, entry)
    }
  } catch {
    // 首次运行 / 文件不可用：忽略
  }
}

async function persistFile(): Promise<void> {
  try {
    const obj: Record<string, { value: unknown; expiresAt: number | null }> = {}
    for (const [key, entry] of memory.entries()) obj[key] = entry
    await fs.writeFile(FILE_PATH, JSON.stringify(obj), 'utf8')
  } catch {
    // 只读文件系统（Vercel）：忽略，内存仍可用
  }
}

// ---------------------------------------------------------------------------
// 对外读写 API
// ---------------------------------------------------------------------------

export async function readJson<T>(key: string): Promise<T | null> {
  const redis = getClient()
  if (redis) {
    try {
      const value = await redis.get<T>(key)
      return value ?? null
    } catch {
      return null
    }
  }
  await loadFile()
  const entry = memory.get(key)
  if (!entry) return null
  if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
    memory.delete(key)
    return null
  }
  return entry.value as T
}

export async function writeJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  const redis = getClient()
  if (redis) {
    try {
      if (ttlSeconds && ttlSeconds > 0) await redis.set(key, value, { ex: ttlSeconds })
      else await redis.set(key, value)
    } catch {
      // 写入失败静默忽略，避免影响主流程
    }
    return
  }
  memory.set(key, {
    value,
    expiresAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
  })
  await persistFile()
}

export async function deleteKey(key: string): Promise<void> {
  const redis = getClient()
  if (redis) {
    try {
      await redis.del(key)
    } catch {
      // 忽略
    }
    return
  }
  memory.delete(key)
  await persistFile()
}

// ---------------------------------------------------------------------------
// 存储键名
// ---------------------------------------------------------------------------

export const STORE_KEYS = {
  quotes: 'apex:quotes',
  news: 'apex:news',
  syncMeta: 'apex:sync-meta',
  newsDetail: (id: string) => `apex:news:detail:${id}`,
} as const

/** 行情快照缓存 30 分钟；新闻缓存 2 小时；单篇新闻详情缓存 7 天 */
export const TTL = {
  quotes: 60 * 30,
  news: 60 * 120,
  detail: 60 * 60 * 24 * 7,
} as const

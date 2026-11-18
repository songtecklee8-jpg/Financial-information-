/**
 * APEX Terminal — 新闻正文抓取与清洗。
 *
 * 使用 @mozilla/readability + linkedom 提取网页主体正文，剔除广告、导航栏与
 * 脚本噪音；当 Readability 失败时回落到「段落密度」启发式提取。
 */

import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

const TIMEOUT_MS = 12_000

export interface ExtractedArticle {
  text: string
  title?: string
  byline?: string
  siteName?: string
  excerpt?: string
  mode: 'readability' | 'fallback' | 'unavailable'
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

function cleanText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n\n')
    .trim()
}

/** 段落密度启发式：优先 article / main，否则取全文所有有效段落 */
function fallbackExtract(document: unknown): string {
  const doc = document as {
    querySelector: (selector: string) => { querySelectorAll: (s: string) => ArrayLike<{ textContent?: string | null }> } | null
    querySelectorAll: (s: string) => ArrayLike<{ textContent?: string | null }>
  }
  let scope: { querySelectorAll: (s: string) => ArrayLike<{ textContent?: string | null }> } = doc
  for (const selector of ['article', 'main', '[role="main"]']) {
    const found = doc.querySelector(selector)
    if (found) {
      scope = found
      break
    }
  }
  const paragraphs = Array.from(scope.querySelectorAll('p'))
    .map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((text) => text.length >= 40)
  return cleanText(paragraphs.join('\n\n'))
}

/** 抓取并清洗单篇新闻正文 */
export async function extractArticle(url: string): Promise<ExtractedArticle> {
  if (!url || url === '#') return { text: '', mode: 'unavailable' }
  let html = ''
  try {
    html = await fetchHtml(url)
  } catch {
    return { text: '', mode: 'unavailable' }
  }

  const { document } = parseHTML(html)

  try {
    const reader = new Readability(document as unknown as never, {
      charThreshold: 200,
    })
    const parsed = reader.parse()
    const text = cleanText(parsed?.textContent ?? '')
    if (text.length >= 200) {
      return {
        text,
        title: parsed?.title ?? undefined,
        byline: parsed?.byline ?? undefined,
        siteName: parsed?.siteName ?? undefined,
        excerpt: parsed?.excerpt ?? undefined,
        mode: 'readability',
      }
    }
  } catch {
    // 继续回落
  }

  const fallback = fallbackExtract(document)
  if (fallback.length >= 200) return { text: fallback, mode: 'fallback' }
  return { text: fallback, mode: 'unavailable' }
}

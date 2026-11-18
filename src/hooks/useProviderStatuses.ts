import { useSyncExternalStore } from 'react'

import type { ProviderStatus } from '@/types'
import { getStatuses, subscribeStatuses } from '@/lib/market/failover'

/** 订阅全部行情引擎的健康状态，供「API 设置」面板的状态灯使用 */
export function useProviderStatuses(): ProviderStatus[] {
  return useSyncExternalStore(subscribeStatuses, getStatuses, getStatuses)
}

import { useEffect, useState } from 'react'

/** 每秒推进一次的时钟，用于终端顶栏与实时感装饰 */
export function useClock(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

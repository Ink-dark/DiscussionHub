const clockFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const dayFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

export function formatClock(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : clockFormatter.format(date)
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export function sameDay(a: string, b: string): boolean {
  const left = new Date(a)
  const right = new Date(b)
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return false
  return dayKey(left) === dayKey(right)
}

export function formatDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const diff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  return dayFormatter.format(date)
}

export function formatSyncTime(timestamp: number | null): string {
  if (!timestamp) return '尚未同步'
  return `同步于 ${clockFormatter.format(new Date(timestamp))}`
}

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

export function formatRateReset(timestamp: number): string {
  if (!timestamp) return '稍后'
  return clockFormatter.format(new Date(timestamp))
}

export function remainingLabel(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000))
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }
  return `${minutes}m`
}

export function initials(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '?'
  return trimmed.slice(0, 1).toUpperCase()
}

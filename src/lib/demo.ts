import type { Granularity } from './types'

function dailyValue(iso: string, startMs: number): number {
  const d = new Date(iso + 'T00:00:00Z')
  const dow = d.getUTCDay()
  const weekend = dow === 0 || dow === 6 ? -8 : 0
  const trend = ((d.getTime() - startMs) / 8.64e7) * 0.05
  const seasonal = Math.sin((d.getUTCMonth() / 12) * Math.PI * 2) * 6
  const noise = Math.sin(d.getTime() / 8.64e7) * 3
  return Math.max(5, Math.round(40 + trend + seasonal + weekend + noise))
}

function periodKey(iso: string, granularity: Granularity): string {
  if (granularity === 'day') return iso
  const d = new Date(iso + 'T00:00:00Z')
  if (granularity === 'week') {
    // Monday of ISO week
    const day = d.getUTCDay() || 7
    d.setUTCDate(d.getUTCDate() - day + 1)
    return d.toISOString().slice(0, 10)
  }
  return iso.slice(0, 7) + '-01'
}

function isoToDmy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

/** Demo Y series matching selected period and granularity. */
export function buildDemoY(
  from: string,
  to: string,
  granularity: Granularity = 'day',
): string {
  const start = new Date(from + 'T00:00:00Z')
  const end = new Date(to + 'T00:00:00Z')
  const startMs = start.getTime()
  const buckets = new Map<string, number>()

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    const key = periodKey(iso, granularity)
    buckets.set(key, (buckets.get(key) ?? 0) + dailyValue(iso, startMs))
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => `${isoToDmy(date)};${value}`)
    .join('\n')
}

export function demoExampleSnippet(
  from: string,
  to: string,
  granularity: Granularity,
): string {
  const full = buildDemoY(from, to, granularity).split('\n')
  const head = full.slice(0, 3)
  return head.length ? head.join('\n') : 'дд.мм.гггг;значение'
}

export function clampRangeToData(
  dataStart: string,
  dataEnd: string,
): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10)
  const from = dataStart > '2024-01-01' ? dataStart : '2024-01-01'
  const to = dataEnd < today ? dataEnd : today
  return { from, to: to < from ? from : to }
}

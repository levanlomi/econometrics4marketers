import type { ParsedPoint } from './types'

const DATE_RE = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/
const DATE_RE_DMY = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/

function normalizeDate(raw: string): string | null {
  const s = raw.trim()
  let m = s.match(DATE_RE)
  if (m) {
    const y = m[1]
    const mo = m[2].padStart(2, '0')
    const d = m[3].padStart(2, '0')
    return `${y}-${mo}-${d}`
  }
  m = s.match(DATE_RE_DMY)
  if (m) {
    const d = m[1].padStart(2, '0')
    const mo = m[2].padStart(2, '0')
    const y = m[3]
    return `${y}-${mo}-${d}`
  }
  return null
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Parse pasted CSV / TSV / `date;value` / `date,value` series. */
export function parseSeriesText(text: string): { points: ParsedPoint[]; error?: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length === 0) {
    return { points: [], error: 'Вставьте хотя бы одну строку с датой и значением.' }
  }

  const points: ParsedPoint[] = []
  const seen = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^(date|дата|period|период)/i.test(line) && i === 0) continue

    const parts = line.split(/[;,\t|]/).map((p) => p.trim()).filter(Boolean)
    if (parts.length < 2) {
      return {
        points: [],
        error: `Строка ${i + 1}: ожидается формат «дата;значение» (найдено: «${line}»).`,
      }
    }

    let date = normalizeDate(parts[0])
    let value = parseNumber(parts[1])

    if (!date && parseNumber(parts[0]) !== null && normalizeDate(parts[1])) {
      value = parseNumber(parts[0])
      date = normalizeDate(parts[1])
    }

    if (!date) {
      return { points: [], error: `Строка ${i + 1}: не удалось разобрать дату «${parts[0]}».` }
    }
    if (value === null) {
      return { points: [], error: `Строка ${i + 1}: не удалось разобрать число «${parts[1]}».` }
    }
    if (seen.has(date)) {
      return { points: [], error: `Дублирующаяся дата: ${date}.` }
    }
    seen.add(date)
    points.push({ date, value })
  }

  points.sort((a, b) => a.date.localeCompare(b.date))
  return { points }
}

export function slugifyChannel(name: string, prefix: string, index: number): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '_')
    .replace(/^_|_$/g, '')
  return `${prefix}_${base || `channel_${index + 1}`}`
}

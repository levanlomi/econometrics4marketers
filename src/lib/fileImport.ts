import Papa from 'papaparse'

export type DuplicateStrategy = 'sum' | 'first'

export interface RawTable {
  fileName: string
  headers: string[]
  /** Cell values as strings (Excel dates converted when possible). */
  rows: string[][]
}

export interface ColumnMapping {
  dateIndex: number
  targetIndex: number
  factorIndices: number[]
  duplicateStrategy: DuplicateStrategy
}

export interface CleanRow {
  date: string
  target: number
  factors: Record<string, number>
}

export interface ProcessResult {
  rows: CleanRow[]
  minDate: string
  maxDate: string
  warnings: string[]
  error?: string
  duplicateDateCount: number
}

const DATE_NAME_RE =
  /^(date|дата|period|период|день|day|дата_?день|dt|week|неделя|weeks|недели)$/i
const TARGET_NAME_RE =
  /^(y|target|orders?|заказы|заказ|revenue|выручка|sales|продажи|conversions?|конверсии|installs?|установки|метрика|metric)$/i
const MIN_ROWS = 14
/** Excel serials we treat as dates (≈ 1990–2036). Higher numbers are often metrics. */
const EXCEL_SERIAL_MIN = 32874
const EXCEL_SERIAL_MAX = 50000

/** Excel serial → YYYY-MM-DD (Lotus 1900 epoch used by Excel). */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < EXCEL_SERIAL_MIN || serial > EXCEL_SERIAL_MAX) {
    return null
  }
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000
  const d = new Date(utc)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  )
}

function ymd(y: number, m: number, d: number): string | null {
  if (!isValidYmd(y, m, d)) return null
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/** 17 → 2017; keeps 4-digit years as-is. */
function expandYear(y: number): number {
  if (y >= 100) return y
  return 2000 + y
}

export type SlashDateOrder = 'dmy' | 'mdy'

/**
 * Infer M/D/Y vs D/M/Y from a column sample.
 * Unambiguous rows (day > 12) vote; ties → dmy for dots-heavy, else mdy for slash CSV exports.
 */
export function detectSlashDateOrder(samples: unknown[]): SlashDateOrder {
  let mdyOnly = 0
  let dmyOnly = 0
  let slashish = 0
  let dottish = 0

  for (const raw of samples) {
    const s = String(raw ?? '').trim()
    if (!s) continue
    if (s.includes('.')) dottish += 1
    if (s.includes('/') || s.includes('-')) slashish += 1

    const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/)
    if (!m) continue
    const a = Number(m[1])
    const b = Number(m[2])
    const y = expandYear(Number(m[3]))
    const dmyOk = ymd(y, b, a) !== null
    const mdyOk = ymd(y, a, b) !== null
    if (mdyOk && !dmyOk) mdyOnly += 1
    if (dmyOk && !mdyOk) dmyOnly += 1
  }

  if (mdyOnly > dmyOnly) return 'mdy'
  if (dmyOnly > mdyOnly) return 'dmy'
  // Ambiguous column: Russian dots → day-first; slash CSV (GA/Excel US) → month-first
  if (dottish > slashish) return 'dmy'
  return 'mdy'
}

/**
 * Flexible date parser. Day-first for `.` (RF); slash/dash order from `slashOrder`.
 * Also accepts Excel serial numbers as strings/numbers.
 */
export function parseFlexibleDate(
  raw: unknown,
  slashOrder: SlashDateOrder = 'dmy',
): string | null {
  if (raw === null || raw === undefined) return null

  if (typeof raw === 'number') {
    return excelSerialToIso(raw)
  }

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return excelSerialToIso(
      Math.round((raw.getTime() - Date.UTC(1899, 11, 30)) / 86400000),
    )
  }

  const s = String(raw).trim()
  if (!s) return null

  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const iso = excelSerialToIso(Number(s))
    if (iso) return iso
  }

  // ISO / YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T\s].*)?$/)
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]))

  // DD.MM.YYYY or DD.MM.YY (Russian) — always day-first
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\s.*)?$/)
  if (m) return ymd(expandYear(Number(m[3])), Number(m[2]), Number(m[1]))

  // D/M/Y or M/D/Y (and dash variants), 2 or 4 digit year
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:\s.*)?$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const y = expandYear(Number(m[3]))
    const dmy = ymd(y, b, a)
    const mdy = ymd(y, a, b)
    if (slashOrder === 'mdy') {
      if (mdy) return mdy
      if (dmy) return dmy
    } else {
      if (dmy) return dmy
      if (mdy) return mdy
    }
  }

  return null
}

/**
 * Clean dirty metric cells: "15 000,50 ₽" → 15000.5, "$1,000" → 1000.
 */
export function parseLooseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null

  let s = String(raw).trim()
  if (!s || /^(-|—|–|n\/?a|null|nan|#n\/a)$/i.test(s)) return null

  s = s
    .replace(/[\u00a0\u202f\u2009]/g, ' ')
    .replace(/[₽$€£¥₴₸]/g, '')
    .replace(/\s+/g, '')
    .replace(/[%]/g, '')

  // Both separators: last one is decimal
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      s = s.replace(/,/g, '')
    }
  } else if (lastComma !== -1) {
    // "15,5" decimal or "1,000" thousands — if exactly 3 digits after comma → thousands
    const after = s.slice(lastComma + 1)
    if (/^\d{3}$/.test(after) && s.replace(/[^\d,]/g, '').length > 4) {
      s = s.replace(/,/g, '')
    } else {
      s = s.replace(',', '.')
    }
  }

  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Stringify a cell for the table.
 * Never treat large numbers as dates here — metrics like sales=58850 look like Excel serials.
 * Date serials stay as numeric strings and are parsed only in the date column.
 */
function cellToString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const iso = excelSerialToIso(
      Math.round((v.getTime() - Date.UTC(1899, 11, 30)) / 86400000),
    )
    return iso ?? ''
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? String(v) : ''
  }
  return String(v).trim()
}

function trimEmptyColumns(headers: string[], rows: string[][]): {
  headers: string[]
  rows: string[][]
} {
  const keep: number[] = []
  for (let i = 0; i < headers.length; i++) {
    const headerOk = headers[i].trim() !== '' && !/^Колонка \d+$/.test(headers[i])
    const hasData = rows.some((r) => (r[i] ?? '').trim() !== '')
    if (headerOk || hasData) keep.push(i)
  }
  if (keep.length === headers.length) return { headers, rows }
  return {
    headers: keep.map((i) => headers[i] || `Колонка ${i + 1}`),
    rows: rows.map((r) => keep.map((i) => r[i] ?? '')),
  }
}

export async function readTabularFile(file: File): Promise<RawTable> {
  const name = file.name
  const lower = name.toLowerCase()

  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
    const text = await file.text()
    const parsed = Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: 'greedy',
      delimiter: lower.endsWith('.tsv') ? '\t' : undefined,
    })
    if (parsed.errors.length > 0 && (!parsed.data || parsed.data.length === 0)) {
      throw new Error(parsed.errors[0]?.message || 'Не удалось прочитать CSV')
    }
    const data = (parsed.data as string[][]).filter((row) =>
      row.some((c) => String(c ?? '').trim() !== ''),
    )
    if (data.length < 2) throw new Error('В файле нет заголовка и строк данных')
    const headers = data[0].map((h, i) => String(h ?? '').trim() || `Колонка ${i + 1}`)
    const rows = data.slice(1).map((row) =>
      headers.map((_, i) => cellToString(row[i])),
    )
    const trimmed = trimEmptyColumns(headers, rows)
    return { fileName: name, ...trimmed }
  }

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    // cellDates:false — keep Excel serials; SheetJS Date objects shift by timezone
    const wb = XLSX.read(buf, { type: 'array', cellDates: false })
    const sheetName = wb.SheetNames[0]
    if (!sheetName) throw new Error('В Excel-файле нет листов')
    const sheet = wb.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: '',
      raw: true,
    }) as unknown[][]
    const nonEmpty = data.filter(
      (row) => Array.isArray(row) && row.some((c) => cellToString(c) !== ''),
    )
    if (nonEmpty.length < 2) throw new Error('В файле нет заголовка и строк данных')
    const headerRow = nonEmpty[0]
    const headers = headerRow.map((h, i) => cellToString(h) || `Колонка ${i + 1}`)
    const rows = nonEmpty.slice(1).map((row) =>
      headers.map((_, i) => cellToString(Array.isArray(row) ? row[i] : '')),
    )
    const trimmed = trimEmptyColumns(headers, rows)
    return { fileName: name, ...trimmed }
  }

  throw new Error('Поддерживаются файлы .csv, .tsv, .xlsx')
}

export function scoreDateColumn(table: RawTable, colIndex: number): number {
  const name = table.headers[colIndex] ?? ''
  let score = DATE_NAME_RE.test(name) ? 1000 : 0
  const sample = table.rows.slice(0, 40).map((row) => row[colIndex])
  const order = detectSlashDateOrder(sample)
  let parsed = 0
  for (const cell of sample) {
    if (parseFlexibleDate(cell, order)) parsed += 1
  }
  score += parsed * 10
  return score
}

export function detectDateColumn(table: RawTable): number | null {
  let best = -1
  let bestScore = 0
  for (let i = 0; i < table.headers.length; i++) {
    const s = scoreDateColumn(table, i)
    if (s > bestScore) {
      bestScore = s
      best = i
    }
  }
  // Need at least a few parseable dates unless name matched strongly
  if (best < 0) return null
  if (bestScore < 20 && !DATE_NAME_RE.test(table.headers[best] ?? '')) return null
  return best
}

export function guessTargetIndex(table: RawTable, dateIndex: number): number | null {
  for (let i = 0; i < table.headers.length; i++) {
    if (i === dateIndex) continue
    if (TARGET_NAME_RE.test(table.headers[i] ?? '')) return i
  }
  // First numeric-looking column after date
  for (let i = 0; i < table.headers.length; i++) {
    if (i === dateIndex) continue
    let ok = 0
    for (const row of table.rows.slice(0, 20)) {
      if (parseLooseNumber(row[i]) !== null) ok += 1
    }
    if (ok >= Math.min(5, table.rows.length)) return i
  }
  return null
}

export function guessFactorIndices(
  table: RawTable,
  dateIndex: number,
  targetIndex: number,
): number[] {
  const out: number[] = []
  for (let i = 0; i < table.headers.length; i++) {
    if (i === dateIndex || i === targetIndex) continue
    let ok = 0
    for (const row of table.rows.slice(0, 20)) {
      const n = parseLooseNumber(row[i])
      const d = parseFlexibleDate(row[i])
      if (n !== null && !d) ok += 1
    }
    if (ok >= Math.min(3, table.rows.length)) out.push(i)
  }
  return out
}

function interpolateSeries(values: (number | null)[]): number[] {
  const n = values.length
  const out: (number | null)[] = [...values]
  const known = values
    .map((v, i) => (v === null ? null : i))
    .filter((i): i is number => i !== null)

  if (known.length === 0) return values.map(() => 0)

  // Fill leading / trailing with nearest known
  for (let i = 0; i < known[0]; i++) out[i] = values[known[0]]
  for (let i = known[known.length - 1] + 1; i < n; i++) {
    out[i] = values[known[known.length - 1]]
  }

  for (let k = 0; k < known.length - 1; k++) {
    const a = known[k]
    const b = known[k + 1]
    const va = values[a]!
    const vb = values[b]!
    const span = b - a
    for (let i = a + 1; i < b; i++) {
      const t = (i - a) / span
      out[i] = va + (vb - va) * t
    }
  }

  return out.map((v) => (v === null ? 0 : v))
}

export function processMappedTable(
  table: RawTable,
  mapping: ColumnMapping,
): ProcessResult {
  const warnings: string[] = []
  const { dateIndex, targetIndex, factorIndices, duplicateStrategy } = mapping

  if (dateIndex < 0 || dateIndex >= table.headers.length) {
    return {
      rows: [],
      minDate: '',
      maxDate: '',
      warnings,
      error: 'Файл не содержит колонки, похожей на дату',
      duplicateDateCount: 0,
    }
  }

  type Acc = {
    targetSum: number
    targetCount: number
    targetFirst: number | null
    factorsSum: Record<string, number>
    factorsFirst: Record<string, number>
  }

  const byDate = new Map<string, Acc>()
  let badDates = 0
  const dateOrder = detectSlashDateOrder(table.rows.map((r) => r[dateIndex]))

  for (const row of table.rows) {
    const date = parseFlexibleDate(row[dateIndex], dateOrder)
    if (!date) {
      badDates += 1
      continue
    }

    const rawTarget = parseLooseNumber(row[targetIndex])
    const factorVals: Record<string, number | null> = {}
    for (const fi of factorIndices) {
      const key = table.headers[fi]
      factorVals[key] = parseLooseNumber(row[fi])
    }

    let acc = byDate.get(date)
    if (!acc) {
      acc = {
        targetSum: 0,
        targetCount: 0,
        targetFirst: null,
        factorsSum: {},
        factorsFirst: {},
      }
      byDate.set(date, acc)
      for (const fi of factorIndices) {
        const key = table.headers[fi]
        acc.factorsSum[key] = 0
      }
    }

    if (rawTarget !== null) {
      acc.targetSum += rawTarget
      acc.targetCount += 1
      if (acc.targetFirst === null) acc.targetFirst = rawTarget
    }

    for (const fi of factorIndices) {
      const key = table.headers[fi]
      const v = factorVals[key]
      // Factors: missing → 0
      const num = v === null ? 0 : v
      acc.factorsSum[key] = (acc.factorsSum[key] ?? 0) + num
      if (!(key in acc.factorsFirst)) acc.factorsFirst[key] = num
    }
  }

  if (byDate.size === 0) {
    return {
      rows: [],
      minDate: '',
      maxDate: '',
      warnings,
      error: 'Файл не содержит колонки, похожей на дату',
      duplicateDateCount: 0,
    }
  }

  if (badDates > 0) {
    warnings.push(`Пропущено строк без распознанной даты: ${badDates}`)
  }

  const sortedDates = [...byDate.keys()].sort((a, b) => a.localeCompare(b))
  let dupDates = 0
  const dateHits = new Map<string, number>()
  for (const row of table.rows) {
    const date = parseFlexibleDate(row[dateIndex], dateOrder)
    if (!date) continue
    dateHits.set(date, (dateHits.get(date) ?? 0) + 1)
  }
  for (const c of dateHits.values()) {
    if (c > 1) dupDates += c - 1
  }

  if (dupDates > 0) {
    warnings.push(
      `Найдены дубликаты дат (${dupDates} повторов). Сейчас: ${
        duplicateStrategy === 'sum' ? 'суммируем значения за день' : 'берём первую строку'
      }.`,
    )
  }

  // Build preliminary rows with possible null targets
  const prelimTarget: (number | null)[] = []
  const prelimFactors: Record<string, number>[] = []

  for (const date of sortedDates) {
    const acc = byDate.get(date)!
    let target: number | null = null
    if (duplicateStrategy === 'sum') {
      target = acc.targetCount > 0 ? acc.targetSum : null
    } else {
      target = acc.targetFirst
    }

    const factors: Record<string, number> = {}
    for (const fi of factorIndices) {
      const key = table.headers[fi]
      factors[key] =
        duplicateStrategy === 'sum'
          ? (acc.factorsSum[key] ?? 0)
          : (acc.factorsFirst[key] ?? 0)
    }
    prelimTarget.push(target)
    prelimFactors.push(factors)
  }

  const filledTarget = interpolateSeries(prelimTarget)
  const missingTarget = prelimTarget.filter((v) => v === null).length
  if (missingTarget > 0) {
    warnings.push(
      `В целевой метрике было ${missingTarget} пропусков — заполнили линейной интерполяцией.`,
    )
  }

  const rows: CleanRow[] = sortedDates.map((date, i) => ({
    date,
    target: filledTarget[i],
    factors: prelimFactors[i],
  }))

  if (rows.length < MIN_ROWS) {
    return {
      rows: [],
      minDate: '',
      maxDate: '',
      warnings,
      error: `В файле недостаточно строк для анализа (нужно ≥ ${MIN_ROWS}, сейчас ${rows.length})`,
      duplicateDateCount: dupDates,
    }
  }

  return {
    rows,
    minDate: rows[0].date,
    maxDate: rows[rows.length - 1].date,
    warnings,
    duplicateDateCount: dupDates,
  }
}

export function pointsToSeriesText(
  points: { date: string; value: number }[],
): string {
  return points.map((p) => `${p.date};${p.value}`).join('\n')
}

export function cleanRowsToSeriesTexts(result: ProcessResult): {
  yText: string
  factors: { name: string; text: string }[]
} {
  const yText = pointsToSeriesText(
    result.rows.map((r) => ({ date: r.date, value: r.target })),
  )
  const factorNames =
    result.rows.length > 0 ? Object.keys(result.rows[0].factors) : []
  const factors = factorNames.map((name) => ({
    name,
    text: pointsToSeriesText(
      result.rows.map((r) => ({ date: r.date, value: r.factors[name] ?? 0 })),
    ),
  }))
  return { yText, factors }
}

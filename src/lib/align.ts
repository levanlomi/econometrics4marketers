import {
  addDays,
  format,
  getDay,
  getISOWeek,
  getMonth,
  getYear,
  parseISO,
  startOfISOWeek,
  startOfMonth,
} from 'date-fns'
import type {
  AlignedDataset,
  Granularity,
  NamedSeries,
  ParsedPoint,
  RegressorsPayload,
} from './types'

/** Official RF public holidays 2017–2027 (fixed + known transferred days). */
export const RF_HOLIDAYS = new Set([
  // 2017
  '2017-01-01', '2017-01-02', '2017-01-03', '2017-01-04', '2017-01-05',
  '2017-01-06', '2017-01-07', '2017-01-08',
  '2017-02-23', '2017-02-24',
  '2017-03-08',
  '2017-05-01', '2017-05-08', '2017-05-09',
  '2017-06-12',
  '2017-11-04', '2017-11-06',
  // 2018
  '2018-01-01', '2018-01-02', '2018-01-03', '2018-01-04', '2018-01-05',
  '2018-01-06', '2018-01-07', '2018-01-08',
  '2018-02-23',
  '2018-03-08', '2018-03-09',
  '2018-04-30', '2018-05-01', '2018-05-02', '2018-05-09',
  '2018-06-11', '2018-06-12',
  '2018-11-04', '2018-11-05',
  '2018-12-31',
  // 2019
  '2019-01-01', '2019-01-02', '2019-01-03', '2019-01-04', '2019-01-05',
  '2019-01-06', '2019-01-07', '2019-01-08',
  '2019-02-23',
  '2019-03-08',
  '2019-05-01', '2019-05-02', '2019-05-03', '2019-05-09', '2019-05-10',
  '2019-06-12',
  '2019-11-04',
  // 2020
  '2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-01-05',
  '2020-01-06', '2020-01-07', '2020-01-08',
  '2020-02-23', '2020-02-24',
  '2020-03-08', '2020-03-09',
  '2020-05-01', '2020-05-04', '2020-05-05', '2020-05-09', '2020-05-11',
  '2020-06-12',
  '2020-11-04',
  // 2021
  '2021-01-01', '2021-01-02', '2021-01-03', '2021-01-04', '2021-01-05',
  '2021-01-06', '2021-01-07', '2021-01-08',
  '2021-02-22', '2021-02-23',
  '2021-03-08',
  '2021-05-01', '2021-05-03', '2021-05-09', '2021-05-10',
  '2021-06-12', '2021-06-14',
  '2021-11-04', '2021-11-05',
  '2021-12-31',
  // 2022
  '2022-01-01', '2022-01-02', '2022-01-03', '2022-01-04', '2022-01-05',
  '2022-01-06', '2022-01-07', '2022-01-08',
  '2022-02-23',
  '2022-03-08',
  '2022-05-01', '2022-05-02', '2022-05-03', '2022-05-09', '2022-05-10',
  '2022-06-12', '2022-06-13',
  '2022-11-04',
  // 2023
  '2023-01-01', '2023-01-02', '2023-01-03', '2023-01-04', '2023-01-05',
  '2023-01-06', '2023-01-07', '2023-01-08',
  '2023-02-23', '2023-02-24',
  '2023-03-08',
  '2023-05-01', '2023-05-08', '2023-05-09',
  '2023-06-12',
  '2023-11-04', '2023-11-06',
  // 2024
  '2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05',
  '2024-01-06', '2024-01-07', '2024-01-08',
  '2024-02-23',
  '2024-03-08',
  '2024-04-29', '2024-04-30', '2024-05-01', '2024-05-09', '2024-05-10',
  '2024-06-12',
  '2024-11-04',
  '2024-12-30', '2024-12-31',
  // 2025
  '2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05',
  '2025-01-06', '2025-01-07', '2025-01-08',
  '2025-02-23', '2025-02-24',
  '2025-03-08',
  '2025-05-01', '2025-05-02', '2025-05-08', '2025-05-09',
  '2025-06-12', '2025-06-13',
  '2025-11-03', '2025-11-04',
  '2025-12-31',
  // 2026
  '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05',
  '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
  '2026-02-23',
  '2026-03-08', '2026-03-09',
  '2026-05-01', '2026-05-04', '2026-05-09', '2026-05-11',
  '2026-06-12',
  '2026-11-04',
  // 2027
  '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04', '2027-01-05',
  '2027-01-06', '2027-01-07', '2027-01-08',
  '2027-02-22', '2027-02-23',
  '2027-03-08',
  '2027-05-01', '2027-05-03', '2027-05-09', '2027-05-10',
  '2027-06-12', '2027-06-14',
  '2027-11-04', '2027-11-05',
])

export const BUILTIN_FACTOR_META = [
  { id: 'dow_mon', label: 'Понедельник', description: 'Дамми дня недели', aggregate: 'mean' as const, derived: true },
  { id: 'dow_tue', label: 'Вторник', description: 'Дамми дня недели', aggregate: 'mean' as const, derived: true },
  { id: 'dow_wed', label: 'Среда', description: 'Дамми дня недели', aggregate: 'mean' as const, derived: true },
  { id: 'dow_thu', label: 'Четверг', description: 'Дамми дня недели', aggregate: 'mean' as const, derived: true },
  { id: 'dow_fri', label: 'Пятница', description: 'Дамми дня недели', aggregate: 'mean' as const, derived: true },
  { id: 'dow_sat', label: 'Суббота', description: 'Дамми дня недели', aggregate: 'mean' as const, derived: true },
  // Sunday = baseline
  { id: 'is_holiday', label: 'Праздник РФ', description: 'Официальный праздничный день', aggregate: 'max' as const, derived: true },
  { id: 'is_weekend', label: 'Выходной', description: 'Суббота или воскресенье', aggregate: 'mean' as const, derived: true },
  { id: 'salary_days', label: 'Зарплатные дни', description: '1–5 и 25–31 числа месяца', aggregate: 'mean' as const, derived: true },
  {
    id: 'school_holiday',
    label: 'Школьные каникулы',
    description: 'Типовые школьные каникулы РФ (осенние, зимние, весенние, летние)',
    aggregate: 'mean' as const,
    derived: true,
  },
  {
    id: 'major_sale',
    label: 'Крупные распродажи',
    description: '23 февраля, 8 марта, 11.11, Black Friday, предновогодняя неделя',
    aggregate: 'max' as const,
    derived: true,
  },
  { id: 'month_sin', label: 'Сезонность (sin)', description: 'Годовая сезонность', aggregate: 'mean' as const, derived: true },
  { id: 'month_cos', label: 'Сезонность (cos)', description: 'Годовая сезонность', aggregate: 'mean' as const, derived: true },
]

function periodKey(dateStr: string, granularity: Granularity): string {
  const d = parseISO(dateStr)
  if (granularity === 'day') return dateStr
  if (granularity === 'week') return format(startOfISOWeek(d), 'yyyy-MM-dd')
  return format(startOfMonth(d), 'yyyy-MM-dd')
}

function periodLabel(key: string, granularity: Granularity): string {
  if (granularity === 'day') return key
  if (granularity === 'week') {
    const d = parseISO(key)
    return `Нед. ${getISOWeek(d)} ${getYear(d)}`
  }
  const d = parseISO(key)
  return format(d, 'yyyy-MM')
}

function aggregateValues(values: number[], mode: 'sum' | 'mean' | 'last' | 'max'): number {
  if (values.length === 0) return NaN
  if (mode === 'sum') return values.reduce((a, b) => a + b, 0)
  if (mode === 'mean') return values.reduce((a, b) => a + b, 0) / values.length
  if (mode === 'max') return Math.max(...values)
  return values[values.length - 1]
}

/** Типичные школьные каникулы РФ (приближённый календарь по месяцам/дням). */
function isSchoolHoliday(d: Date): boolean {
  const m = getMonth(d) // 0..11
  const day = d.getDate()
  // Летние: 1 июня — 31 августа
  if (m >= 5 && m <= 7) return true
  // Осенние: ~28 октября — 6 ноября
  if ((m === 9 && day >= 28) || (m === 10 && day <= 6)) return true
  // Зимние: 1–10 января (+ хвост праздников уже в holidays)
  if (m === 0 && day <= 10) return true
  // Весенние: ~24 марта — 2 апреля
  if ((m === 2 && day >= 24) || (m === 3 && day <= 2)) return true
  return false
}

/** 4-й четверг ноября — US-style Black Friday proxy used by RF marketplaces. */
function blackFridayDate(year: number): Date {
  const nov1 = new Date(year, 10, 1)
  const dow = nov1.getDay() // 0 Sun
  const firstThu = 1 + ((4 - dow + 7) % 7)
  return new Date(year, 10, firstThu + 21)
}

function inInclusiveRange(d: Date, start: Date, end: Date): boolean {
  const t = d.getTime()
  return t >= start.getTime() && t <= end.getTime()
}

function isMajorSale(d: Date): boolean {
  const y = d.getFullYear()
  const m = getMonth(d)
  const day = d.getDate()

  // 23 февраля: окно 18–23 февраля
  if (m === 1 && day >= 18 && day <= 23) return true
  // 8 марта: окно 3–8 марта
  if (m === 2 && day >= 3 && day <= 8) return true
  // 11.11: 9–12 ноября
  if (m === 10 && day >= 9 && day <= 12) return true
  // Black Friday week: пятница −2 … +3 дня
  const bf = blackFridayDate(y)
  const bfStart = new Date(y, 10, bf.getDate() - 2)
  const bfEnd = new Date(y, 10, bf.getDate() + 3)
  if (inInclusiveRange(d, bfStart, bfEnd)) return true
  // Предновогодняя неделя: 25–31 декабря
  if (m === 11 && day >= 25) return true
  return false
}

function derivedDaily(dateStr: string): Record<string, number> {
  const d = parseISO(dateStr)
  const dow = getDay(d) // 0 Sun .. 6 Sat
  const dayOfMonth = d.getDate()
  const month = getMonth(d) // 0..11
  const angle = ((month + dayOfMonth / 31) / 12) * 2 * Math.PI

  return {
    dow_mon: dow === 1 ? 1 : 0,
    dow_tue: dow === 2 ? 1 : 0,
    dow_wed: dow === 3 ? 1 : 0,
    dow_thu: dow === 4 ? 1 : 0,
    dow_fri: dow === 5 ? 1 : 0,
    dow_sat: dow === 6 ? 1 : 0,
    is_holiday: RF_HOLIDAYS.has(dateStr) ? 1 : 0,
    is_weekend: dow === 0 || dow === 6 ? 1 : 0,
    salary_days: dayOfMonth <= 5 || dayOfMonth >= 25 ? 1 : 0,
    school_holiday: isSchoolHoliday(d) ? 1 : 0,
    major_sale: isMajorSale(d) ? 1 : 0,
    month_sin: Math.sin(angle),
    month_cos: Math.cos(angle),
  }
}

function forwardFillMap(
  dailyDates: string[],
  sparse: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {}
  let last: number | null = null
  for (const date of dailyDates) {
    if (sparse[date] !== undefined) last = sparse[date]
    if (last !== null) out[date] = last
  }
  // backfill start if needed
  const firstKnown = dailyDates.find((d) => sparse[d] !== undefined)
  if (firstKnown !== undefined) {
    const v = sparse[firstKnown]
    for (const date of dailyDates) {
      if (date >= firstKnown) break
      out[date] = v
    }
  }
  return out
}

export function expandBuiltinSeries(
  payload: RegressorsPayload,
): { series: Record<string, Record<string, number>>; labels: Record<string, string>; aggregate: Record<string, 'sum' | 'mean' | 'last' | 'max'> } {
  const start = parseISO(payload.startDate)
  const end = parseISO(payload.endDate)
  const dailyDates: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) {
    dailyDates.push(format(d, 'yyyy-MM-dd'))
  }

  const series: Record<string, Record<string, number>> = {}
  const labels: Record<string, string> = {}
  const aggregate: Record<string, 'sum' | 'mean' | 'last' | 'max'> = {}

  for (const meta of BUILTIN_FACTOR_META) {
    series[meta.id] = {}
    labels[meta.id] = meta.label
    aggregate[meta.id] = meta.aggregate
  }

  for (const date of dailyDates) {
    const derived = derivedDaily(date)
    for (const [id, value] of Object.entries(derived)) {
      series[id][date] = value
    }
  }

  for (const meta of payload.meta) {
    if (meta.derived) continue
    const raw = payload.series[meta.id] ?? {}
    series[meta.id] = forwardFillMap(dailyDates, raw)
    labels[meta.id] = meta.label
    aggregate[meta.id] = meta.aggregate
  }

  return { series, labels, aggregate }
}

function aggregateSeries(
  daily: Record<string, number>,
  granularity: Granularity,
  mode: 'sum' | 'mean' | 'last' | 'max',
  from: string,
  to: string,
): Map<string, number> {
  const buckets = new Map<string, number[]>()
  for (const [date, value] of Object.entries(daily)) {
    if (date < from || date > to) continue
    if (!Number.isFinite(value)) continue
    const key = periodKey(date, granularity)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(value)
  }
  const out = new Map<string, number>()
  for (const [key, vals] of buckets) {
    out.set(key, aggregateValues(vals, mode))
  }
  return out
}

function aggregateUserPoints(
  points: ParsedPoint[],
  granularity: Granularity,
  from: string,
  to: string,
): Map<string, number> {
  const buckets = new Map<string, number[]>()
  for (const p of points) {
    if (p.date < from || p.date > to) continue
    const key = periodKey(p.date, granularity)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(p.value)
  }
  const out = new Map<string, number>()
  for (const [key, vals] of buckets) {
    out.set(key, aggregateValues(vals, 'sum'))
  }
  return out
}

export interface AlignOptions {
  payload: RegressorsPayload
  yPoints: ParsedPoint[]
  adSeries: NamedSeries[]
  granularity: Granularity
  from: string
  to: string
  enabledFactors: string[]
}

export function alignDataset(opts: AlignOptions): { dataset?: AlignedDataset; error?: string } {
  const { payload, yPoints, adSeries, granularity, from, to, enabledFactors } = opts

  if (yPoints.length < 5) {
    return { error: 'Нужно минимум 5 наблюдений целевого показателя.' }
  }

  const expanded = expandBuiltinSeries(payload)
  const yAgg = aggregateUserPoints(yPoints, granularity, from, to)
  const dates = [...yAgg.keys()].sort()

  if (dates.length < 5) {
    return { error: 'После фильтра по периоду и гранулярности осталось меньше 5 точек.' }
  }

  const X: Record<string, number[]> = {}
  const labels: Record<string, string> = {}

  for (const factorId of enabledFactors) {
    if (expanded.series[factorId]) {
      const agg = aggregateSeries(
        expanded.series[factorId],
        granularity,
        expanded.aggregate[factorId],
        from,
        to,
      )
      const values: number[] = []
      let missing = 0
      for (const d of dates) {
        const v = agg.get(d)
        if (v === undefined || !Number.isFinite(v)) {
          missing++
          values.push(NaN)
        } else {
          values.push(v)
        }
      }
      if (missing > dates.length * 0.2) {
        return {
          error: `У фактора «${expanded.labels[factorId] ?? factorId}» слишком много пропусков (${missing} из ${dates.length}).`,
        }
      }
      const finite = values.filter((v) => Number.isFinite(v))
      const mean = finite.reduce((a, b) => a + b, 0) / finite.length
      X[factorId] = values.map((v) => (Number.isFinite(v) ? v : mean))
      labels[factorId] = expanded.labels[factorId] ?? factorId
    }
  }

  for (const s of adSeries) {
    if (!enabledFactors.includes(s.id)) continue
    const agg = aggregateUserPoints(s.points, granularity, from, to)
    const values = dates.map((d) => agg.get(d) ?? 0)
    X[s.id] = values
    labels[s.id] = s.label
  }

  const factorIds = Object.keys(X)
  if (factorIds.length === 0) {
    return { error: 'Выберите хотя бы один фактор.' }
  }

  if (dates.length <= factorIds.length + 1) {
    return {
      error: `Мало наблюдений (${dates.length}) относительно числа факторов (${factorIds.length}). Укрупните гранулярность или отключите часть факторов.`,
    }
  }

  return {
    dataset: {
      dates: dates.map((d) => periodLabel(d, granularity)),
      y: dates.map((d) => yAgg.get(d)!),
      X,
      labels,
    },
  }
}

export function defaultDateRange(payload: RegressorsPayload): { from: string; to: string } {
  return { from: payload.startDate, to: payload.endDate }
}

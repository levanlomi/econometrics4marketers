/**
 * Builds / refreshes public/data/regressors.json (daily series from 2017-01-01).
 *
 * Tries live sources when network is available; falls back to embedded
 * approximate histories so the repo always builds offline.
 *
 * Usage: npm run update-regressors
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'public', 'data', 'regressors.json')
const RAW_DIR = join(ROOT, 'data', 'raw')

const START = '2017-01-01'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function eachDay(start, end, fn) {
  const out = []
  const d0 = new Date(start + 'T00:00:00Z')
  const d1 = new Date(end + 'T00:00:00Z')
  for (let d = new Date(d0); d <= d1; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    out.push(fn(iso, d))
  }
  return out
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  return lines.map((l) => l.split(',').map((c) => c.trim()))
}

/** CBR key rate change history (date -> rate %). */
const KEY_RATE_STEPS = [
  ['2016-09-19', 10.0],
  ['2017-03-24', 9.75],
  ['2017-05-02', 9.25],
  ['2017-06-19', 9.0],
  ['2017-09-18', 8.5],
  ['2017-10-30', 8.25],
  ['2017-12-18', 7.75],
  ['2018-02-12', 7.5],
  ['2018-03-26', 7.25],
  ['2018-09-17', 7.5],
  ['2018-12-17', 7.75],
  ['2019-06-17', 7.5],
  ['2019-07-29', 7.25],
  ['2019-09-09', 7.0],
  ['2019-10-28', 6.5],
  ['2019-12-16', 6.25],
  ['2020-02-10', 6.0],
  ['2020-04-27', 5.5],
  ['2020-06-22', 4.5],
  ['2020-07-27', 4.25],
  ['2021-03-22', 4.5],
  ['2021-04-26', 5.0],
  ['2021-06-15', 5.5],
  ['2021-07-26', 6.5],
  ['2021-09-13', 6.75],
  ['2021-10-25', 7.5],
  ['2021-12-17', 8.5],
  ['2022-02-11', 9.5],
  ['2022-02-28', 20.0],
  ['2022-04-11', 17.0],
  ['2022-04-29', 14.0],
  ['2022-05-27', 11.0],
  ['2022-06-14', 9.5],
  ['2022-07-25', 8.0],
  ['2022-09-16', 7.5],
  ['2023-07-21', 8.5],
  ['2023-08-15', 12.0],
  ['2023-09-15', 13.0],
  ['2023-10-27', 15.0],
  ['2023-12-15', 16.0],
  ['2024-07-26', 18.0],
  ['2024-09-13', 19.0],
  ['2024-10-25', 21.0],
  ['2025-06-06', 20.0],
  ['2025-07-25', 18.0],
  ['2025-09-12', 17.0],
  ['2025-10-24', 16.5],
  ['2026-02-13', 16.0],
  ['2026-03-20', 15.5],
  ['2026-04-25', 15.0],
  ['2026-06-06', 14.5],
]

/** Approximate YoY CPI % by month (YYYY-MM), Rosstat-style levels. */
const CPI_YOY = {
  '2017-01': 5.0, '2017-02': 4.6, '2017-03': 4.3, '2017-04': 4.1,
  '2017-05': 4.1, '2017-06': 4.4, '2017-07': 3.9, '2017-08': 3.3,
  '2017-09': 3.0, '2017-10': 2.7, '2017-11': 2.5, '2017-12': 2.5,
  '2018-01': 2.2, '2018-02': 2.2, '2018-03': 2.4, '2018-04': 2.4,
  '2018-05': 2.4, '2018-06': 2.3, '2018-07': 2.5, '2018-08': 3.1,
  '2018-09': 3.4, '2018-10': 3.5, '2018-11': 3.8, '2018-12': 4.3,
  '2019-01': 5.0, '2019-02': 5.2, '2019-03': 5.3, '2019-04': 5.2,
  '2019-05': 5.1, '2019-06': 4.7, '2019-07': 4.6, '2019-08': 4.3,
  '2019-09': 4.0, '2019-10': 3.8, '2019-11': 3.5, '2019-12': 3.0,
  '2020-01': 2.4, '2020-02': 2.3, '2020-03': 2.5, '2020-04': 3.1,
  '2020-05': 3.0, '2020-06': 3.2, '2020-07': 3.4, '2020-08': 3.6,
  '2020-09': 3.7, '2020-10': 4.0, '2020-11': 4.4, '2020-12': 4.9,
  '2021-01': 5.2, '2021-02': 5.7, '2021-03': 5.8, '2021-04': 5.5,
  '2021-05': 6.0, '2021-06': 6.5, '2021-07': 6.5, '2021-08': 6.7,
  '2021-09': 7.4, '2021-10': 8.1, '2021-11': 8.4, '2021-12': 8.4,
  '2022-01': 8.7, '2022-02': 9.2, '2022-03': 16.7, '2022-04': 17.8,
  '2022-05': 17.1, '2022-06': 15.9, '2022-07': 15.1, '2022-08': 14.3,
  '2022-09': 13.7, '2022-10': 12.6, '2022-11': 12.0, '2022-12': 11.9,
  '2023-01': 11.8, '2023-02': 11.0, '2023-03': 3.5, '2023-04': 2.3,
  '2023-05': 2.5, '2023-06': 3.2, '2023-07': 4.3, '2023-08': 5.1,
  '2023-09': 6.0, '2023-10': 6.7, '2023-11': 7.5, '2023-12': 7.4,
  '2024-01': 7.4, '2024-02': 7.7, '2024-03': 7.7, '2024-04': 7.8,
  '2024-05': 8.3, '2024-06': 8.6, '2024-07': 9.1, '2024-08': 9.0,
  '2024-09': 8.6, '2024-10': 8.5, '2024-11': 8.9, '2024-12': 9.5,
  '2025-01': 9.9, '2025-02': 10.1, '2025-03': 10.3, '2025-04': 10.2,
  '2025-05': 9.9, '2025-06': 9.4, '2025-07': 8.8, '2025-08': 8.3,
  '2025-09': 8.0, '2025-10': 7.7, '2025-11': 7.4, '2025-12': 7.2,
  '2026-01': 7.0, '2026-02': 6.8, '2026-03': 6.6, '2026-04': 6.5,
  '2026-05': 6.3, '2026-06': 6.2, '2026-07': 6.1, '2026-08': 6.0,
}

function stepSeries(steps, end) {
  const series = {}
  let rate = steps[0][1]
  let si = 0
  eachDay(START, end, (iso) => {
    while (si + 1 < steps.length && steps[si + 1][0] <= iso) {
      si += 1
      rate = steps[si][1]
    }
    series[iso] = rate
  })
  return series
}

function cpiSeries(end) {
  const series = {}
  let last = CPI_YOY['2017-01']
  eachDay(START, end, (iso) => {
    const key = iso.slice(0, 7)
    if (CPI_YOY[key] !== undefined) last = CPI_YOY[key]
    series[iso] = last
  })
  return series
}

/** Rough Brent path (USD/bbl) when live fetch fails. */
function syntheticBrent(end) {
  const anchors = [
    ['2017-01-01', 55], ['2017-07-01', 48], ['2018-01-01', 66], ['2018-07-01', 74],
    ['2018-10-01', 80], ['2019-01-01', 54], ['2019-07-01', 64], ['2020-01-01', 66],
    ['2020-04-01', 25], ['2020-07-01', 43], ['2021-01-01', 55], ['2021-07-01', 75],
    ['2022-01-01', 87], ['2022-03-01', 110], ['2022-07-01', 105], ['2022-10-01', 92],
    ['2023-01-01', 82], ['2023-04-01', 85], ['2023-07-01', 76], ['2023-10-01', 90],
    ['2024-01-01', 78], ['2024-04-01', 90], ['2024-07-01', 85], ['2024-10-01', 75],
    ['2025-01-01', 78], ['2025-04-01', 72], ['2025-07-01', 70], ['2025-10-01', 74],
    ['2026-01-01', 76], ['2026-04-01', 72], ['2026-08-01', 70],
  ]
  const series = {}
  eachDay(START, end, (iso) => {
    let i = 0
    while (i + 1 < anchors.length && anchors[i + 1][0] <= iso) i += 1
    const [d0, v0] = anchors[i]
    const [d1, v1] = anchors[Math.min(i + 1, anchors.length - 1)]
    const t0 = new Date(d0).getTime()
    const t1 = new Date(d1).getTime()
    const t = new Date(iso).getTime()
    const w = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
    const noise = Math.sin(t / 8.64e7 / 7) * 1.2
    series[iso] = Number((v0 + (v1 - v0) * w + noise).toFixed(2))
  })
  return series
}

/** Rough USD/RUB when live fetch fails. */
function syntheticUsd(end) {
  const anchors = [
    ['2017-01-01', 60], ['2017-07-01', 59], ['2018-01-01', 57], ['2018-04-01', 62],
    ['2018-09-01', 68], ['2019-01-01', 67], ['2019-07-01', 63], ['2020-01-01', 62],
    ['2020-03-01', 80], ['2020-07-01', 71], ['2021-01-01', 74], ['2021-07-01', 73],
    ['2022-01-01', 75], ['2022-03-01', 120], ['2022-06-01', 55], ['2022-10-01', 61],
    ['2023-01-01', 70], ['2023-04-01', 80], ['2023-07-01', 90], ['2023-10-01', 97],
    ['2024-01-01', 90], ['2024-04-01', 93], ['2024-07-01', 88], ['2024-10-01', 97],
    ['2025-01-01', 102], ['2025-04-01', 95], ['2025-07-01', 88], ['2025-10-01', 92],
    ['2026-01-01', 98], ['2026-04-01', 90], ['2026-08-01', 88],
  ]
  const series = {}
  eachDay(START, end, (iso) => {
    let i = 0
    while (i + 1 < anchors.length && anchors[i + 1][0] <= iso) i += 1
    const [d0, v0] = anchors[i]
    const [d1, v1] = anchors[Math.min(i + 1, anchors.length - 1)]
    const t0 = new Date(d0).getTime()
    const t1 = new Date(d1).getTime()
    const t = new Date(iso).getTime()
    const w = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
    series[iso] = Number((v0 + (v1 - v0) * w).toFixed(4))
  })
  return series
}

/** Rough EUR/RUB when live fetch fails. */
function syntheticEur(end) {
  const anchors = [
    ['2017-01-01', 63], ['2017-07-01', 68], ['2018-01-01', 69], ['2018-09-01', 79],
    ['2019-01-01', 76], ['2019-07-01', 71], ['2020-01-01', 69], ['2020-03-01', 87],
    ['2020-07-01', 81], ['2021-01-01', 90], ['2021-07-01', 87], ['2022-01-01', 85],
    ['2022-03-01', 130], ['2022-06-01', 58], ['2022-10-01', 60], ['2023-01-01', 75],
    ['2023-07-01', 98], ['2023-10-01', 103], ['2024-01-01', 98], ['2024-07-01', 95],
    ['2024-10-01', 105], ['2025-01-01', 108], ['2025-07-01', 96], ['2026-01-01', 102],
    ['2026-04-01', 98], ['2026-08-01', 95],
  ]
  const series = {}
  eachDay(START, end, (iso) => {
    let i = 0
    while (i + 1 < anchors.length && anchors[i + 1][0] <= iso) i += 1
    const [d0, v0] = anchors[i]
    const [d1, v1] = anchors[Math.min(i + 1, anchors.length - 1)]
    const t0 = new Date(d0).getTime()
    const t1 = new Date(d1).getTime()
    const t = new Date(iso).getTime()
    const w = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
    series[iso] = Number((v0 + (v1 - v0) * w).toFixed(4))
  })
  return series
}

/** Rough CNY/RUB when live fetch fails. */
function syntheticCny(end) {
  const anchors = [
    ['2017-01-01', 8.7], ['2017-07-01', 8.8], ['2018-01-01', 8.9], ['2018-09-01', 9.8],
    ['2019-01-01', 9.9], ['2019-07-01', 9.2], ['2020-01-01', 8.9], ['2020-03-01', 11.2],
    ['2020-07-01', 10.1], ['2021-01-01', 11.4], ['2021-07-01', 11.2], ['2022-01-01', 11.8],
    ['2022-03-01', 18.5], ['2022-06-01', 8.2], ['2022-10-01', 8.5], ['2023-01-01', 10.2],
    ['2023-07-01', 12.5], ['2023-10-01', 13.2], ['2024-01-01', 12.5], ['2024-07-01', 12.1],
    ['2024-10-01', 13.5], ['2025-01-01', 14.0], ['2025-07-01', 12.4], ['2026-01-01', 13.5],
    ['2026-04-01', 12.8], ['2026-08-01', 12.5],
  ]
  const series = {}
  eachDay(START, end, (iso) => {
    let i = 0
    while (i + 1 < anchors.length && anchors[i + 1][0] <= iso) i += 1
    const [d0, v0] = anchors[i]
    const [d1, v1] = anchors[Math.min(i + 1, anchors.length - 1)]
    const t0 = new Date(d0).getTime()
    const t1 = new Date(d1).getTime()
    const t = new Date(iso).getTime()
    const w = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
    series[iso] = Number((v0 + (v1 - v0) * w).toFixed(4))
  })
  return series
}

async function fetchCbrFx(valNmRq, end) {
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }
  const url =
    `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${fmt(START)}&date_req2=${fmt(end)}&VAL_NM_RQ=${valNmRq}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`CBR HTTP ${res.status}`)
  const xml = await res.text()
  const series = {}
  const re = /Date="(\d{2})\.(\d{2})\.(\d{4})"[\s\S]*?<Value>([\d,]+)<\/Value>/g
  let m
  while ((m = re.exec(xml))) {
    const iso = `${m[3]}-${m[2]}-${m[1]}`
    series[iso] = Number(m[4].replace(',', '.'))
  }
  if (Object.keys(series).length < 100) throw new Error('CBR: too few points')
  return series
}

async function fetchCbrUsd(end) {
  return fetchCbrFx('R01235', end)
}

async function fetchCbrEur(end) {
  return fetchCbrFx('R01239', end)
}

async function fetchCbrCny(end) {
  // R01375 = CNY. Prefer per-1 CNY: divide by Nominal when CBR quotes per 10.
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }
  const url =
    `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${fmt(START)}&date_req2=${fmt(end)}&VAL_NM_RQ=R01375`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`CBR HTTP ${res.status}`)
  const xml = await res.text()
  const series = {}
  const re =
    /Date="(\d{2})\.(\d{2})\.(\d{4})"[\s\S]*?<Nominal>(\d+)<\/Nominal>[\s\S]*?<Value>([\d,]+)<\/Value>/g
  let m
  while ((m = re.exec(xml))) {
    const iso = `${m[3]}-${m[2]}-${m[1]}`
    const nominal = Number(m[4]) || 1
    const value = Number(m[5].replace(',', '.'))
    series[iso] = Number((value / nominal).toFixed(4))
  }
  if (Object.keys(series).length < 100) throw new Error('CBR: too few points')
  return series
}

async function fetchBrentStooq() {
  const url = 'https://stooq.com/q/d/l/?s=brent.f&i=d'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`)
  const text = await res.text()
  const rows = parseCsv(text)
  const series = {}
  for (let i = 1; i < rows.length; i++) {
    const [date, , , , close] = rows[i]
    if (!date || !close) continue
    if (date < START) continue
    const v = Number(close)
    if (Number.isFinite(v)) series[date] = v
  }
  if (Object.keys(series).length < 100) throw new Error('Stooq: too few points')
  return series
}

function loadRawCsv(name) {
  const path = join(RAW_DIR, name)
  if (!existsSync(path)) return null
  const rows = parseCsv(readFileSync(path, 'utf8'))
  const series = {}
  for (let i = 0; i < rows.length; i++) {
    const [date, value] = rows[i]
    if (!date || date.toLowerCase() === 'date') continue
    const v = Number(String(value).replace(',', '.'))
    if (Number.isFinite(v)) series[date] = v
  }
  return Object.keys(series).length ? series : null
}

function forwardFillDaily(sparse, end) {
  const series = {}
  let last = null
  const dates = eachDay(START, end, (iso) => iso)
  const first = dates.find((d) => sparse[d] !== undefined)
  if (first !== undefined) last = sparse[first]
  for (const d of dates) {
    if (sparse[d] !== undefined) last = sparse[d]
    if (last !== null) series[d] = last
  }
  return series
}

async function main() {
  const end = todayISO()
  mkdirSync(dirname(OUT), { recursive: true })
  mkdirSync(RAW_DIR, { recursive: true })

  let usd = loadRawCsv('usd_rub.csv')
  let eur = loadRawCsv('eur_rub.csv')
  let cny = loadRawCsv('cny_rub.csv')
  let brent = loadRawCsv('brent.csv')
  const sources = {
    usd_rub: 'fallback',
    eur_rub: 'fallback',
    cny_rub: 'fallback',
    brent: 'fallback',
    key_rate: 'embedded',
    cpi_yoy: 'embedded',
  }

  try {
    if (!usd) {
      usd = await fetchCbrUsd(end)
      sources.usd_rub = 'cbr.ru'
      console.log('USD/RUB: fetched from CBR')
    } else {
      sources.usd_rub = 'data/raw/usd_rub.csv'
      console.log('USD/RUB: loaded from data/raw')
    }
  } catch (e) {
    console.warn('USD/RUB fetch failed, using synthetic:', e.message)
    usd = syntheticUsd(end)
  }

  try {
    if (!eur) {
      eur = await fetchCbrEur(end)
      sources.eur_rub = 'cbr.ru'
      console.log('EUR/RUB: fetched from CBR')
    } else {
      sources.eur_rub = 'data/raw/eur_rub.csv'
      console.log('EUR/RUB: loaded from data/raw')
    }
  } catch (e) {
    console.warn('EUR/RUB fetch failed, using synthetic:', e.message)
    eur = syntheticEur(end)
  }

  try {
    if (!cny) {
      cny = await fetchCbrCny(end)
      sources.cny_rub = 'cbr.ru'
      console.log('CNY/RUB: fetched from CBR')
    } else {
      sources.cny_rub = 'data/raw/cny_rub.csv'
      console.log('CNY/RUB: loaded from data/raw')
    }
  } catch (e) {
    console.warn('CNY/RUB fetch failed, using synthetic:', e.message)
    cny = syntheticCny(end)
  }

  try {
    if (!brent) {
      brent = await fetchBrentStooq()
      sources.brent = 'stooq.com'
      console.log('Brent: fetched from Stooq')
    } else {
      sources.brent = 'data/raw/brent.csv'
      console.log('Brent: loaded from data/raw')
    }
  } catch (e) {
    console.warn('Brent fetch failed, using synthetic:', e.message)
    brent = syntheticBrent(end)
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    startDate: START,
    endDate: end,
    sources,
    meta: [
      {
        id: 'usd_rub',
        label: 'Курс USD/RUB',
        description: 'Официальный курс доллара США к рублю (ЦБ РФ)',
        aggregate: 'mean',
      },
      {
        id: 'eur_rub',
        label: 'Курс EUR/RUB',
        description: 'Официальный курс евро к рублю (ЦБ РФ)',
        aggregate: 'mean',
      },
      {
        id: 'cny_rub',
        label: 'Курс CNY/RUB',
        description: 'Официальный курс китайского юаня к рублю (ЦБ РФ, за 1 CNY)',
        aggregate: 'mean',
      },
      {
        id: 'brent',
        label: 'Нефть Brent',
        description: 'Цена барреля нефти Brent, USD',
        aggregate: 'mean',
      },
      {
        id: 'key_rate',
        label: 'Ключевая ставка ЦБ',
        description: 'Ключевая ставка Банка России, %',
        aggregate: 'last',
      },
      {
        id: 'cpi_yoy',
        label: 'Инфляция ИПЦ (YoY)',
        description: 'Индекс потребительских цен, прирост год к году, %',
        aggregate: 'mean',
      },
    ],
    series: {
      usd_rub: forwardFillDaily(usd, end),
      eur_rub: forwardFillDaily(eur, end),
      cny_rub: forwardFillDaily(cny, end),
      brent: forwardFillDaily(brent, end),
      key_rate: stepSeries(KEY_RATE_STEPS, end),
      cpi_yoy: cpiSeries(end),
    },
  }

  writeFileSync(OUT, JSON.stringify(payload))
  const n = Object.keys(payload.series.usd_rub).length
  console.log(`Wrote ${OUT}`)
  console.log(`Range ${START} … ${end}, days=${n}, factors: ${payload.meta.map((m) => m.id).join(', ')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

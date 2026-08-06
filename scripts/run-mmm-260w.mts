/**
 * Mirror the app pipeline on MMM_Test_Dataset_260weeks.xlsx:
 * file import → recommended RF factors → weekly → auto channel transforms → VIF prune.
 */
import { readFileSync, writeFileSync } from 'fs'
import {
  cleanRowsToSeriesTexts,
  detectDateColumn,
  guessFactorIndices,
  guessTargetIndex,
  processMappedTable,
  readTabularFile,
} from '../src/lib/fileImport.ts'
import { alignDataset } from '../src/lib/align.ts'
import { runOls } from '../src/lib/ols.ts'
import { buildDecomposition } from '../src/lib/decomposition.ts'
import { buildLiteSummary, highVifFactorIds } from '../src/lib/liteSummary.ts'
import { slugifyChannel } from '../src/lib/parse.ts'
import type { AlignedDataset, NamedSeries, OlsResult, ParsedPoint, RegressorsPayload } from '../src/lib/types.ts'

type ChannelTransform = 'raw' | 'lag1' | 'adstock05' | 'log1p' | 'adstock07_log1p'

const EXTRA_FX = ['eur_rub', 'cny_rub']
const HEAVY_MACRO = ['brent', 'cpi_yoy']
const CALENDAR_CORE = [
  'is_holiday',
  'is_weekend',
  'salary_days',
  'school_holiday',
  'major_sale',
  'month_sin',
  'month_cos',
]

/** Columns that are controls / not media → baseline (external). */
const EXTERNAL_NAMES = new Set([
  'price_index',
  'holiday',
  'trend',
  'seasonality',
])

/** Skip synthetic GT controls — use RF builtins instead (true «наш инструмент»). */
const SKIP_AS_CHANNEL = new Set(['holiday', 'trend', 'seasonality'])

function sortPoints(points: { date: string; value: number }[]) {
  return [...points].sort((a, b) => (a.date < b.date ? -1 : 1))
}

function transformSeries(points: { date: string; value: number }[], kind: ChannelTransform) {
  const s = sortPoints(points)
  if (kind === 'raw') return s
  if (kind === 'lag1') {
    return s.map((p, i) => ({ ...p, value: i === 0 ? 0 : s[i - 1].value }))
  }
  if (kind === 'adstock05' || kind === 'adstock07_log1p') {
    const decay = kind === 'adstock05' ? 0.5 : 0.7
    let prev = 0
    return s.map((p) => {
      const base = Math.max(0, p.value) + decay * prev
      prev = base
      return { ...p, value: kind === 'adstock07_log1p' ? Math.log1p(base) : base }
    })
  }
  return s.map((p) => ({ ...p, value: Math.log1p(Math.max(0, p.value)) }))
}

function fitSimpleRegression(x: number[], y: number[]) {
  if (x.length !== y.length || x.length < 3) return null
  const mx = x.reduce((a, b) => a + b, 0) / x.length
  const my = y.reduce((a, b) => a + b, 0) / y.length
  let num = 0
  let den = 0
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my)
    den += (x[i] - mx) ** 2
  }
  if (den <= 1e-12) return null
  return { alpha: my - (num / den) * mx, beta: num / den }
}

function smape(pred: number[], y: number[]) {
  if (pred.length === 0) return Infinity
  let s = 0
  for (let i = 0; i < pred.length; i++) {
    s += (2 * Math.abs(pred[i] - y[i])) / Math.max(Math.abs(pred[i]) + Math.abs(y[i]), 1e-9)
  }
  return (100 * s) / pred.length
}

function mape(pred: number[], y: number[]) {
  if (pred.length === 0) return Infinity
  let s = 0
  for (let i = 0; i < pred.length; i++) {
    s += Math.abs(pred[i] - y[i]) / Math.max(Math.abs(y[i]), 1e-9)
  }
  return (100 * s) / pred.length
}

function selectBestTransform(
  channelPoints: { date: string; value: number }[],
  yPoints: { date: string; value: number }[],
  from: string,
  to: string,
): { kind: ChannelTransform; score: number } {
  const yMap = new Map(
    yPoints.filter((p) => p.date >= from && p.date <= to).map((p) => [p.date, p.value]),
  )
  const kinds: ChannelTransform[] = ['raw', 'lag1', 'adstock05', 'log1p', 'adstock07_log1p']
  let best: { kind: ChannelTransform; score: number } = { kind: 'raw', score: Infinity }
  for (const kind of kinds) {
    const transformed = transformSeries(channelPoints, kind).filter((p) => yMap.has(p.date))
    if (transformed.length < 12) continue
    const x = transformed.map((p) => p.value)
    const y = transformed.map((p) => yMap.get(p.date)!)
    const split = Math.max(8, Math.floor(x.length * 0.8))
    const fit = fitSimpleRegression(x.slice(0, split), y.slice(0, split))
    if (!fit) continue
    const pred = x.slice(split).map((v) => fit.alpha + fit.beta * v)
    const score = smape(pred, y.slice(split))
    if (score < best.score) best = { kind, score }
  }
  return best.score < Infinity ? best : { kind: 'raw', score: Infinity }
}

function corr(a: number[], b: number[]) {
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return num / Math.sqrt(da * db)
}

async function loadTable(path: string) {
  const buf = readFileSync(path)
  const file = new File([buf], 'MMM_Test_Dataset_260weeks.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  return readTabularFile(file)
}

function runAlign(
  payload: RegressorsPayload,
  yPoints: ParsedPoint[],
  adSeries: NamedSeries[],
  enabledFactors: string[],
  from: string,
  to: string,
) {
  return alignDataset({
    payload,
    yPoints,
    adSeries,
    enabledFactors,
    from,
    to,
    granularity: 'week',
  })
}

function pickModel(
  payload: RegressorsPayload,
  yPoints: ParsedPoint[],
  adSeries: NamedSeries[],
  incrementalIds: Set<string>,
  enabledFactors: string[],
  from: string,
  to: string,
) {
  const transformedNotes: string[] = []
  const transformedAdSeries: NamedSeries[] = adSeries.map((s) => {
    if (!incrementalIds.has(s.id)) return s
    const best = selectBestTransform(s.points, yPoints, from, to)
    if (best.kind === 'raw') return s
    transformedNotes.push(`${s.label}: ${best.kind} (sMAPE ${best.score.toFixed(1)}%)`)
    return { ...s, points: transformSeries(s.points, best.kind) }
  })

  const alignedRaw = runAlign(payload, yPoints, adSeries, enabledFactors, from, to)
  if (alignedRaw.error || !alignedRaw.dataset) throw new Error(alignedRaw.error || 'align failed')

  const rawResult = runOls(alignedRaw.dataset)
  let selectedDataset = alignedRaw.dataset
  let selectedResult = rawResult
  let selectedNotes: string[] = []

  if (transformedNotes.length > 0) {
    const alignedTr = runAlign(payload, yPoints, transformedAdSeries, enabledFactors, from, to)
    if (alignedTr.dataset && !alignedTr.error) {
      const trResult = runOls(alignedTr.dataset)
      const rawDecomp = buildDecomposition(alignedRaw.dataset, rawResult, incrementalIds)
      const trDecomp = buildDecomposition(alignedTr.dataset, trResult, incrementalIds)
      const rawClamp = rawDecomp.clampedBaselinePoints / Math.max(rawDecomp.dates.length, 1)
      const trClamp = trDecomp.clampedBaselinePoints / Math.max(trDecomp.dates.length, 1)
      const rawScore = (rawResult.validation?.smapeTest ?? 100) + rawClamp * 35
      const trScore = (trResult.validation?.smapeTest ?? 100) + trClamp * 35
      if (trScore + 1 < rawScore && trClamp < 0.8) {
        selectedDataset = alignedTr.dataset
        selectedResult = trResult
        selectedNotes = transformedNotes
      } else {
        selectedNotes = [
          'Автотрансформации проверены, но отключены: не улучшили holdout или ухудшили базу.',
        ]
      }
    }
  }

  return { dataset: selectedDataset, result: selectedResult, transformNotes: selectedNotes }
}

function summarize(
  dataset: AlignedDataset,
  result: OlsResult,
  incrementalIds: Set<string>,
  spendById: Record<string, number>,
  dropped: string[],
  transformNotes: string[],
) {
  const channelIdsInModel = new Set(
    result.coefficients.map((c) => c.id).filter((id) => incrementalIds.has(id)),
  )
  const decomp = buildDecomposition(dataset, result, channelIdsInModel)
  const lite = buildLiteSummary(result, dataset)
  const inSampleMape = mape(result.fitted, dataset.y)

  const channelPerf = result.coefficients
    .filter((c) => channelIdsInModel.has(c.id))
    .map((c) => {
      const series = decomp.incremental[c.id] ?? []
      const totalLift = series.reduce((a, b) => a + b, 0)
      const spend = spendById[c.id] ?? 0
      return {
        id: c.id,
        label: c.label,
        beta: +c.beta.toFixed(6),
        p: +c.p.toFixed(4),
        significant: c.significant05,
        sharePct: +(c.contributionShare * 100).toFixed(1),
        vif: +c.vif.toFixed(2),
        stdBeta: +c.standardizedBeta.toFixed(3),
        totalLift: +totalLift.toFixed(0),
        meanWeeklyLift: +(totalLift / Math.max(series.length, 1)).toFixed(1),
        totalSpend: Math.round(spend),
        salesPer1kSpend: spend ? +((totalLift / spend) * 1000).toFixed(4) : null,
      }
    })
    .sort((a, b) => b.sharePct - a.sharePct)

  const baseFactors = result.coefficients
    .filter((c) => !channelIdsInModel.has(c.id))
    .map((c) => ({
      id: c.id,
      label: c.label,
      beta: +c.beta.toFixed(4),
      p: +c.p.toFixed(4),
      significant: c.significant05,
      sharePct: +(c.contributionShare * 100).toFixed(1),
      vif: +c.vif.toFixed(2),
      stdBeta: +c.standardizedBeta.toFixed(3),
    }))
    .sort((a, b) => b.sharePct - a.sharePct)

  // downsample chart to every 4th week + ends for canvas readability
  const step = 4
  const idx = dataset.dates.map((_, i) => i).filter((i) => i % step === 0 || i === dataset.dates.length - 1)

  return {
    dropped,
    transformNotes,
    fit: {
      r2: +result.r2.toFixed(4),
      adjR2: +result.adjR2.toFixed(4),
      intercept: +result.intercept.toFixed(1),
      k: result.k,
      n: result.n,
      inSampleMape: +inSampleMape.toFixed(1),
      warnings: result.warnings,
      validation: result.validation
        ? {
            trainN: result.validation.trainN,
            testN: result.validation.testN,
            r2Test: +result.validation.r2Test.toFixed(3),
            smapeTest: +result.validation.smapeTest.toFixed(1),
            mapeTest: +result.validation.mapeTest.toFixed(1),
          }
        : null,
    },
    lite: {
      trust: lite.trust,
      trustText: lite.trustText,
      accuracyPct: +lite.accuracyPct.toFixed(1),
      hasCollinearity: lite.hasCollinearity,
      influencing: lite.influencing.map((c) => ({
        label: c.label,
        verdict: c.verdict,
        sharePct: +c.sharePct.toFixed(1),
      })),
      notInfluencing: lite.notInfluencing.map((c) => ({
        label: c.label,
        sharePct: +c.sharePct.toFixed(1),
      })),
    },
    decomp: {
      baselineShare: +(decomp.baselineShare * 100).toFixed(1),
      incrementalShare: +(decomp.incrementalShare * 100).toFixed(1),
      clampedBaselinePoints: decomp.clampedBaselinePoints,
      dates: idx.map((i) => decomp.dates[i]),
      actual: idx.map((i) => decomp.actual[i]),
      fitted: idx.map((i) => +decomp.fitted[i].toFixed(1)),
      baseline: idx.map((i) => +decomp.baseline[i].toFixed(1)),
      channelTotals: Object.fromEntries(
        Object.entries(decomp.incremental).map(([id, vals]) => [
          id,
          +vals.reduce((a, b) => a + b, 0).toFixed(0),
        ]),
      ),
    },
    channelPerf,
    baseFactors,
    enabled: result.coefficients.map((c) => c.id),
  }
}

async function main() {
  const path = '/Users/levan/Downloads/MMM_Test_Dataset_260weeks.xlsx'
  const payload: RegressorsPayload = JSON.parse(
    readFileSync('./public/data/regressors.json', 'utf8'),
  )

  const table = await loadTable(path)
  const di = detectDateColumn(table)
  if (di === null) throw new Error('no date column')
  const ti = guessTargetIndex(table, di)
  if (ti === null) throw new Error('no target')
  let fi = guessFactorIndices(table, di, ti)

  // Drop synthetic GT calendar columns — RF builtins cover that role
  fi = fi.filter((i) => !SKIP_AS_CHANNEL.has(table.headers[i]))

  const processed = processMappedTable(table, {
    dateIndex: di,
    targetIndex: ti,
    factorIndices: fi,
    duplicateStrategy: 'sum',
  })
  if (processed.error) throw new Error(processed.error)

  const texts = cleanRowsToSeriesTexts(processed)
  const yPoints = processed.rows.map((r) => ({ date: r.date, value: r.target }))

  const named: { id: string; label: string; role: 'incremental' | 'external'; points: ParsedPoint[] }[] =
    []
  texts.factors.forEach((f, i) => {
    const id = slugifyChannel(f.name, 'channel', i)
    const role: 'incremental' | 'external' = EXTERNAL_NAMES.has(f.name) ? 'external' : 'incremental'
    named.push({
      id,
      label: f.name,
      role,
      points: processed.rows.map((r) => ({ date: r.date, value: r.factors[f.name] ?? 0 })),
    })
  })

  const adSeries: NamedSeries[] = named.map(({ id, label, points }) => ({ id, label, points }))
  const incrementalIds = new Set(named.filter((n) => n.role === 'incremental').map((n) => n.id))

  const from = processed.minDate < payload.startDate ? payload.startDate : processed.minDate
  const to = processed.maxDate > payload.endDate ? payload.endDate : processed.maxDate

  const compactMacro = payload.meta
    .map((m) => m.id)
    .filter((id) => !EXTRA_FX.includes(id) && !HEAVY_MACRO.includes(id))

  let enabled = [
    ...compactMacro,
    ...CALENDAR_CORE,
    ...named.map((n) => n.id),
  ]

  // recommended for week: no DOW
  let { dataset, result, transformNotes } = pickModel(
    payload,
    yPoints,
    adSeries,
    incrementalIds,
    enabled,
    from,
    to,
  )

  const droppedAll: string[] = []
  for (let round = 0; round < 20; round++) {
    let drop = highVifFactorIds(result)
    if (drop.length === 0) {
      const offenders = result.coefficients.filter((c) => c.vif > 10).sort((a, b) => b.vif - a.vif)
      if (offenders.length === 0) break
      drop = [offenders[0].id]
    }
    for (const id of drop) {
      if (!droppedAll.includes(id)) droppedAll.push(id)
    }
    enabled = enabled.filter((id) => !drop.includes(id))
    ;({ dataset, result, transformNotes } = pickModel(
      payload,
      yPoints,
      adSeries,
      incrementalIds,
      enabled,
      from,
      to,
    ))
  }

  const spendById: Record<string, number> = {}
  for (const n of named) {
    if (!incrementalIds.has(n.id)) continue
    spendById[n.id] = n.points
      .filter((p) => p.date >= from && p.date <= to)
      .reduce((s, p) => s + p.value, 0)
  }

  const cleaned = summarize(
    dataset,
    result,
    incrementalIds,
    spendById,
    droppedAll,
    transformNotes,
  )

  // correlations among media
  const media = named.filter((n) => incrementalIds.has(n.id))
  const sales = yPoints.filter((p) => p.date >= from && p.date <= to).map((p) => p.value)
  const corrs = media.map((m) => {
    const xs = m.points.filter((p) => p.date >= from && p.date <= to).map((p) => p.value)
    return { channel: m.label, corrSales: +corr(xs, sales).toFixed(3) }
  })

  const pair: { a: string; b: string; r: number }[] = []
  for (let i = 0; i < media.length; i++) {
    for (let j = i + 1; j < media.length; j++) {
      const a = media[i].points.filter((p) => p.date >= from && p.date <= to).map((p) => p.value)
      const b = media[j].points.filter((p) => p.date >= from && p.date <= to).map((p) => p.value)
      pair.push({ a: media[i].label, b: media[j].label, r: +corr(a, b).toFixed(3) })
    }
  }
  pair.sort((x, y) => y.r - x.r)

  const expected = {
    r2: '>0.85',
    mape: '8-12%',
    baseShare: '58-62%',
    increment: '38-42%',
  }

  const vsExpected = {
    r2: { target: expected.r2, actual: cleaned.fit.r2, pass: cleaned.fit.r2 > 0.85 },
    mape: {
      target: expected.mape,
      actual: cleaned.fit.validation?.mapeTest ?? cleaned.fit.inSampleMape,
      pass:
        (cleaned.fit.validation?.mapeTest ?? cleaned.fit.inSampleMape) >= 8 &&
        (cleaned.fit.validation?.mapeTest ?? cleaned.fit.inSampleMape) <= 12,
    },
    baseShare: {
      target: expected.baseShare,
      actual: cleaned.decomp.baselineShare,
      pass: cleaned.decomp.baselineShare >= 58 && cleaned.decomp.baselineShare <= 62,
    },
    increment: {
      target: expected.increment,
      actual: cleaned.decomp.incrementalShare,
      pass: cleaned.decomp.incrementalShare >= 38 && cleaned.decomp.incrementalShare <= 42,
    },
  }

  const groundTruth = {
    'TV coef': 0.00018,
    'Direct coef': 0.00025,
    'Radio coef': 0.0002,
    'Brand search coef': 0.6,
    'Nonbrand coef': 0.25,
    'Price penalty': -9000,
  }

  const coefCompare = [
    { gt: 'TV coef', labelMatch: /tv/i, gtBeta: 0.00018 },
    { gt: 'Radio coef', labelMatch: /radio/i, gtBeta: 0.0002 },
    { gt: 'Direct coef', labelMatch: /direct/i, gtBeta: 0.00025 },
    { gt: 'Brand search coef', labelMatch: /brand_search|brand search/i, gtBeta: 0.6 },
    { gt: 'Nonbrand coef', labelMatch: /nonbrand/i, gtBeta: 0.25 },
    { gt: 'Price penalty', labelMatch: /price/i, gtBeta: -9000 },
  ].map((row) => {
    const found = result.coefficients.find((c) => row.labelMatch.test(c.label) || row.labelMatch.test(c.id))
    return {
      groundTruth: row.gt,
      gtBeta: row.gtBeta,
      estimated: found ? +found.beta.toFixed(6) : null,
      inModel: !!found,
      significant: found?.significant05 ?? false,
      label: found?.label ?? null,
    }
  })

  const out = {
    setup: {
      file: 'MMM_Test_Dataset_260weeks.xlsx',
      granularity: 'week',
      from,
      to,
      nRows: processed.rows.length,
      importWarnings: processed.warnings,
      skippedSynthetic: [...SKIP_AS_CHANNEL],
      external: named.filter((n) => n.role === 'external').map((n) => n.label),
      media: named.filter((n) => n.role === 'incremental').map((n) => n.label),
      note: 'Пайплайн как в приложении: рекомендуемые РФ-факторы, week, автотрансформы каналов, итеративный VIF-prune.',
    },
    cleaned,
    correlations: { vsSales: corrs, betweenChannels: pair.slice(0, 8) },
    vsExpected,
    coefCompare,
    groundTruth,
  }

  writeFileSync('./scripts/mmm-260w-results.json', JSON.stringify(out, null, 2))
  console.log(
    JSON.stringify(
      {
        setup: out.setup,
        fit: cleaned.fit,
        shares: {
          base: cleaned.decomp.baselineShare,
          inc: cleaned.decomp.incrementalShare,
        },
        dropped: cleaned.dropped,
        transforms: cleaned.transformNotes,
        channelPerf: cleaned.channelPerf,
        baseTop: cleaned.baseFactors.slice(0, 8),
        vsExpected,
        coefCompare,
        lite: cleaned.lite,
        corrsTop: corrs,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

import { readFileSync, writeFileSync } from 'fs'
import { alignDataset } from '../src/lib/align.ts'
import { runOls } from '../src/lib/ols.ts'
import { buildDecomposition } from '../src/lib/decomposition.ts'
import { buildLiteSummary, highVifFactorIds } from '../src/lib/liteSummary.ts'
import type { AlignedDataset, OlsResult } from '../src/lib/types.ts'

const payload = JSON.parse(readFileSync('./public/data/regressors.json', 'utf8'))

const raw = `Date,Sales,TV,Search,Social,Email,OOH
2024-01-01,12500,500000,150000,200000,30000,100000
2024-02-01,13100,480000,160000,210000,32000,100000
2024-03-01,14500,550000,180000,250000,35000,120000
2024-04-01,14200,520000,175000,240000,34000,110000
2024-05-01,13800,500000,170000,220000,33000,110000
2024-06-01,13500,450000,165000,210000,31000,100000
2024-07-01,13200,400000,160000,200000,30000,90000
2024-08-01,14000,450000,175000,230000,33000,100000
2024-09-01,15500,600000,190000,260000,38000,130000
2024-10-01,16200,650000,200000,280000,40000,140000
2024-11-01,21000,800000,300000,400000,60000,180000
2024-12-01,23500,900000,350000,450000,70000,200000
2025-01-01,13000,510000,155000,205000,31000,105000
2025-02-01,13600,490000,165000,215000,33000,105000
2025-03-01,15100,560000,185000,255000,36000,125000
2025-04-01,14800,530000,180000,245000,35000,115000
2025-05-01,14400,510000,175000,225000,34000,115000
2025-06-01,14100,460000,170000,215000,32000,105000
2025-07-01,13800,410000,165000,205000,31000,95000
2025-08-01,14600,460000,180000,235000,34000,105000
2025-09-01,16100,610000,195000,265000,39000,135000
2025-10-01,16800,660000,205000,285000,41000,145000
2025-11-01,21800,820000,310000,410000,62000,185000
2025-12-01,24200,920000,360000,460000,72000,205000`

const rows = raw
  .trim()
  .split('\n')
  .slice(1)
  .map((l) => {
    const [date, Sales, TV, Search, Social, Email, OOH] = l.split(',')
    return {
      date,
      Sales: +Sales,
      TV: +TV,
      Search: +Search,
      Social: +Social,
      Email: +Email,
      OOH: +OOH,
    }
  })

const y = rows.map((r) => ({ date: r.date, value: r.Sales }))
const channels = [
  { id: 'tv', label: 'TV', points: rows.map((r) => ({ date: r.date, value: r.TV })) },
  { id: 'search', label: 'Search', points: rows.map((r) => ({ date: r.date, value: r.Search })) },
  { id: 'social', label: 'Social', points: rows.map((r) => ({ date: r.date, value: r.Social })) },
  { id: 'email', label: 'Email', points: rows.map((r) => ({ date: r.date, value: r.Email })) },
  { id: 'ooh', label: 'OOH', points: rows.map((r) => ({ date: r.date, value: r.OOH })) },
]

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
const compactMacro = payload.meta
  .map((m: { id: string }) => m.id)
  .filter((id: string) => !EXTRA_FX.includes(id) && !HEAVY_MACRO.includes(id))

function run(enabledFactors: string[]) {
  const { dataset, error } = alignDataset({
    payload,
    yPoints: y,
    adSeries: channels,
    enabledFactors,
    from: '2024-01-01',
    to: '2025-12-01',
    granularity: 'month',
  })
  if (error || !dataset) throw new Error(error || 'align failed')
  return { dataset, result: runOls(dataset) }
}

function summarize(dataset: AlignedDataset, result: OlsResult, dropped: string[]) {
  const channelIdsInModel = new Set(
    result.coefficients.map((c) => c.id).filter((id) => channels.some((ch) => ch.id === id)),
  )
  const decomp = buildDecomposition(dataset, result, channelIdsInModel)
  const lite = buildLiteSummary(result, dataset)

  const spendById: Record<string, number> = {
    tv: rows.reduce((s, r) => s + r.TV, 0),
    search: rows.reduce((s, r) => s + r.Search, 0),
    social: rows.reduce((s, r) => s + r.Social, 0),
    email: rows.reduce((s, r) => s + r.Email, 0),
    ooh: rows.reduce((s, r) => s + r.OOH, 0),
  }

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
        meanMonthlyLift: +(totalLift / series.length).toFixed(1),
        totalSpend: spend,
        salesPer1kSpend: spend ? +((totalLift / spend) * 1000).toFixed(3) : null,
      }
    })
    .sort((a, b) => Math.abs(b.sharePct) - Math.abs(a.sharePct))

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

  return {
    dropped,
    fit: {
      r2: +result.r2.toFixed(4),
      adjR2: +result.adjR2.toFixed(4),
      intercept: +result.intercept.toFixed(1),
      k: result.k,
      n: result.n,
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
      dates: decomp.dates,
      actual: decomp.actual,
      fitted: decomp.fitted.map((v) => +v.toFixed(1)),
      baseline: decomp.baseline.map((v) => +v.toFixed(1)),
      channels: Object.fromEntries(
        Object.entries(decomp.incremental).map(([id, vals]) => [
          id,
          vals.map((v) => +v.toFixed(1)),
        ]),
      ),
    },
    channelPerf,
    baseFactors,
    enabled: result.coefficients.map((c) => c.id),
  }
}

// Start with recommended monthly set
let enabled = [...compactMacro, ...CALENDAR_CORE, ...channels.map((c) => c.id)]
let { dataset, result } = run(enabled)
const initial = summarize(dataset, result, [])

const droppedAll: string[] = []
for (let i = 0; i < 12; i++) {
  const drop = highVifFactorIds(result)
  if (drop.length === 0) break
  // Also force-drop highest VIF channel if heuristic stuck with channel collinearity
  const high = result.coefficients.filter((c) => c.vif > 10).sort((a, b) => b.vif - a.vif)
  const toDrop = drop.length ? drop : high.slice(0, 1).map((c) => c.id)
  if (toDrop.length === 0) break
  for (const id of toDrop) {
    if (!droppedAll.includes(id)) droppedAll.push(id)
  }
  enabled = enabled.filter((id) => !toDrop.includes(id))
  ;({ dataset, result } = run(enabled))
  // If channels still all VIF>10, drop worst channel explicitly
  const stillHighChannels = result.coefficients
    .filter((c) => channels.some((ch) => ch.id === c.id) && c.vif > 10)
    .sort((a, b) => b.vif - a.vif)
  if (stillHighChannels.length >= 2 && highVifFactorIds(result).length === 0) {
    const worst = stillHighChannels[0].id
    droppedAll.push(worst)
    enabled = enabled.filter((id) => id !== worst)
    ;({ dataset, result } = run(enabled))
  }
}

// Final safety: keep dropping max-VIF factor until all VIF<=10 or only 1 channel left
while (true) {
  const offenders = result.coefficients.filter((c) => c.vif > 10).sort((a, b) => b.vif - a.vif)
  if (offenders.length === 0) break
  const worst = offenders[0].id
  droppedAll.push(worst)
  enabled = enabled.filter((id) => id !== worst)
  ;({ dataset, result } = run(enabled))
}

const cleaned = summarize(dataset, result, droppedAll)

const out = {
  setup: {
    granularity: 'month',
    from: '2024-01',
    to: '2025-12',
    n: 24,
    note: 'Рекомендуемый набор РФ-факторов + 5 каналов; затем итеративная чистка по VIF.',
  },
  initial: {
    fit: initial.fit,
    lite: initial.lite,
    channelPerf: initial.channelPerf,
    shares: {
      base: initial.decomp.baselineShare,
      inc: initial.decomp.incrementalShare,
    },
  },
  cleaned,
}

writeFileSync('./scripts/user-model-results.json', JSON.stringify(out, null, 2))
console.log(
  JSON.stringify(
    {
      initialFit: initial.fit,
      cleanedFit: cleaned.fit,
      dropped: cleaned.dropped,
      channelPerf: cleaned.channelPerf,
      baseFactors: cleaned.baseFactors,
      shares: {
        base: cleaned.decomp.baselineShare,
        inc: cleaned.decomp.incrementalShare,
      },
      lite: cleaned.lite,
    },
    null,
    2,
  ),
)

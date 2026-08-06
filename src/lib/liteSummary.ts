import type { AlignedDataset, OlsResult } from './types'

export type TrustLevel = 'green' | 'yellow' | 'red'
export type InfluenceVerdict = 'up' | 'down' | 'none'

export interface LiteFactorCard {
  id: string
  label: string
  verdict: InfluenceVerdict
  sharePct: number
  meanAbs: number
  meanSigned: number
  significant: boolean
}

export interface LiteSummary {
  trust: TrustLevel
  trustText: string
  accuracyPct: number
  n: number
  hasCollinearity: boolean
  collinearityNotes: string[]
  influencing: LiteFactorCard[]
  notInfluencing: LiteFactorCard[]
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

export function buildLiteSummary(result: OlsResult, _dataset: AlignedDataset): LiteSummary {
  const highVif = result.coefficients.some((c) => c.vif > 10)
  const hasCollinearity =
    highVif || result.warnings.some((w) => w.toLowerCase().includes('мультиколлинеар'))

  let trust: TrustLevel
  if (result.adjR2 < 0.2 || result.n < 15) trust = 'red'
  else if (result.adjR2 >= 0.4 && !highVif && result.n >= 30) trust = 'green'
  else trust = 'yellow'

  const trustText =
    trust === 'green'
      ? 'Модели в целом можно доверять: данных достаточно, факторы не сильно дублируют друг друга, объяснение динамики приемлемое.'
      : trust === 'yellow'
        ? 'Стоит отнестись осторожно: картина есть, но либо маловато точек, либо факторы пересекаются, либо модель объясняет не всё.'
        : 'Данным пока рано верить: слишком мало наблюдений или модель почти ничего не объясняет. Добавьте период или проверьте ряд.'

  const cards: LiteFactorCard[] = result.coefficients.map((c) => {
    const contrib = result.contributions[c.id] ?? []
    const meanAbs = mean(contrib.map(Math.abs))
    const meanSigned = mean(contrib)
    let verdict: InfluenceVerdict = 'none'
    if (c.significant05) verdict = c.beta >= 0 ? 'up' : 'down'
    return {
      id: c.id,
      label: c.label,
      verdict,
      sharePct: c.contributionShare * 100,
      meanAbs,
      meanSigned,
      significant: c.significant05,
    }
  })

  const influencing = cards
    .filter((c) => c.significant)
    .sort((a, b) => b.sharePct - a.sharePct)
  const notInfluencing = cards
    .filter((c) => !c.significant)
    .sort((a, b) => b.sharePct - a.sharePct)

  const collinearityNotes = result.warnings.filter(
    (w) =>
      w.toLowerCase().includes('мультиколлинеар') ||
      w.toLowerCase().includes('vif') ||
      w.toLowerCase().includes('что сделать') ||
      w.toLowerCase().includes('выключите') ||
      w.toLowerCase().includes('оставьте'),
  )

  return {
    trust,
    trustText,
    accuracyPct: result.adjR2 * 100,
    n: result.n,
    hasCollinearity,
    collinearityNotes,
    influencing,
    notInfluencing,
  }
}

type CoefLike = OlsResult['coefficients'][number]

/** Higher = better to keep in the model when resolving a collinear cluster. */
function suitability(c: CoefLike): number {
  let score =
    Math.abs(c.standardizedBeta) * 100 +
    c.contributionShare * 50 +
    (1 - Math.min(c.p, 1)) * 5 -
    Math.log1p(Math.max(c.vif, 0))
  // Soft preference for cleaner / more actionable factors when scores are close
  if (
    c.id === 'is_weekend' ||
    c.id === 'key_rate' ||
    c.id === 'usd_rub' ||
    c.id === 'school_holiday' ||
    c.id === 'major_sale'
  ) {
    score += 0.5
  }
  return score
}

/**
 * From each collinear pair/cluster, drop the less suitable factor(s) and keep the best one.
 * month_sin/month_cos are an exception: they are dropped together or not at all.
 */
export function highVifFactorIds(result: OlsResult): string[] {
  const byId = new Map(result.coefficients.map((c) => [c.id, c]))
  const highIds = new Set(
    result.coefficients.filter((c) => c.vif > 10).map((c) => c.id),
  )
  if (highIds.size === 0) return []

  const drop = new Set<string>()
  const claimed = new Set<string>()

  const presentHigh = (ids: string[]) =>
    ids
      .map((id) => byId.get(id))
      .filter((c): c is CoefLike => c !== undefined && highIds.has(c.id))

  /** Keep the most suitable member; drop the rest of the cluster. */
  function dropWorseFromCluster(ids: string[]) {
    const members = presentHigh(ids)
    if (members.length < 2) return
    members.sort((a, b) => suitability(a) - suitability(b))
    for (let i = 0; i < members.length - 1; i++) drop.add(members[i].id)
    for (const m of members) claimed.add(m.id)
  }

  // Known pairs / clusters
  dropWorseFromCluster(['usd_rub', 'eur_rub', 'cny_rub'])
  dropWorseFromCluster(['usd_rub', 'brent'])
  dropWorseFromCluster(['key_rate', 'cpi_yoy'])

  const dow = ['dow_mon', 'dow_tue', 'dow_wed', 'dow_thu', 'dow_fri', 'dow_sat']
  const weekend = byId.get('is_weekend')
  const highDow = presentHigh(dow)
  if (weekend && highDow.length >= 1) {
    // Weekend is the cleaner summary — drop high-VIF day dummies, keep weekend
    for (const c of highDow) {
      drop.add(c.id)
      claimed.add(c.id)
    }
    claimed.add('is_weekend')
  } else if (highDow.length >= 2) {
    dropWorseFromCluster(dow)
  }

  // Fourier seasonality: inseparable pair — drop both only when both are high-VIF
  const sin = highIds.has('month_sin')
  const cos = highIds.has('month_cos')
  if (sin && cos && !claimed.has('month_sin') && !claimed.has('month_cos')) {
    drop.add('month_sin')
    drop.add('month_cos')
    claimed.add('month_sin')
    claimed.add('month_cos')
  }

  // Remaining high-VIF factors (no known cluster): drop only the single least suitable.
  // Do not drop an orphan month_sin / month_cos — they only make sense as a pair.
  const remaining = [...highIds]
    .filter((id) => !claimed.has(id) && !drop.has(id))
    .filter((id) => id !== 'month_sin' && id !== 'month_cos')
    .map((id) => byId.get(id)!)
    .filter(Boolean)
  if (remaining.length === 0) {
    // nothing
  } else if (drop.size === 0 || remaining.length >= 2) {
    remaining.sort((a, b) => suitability(a) - suitability(b))
    drop.add(remaining[0].id)
  }

  return [...drop].filter((id) => byId.has(id))
}

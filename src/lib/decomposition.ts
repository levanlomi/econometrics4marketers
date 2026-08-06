import type { AlignedDataset, OlsResult } from './types'

export type FactorRole = 'base' | 'incremental'

export interface DecompositionResult {
  dates: string[]
  actual: number[]
  /** Baseline (clamped ≥ 0) + all incremental layers */
  predicted: number[]
  /** Model fitted Ŷ (exact OLS prediction) */
  fitted: number[]
  /** Intercept + base factors, floored at 0 */
  baseline: number[]
  /** Raw baseline before floor (for diagnostics) */
  baselineRaw: number[]
  /** Marketing / promo layers: id → values (can be negative) */
  incremental: Record<string, number[]>
  labels: Record<string, string>
  /** Share of sum(predicted) from baseline vs incremental over the period */
  baselineShare: number
  incrementalShare: number
  clampedBaselinePoints: number
}

/**
 * Decompose OLS prediction into baseline (uncontrolled) vs incremental (marketing).
 * Built-in/macro factors and channels marked as external → base.
 * Channels marked as advertising → incremental.
 */
export function buildDecomposition(
  dataset: AlignedDataset,
  result: OlsResult,
  incrementalIds: Set<string>,
): DecompositionResult {
  const n = dataset.dates.length
  const betaById = Object.fromEntries(result.coefficients.map((c) => [c.id, c.beta]))
  const labels: Record<string, string> = { ...dataset.labels }

  const baselineRaw = Array.from({ length: n }, (_, i) => {
    let v = result.intercept
    for (const c of result.coefficients) {
      if (incrementalIds.has(c.id)) continue
      v += (betaById[c.id] ?? 0) * (dataset.X[c.id]?.[i] ?? 0)
    }
    return v
  })

  const baseline = baselineRaw.map((v) => Math.max(0, v))
  const clampedBaselinePoints = baselineRaw.filter((v, i) => v < 0 && baseline[i] === 0).length

  const incremental: Record<string, number[]> = {}
  for (const c of result.coefficients) {
    if (!incrementalIds.has(c.id)) continue
    const b = betaById[c.id] ?? 0
    incremental[c.id] = (dataset.X[c.id] ?? Array(n).fill(0)).map((x) => b * x)
  }

  const predicted = Array.from({ length: n }, (_, i) => {
    let v = baseline[i]
    for (const id of Object.keys(incremental)) {
      v += incremental[id][i]
    }
    return v
  })

  let baseSum = 0
  let incSum = 0
  for (let i = 0; i < n; i++) {
    baseSum += baseline[i]
    for (const id of Object.keys(incremental)) {
      // Use absolute for share of "magnitude" so negatives don't cancel the story oddly;
      // for share of predicted use signed: incremental contribution to total predicted
      incSum += incremental[id][i]
    }
  }
  const total = baseSum + incSum
  const baselineShare = total !== 0 ? baseSum / total : 1
  const incrementalShare = total !== 0 ? incSum / total : 0

  return {
    dates: dataset.dates,
    actual: dataset.y,
    predicted,
    fitted: result.fitted,
    baseline,
    baselineRaw,
    incremental,
    labels,
    baselineShare,
    incrementalShare,
    clampedBaselinePoints,
  }
}

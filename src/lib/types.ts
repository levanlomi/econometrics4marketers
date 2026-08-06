export type Granularity = 'day' | 'week' | 'month'

export interface RegressorMeta {
  id: string
  label: string
  description: string
  /** How to aggregate when coarsening granularity */
  aggregate: 'sum' | 'mean' | 'last' | 'max'
  /** Built-in factors generated from calendar (not stored as series) */
  derived?: boolean
}

export interface RegressorsPayload {
  updatedAt: string
  startDate: string
  endDate: string
  sources?: Record<string, string>
  series: Record<string, Record<string, number>>
  meta: RegressorMeta[]
}

export interface ParsedPoint {
  date: string
  value: number
}

export interface NamedSeries {
  id: string
  label: string
  points: ParsedPoint[]
}

export interface AlignedDataset {
  dates: string[]
  y: number[]
  /** factor id -> values aligned to dates */
  X: Record<string, number[]>
  labels: Record<string, string>
}

export interface CoefficientRow {
  id: string
  label: string
  beta: number
  se: number
  t: number
  p: number
  standardizedBeta: number
  contributionShare: number
  vif: number
  significant05: boolean
  significant01: boolean
}

export interface OlsResult {
  n: number
  k: number
  r2: number
  adjR2: number
  intercept: number
  interceptSe: number
  interceptT: number
  interceptP: number
  coefficients: CoefficientRow[]
  fitted: number[]
  residuals: number[]
  /** demeaned contribution per factor per observation */
  contributions: Record<string, number[]>
  baseline: number[]
  warnings: string[]
  validation?: {
    method: 'holdout'
    trainN: number
    testN: number
    r2Test: number
    mapeTest: number
    smapeTest: number
    rmseTest: number
  }
}

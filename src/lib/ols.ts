import { inv, matMul, matVec, transpose } from './matrix'
import type { AlignedDataset, CoefficientRow, OlsResult } from './types'

/** Approximate regularized incomplete beta via continued fraction (for t CDF). */
function betacf(a: number, b: number, x: number): number {
  const maxIt = 200
  const eps = 3e-7
  let am = 1
  let bm = 1
  let az = 1
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let bz = 1 - (qab * x) / qap

  for (let m = 1; m <= maxIt; m++) {
    const tem = m * 2
    let d = (m * (b - m) * x) / ((qam + tem) * (a + tem))
    const ap = az + d * am
    const bp = bz + d * bm
    d = (-(a + m) * (qab + m) * x) / ((a + tem) * (qap + tem))
    const app = ap + d * az
    const bpp = bp + d * bz
    const aold = az
    am = ap / bpp
    bm = bp / bpp
    az = app / bpp
    bz = 1
    if (Math.abs(az - aold) < eps * Math.abs(az)) return az
  }
  return az
}

function betai(a: number, b: number, x: number): number {
  if (x < 0 || x > 1) return NaN
  if (x === 0 || x === 1) return x
  const bt =
    Math.exp(
      gammln(a + b) - gammln(a) - gammln(b) + a * Math.log(x) + b * Math.log(1 - x),
    )
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a
  return 1 - (bt * betacf(b, a, 1 - x)) / b
}

function gammln(xx: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5398415688002931e-5,
  ]
  let y = xx
  const x = xx
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) {
    y += 1
    ser += cof[j] / y
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

/** Two-tailed p-value for Student's t. */
export function studentTPvalue(t: number, df: number): number {
  if (df <= 0 || !Number.isFinite(t)) return 1
  const x = df / (df + t * t)
  return betai(df / 2, 0.5, x)
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function std(arr: number[], mu?: number): number {
  const m = mu ?? mean(arr)
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(arr.length - 1, 1)
  return Math.sqrt(v)
}

function tryInv(A: number[][]): number[][] | null {
  return inv(A)
}

function ridgeFallback(XtX: number[][], lambda = 1e-6): number[][] | null {
  const ridge = XtX.map((row, i) => row.map((v, j) => (i === j ? v + lambda : v)))
  return tryInv(ridge)
}

function fitLinearWithCols(y: number[], Xcols: number[][]): number[] | null {
  const n = y.length
  if (n === 0) return null
  const X = Array.from({ length: n }, (_, i) => Xcols.map((col) => col[i]))
  const Xt = transpose(X)
  const XtX = matMul(Xt, X)
  let XtXinv = tryInv(XtX)
  if (!XtXinv) XtXinv = ridgeFallback(XtX)
  if (!XtXinv) return null
  return matVec(XtXinv, matVec(Xt, y))
}

function predictWithBeta(beta: number[], Xcols: number[][]): number[] {
  const n = Xcols[0]?.length ?? 0
  const X = Array.from({ length: n }, (_, i) => Xcols.map((col) => col[i]))
  return matVec(X, beta)
}

function computeValidation(dataset: AlignedDataset, factorIds: string[]) {
  const n = dataset.y.length
  const minTest = Math.max(5, Math.floor(n * 0.2))
  const testN = Math.min(Math.max(5, minTest), n - 5)
  if (n < 12 || testN <= 0) return null
  const trainN = n - testN
  const yTrain = dataset.y.slice(0, trainN)
  const yTest = dataset.y.slice(trainN)
  const trainCols = [Array(trainN).fill(1), ...factorIds.map((id) => dataset.X[id].slice(0, trainN))]
  const testCols = [Array(testN).fill(1), ...factorIds.map((id) => dataset.X[id].slice(trainN))]
  const beta = fitLinearWithCols(yTrain, trainCols)
  if (!beta) return null
  const predTest = predictWithBeta(beta, testCols)
  const yMean = yTest.reduce((a, b) => a + b, 0) / yTest.length
  const sse = yTest.reduce((s, y, i) => s + (y - predTest[i]) ** 2, 0)
  const sst = yTest.reduce((s, y) => s + (y - yMean) ** 2, 0)
  const r2Test = sst > 0 ? 1 - sse / sst : 0
  const rmseTest = Math.sqrt(sse / yTest.length)
  const mapeTest =
    (100 / yTest.length) *
    yTest.reduce((s, y, i) => s + Math.abs((y - predTest[i]) / Math.max(Math.abs(y), 1e-9)), 0)
  const smapeTest =
    (100 / yTest.length) *
    yTest.reduce(
      (s, y, i) => s + (2 * Math.abs(predTest[i] - y)) / Math.max(Math.abs(y) + Math.abs(predTest[i]), 1e-9),
      0,
    )
  return {
    method: 'holdout' as const,
    trainN,
    testN,
    r2Test,
    mapeTest,
    smapeTest,
    rmseTest,
  }
}

function olsFit(y: number[], Xcols: number[][]): {
  beta: number[]
  covDiag: number[]
  fitted: number[]
  residuals: number[]
  r2: number
  sse: number
  sst: number
  df: number
} | null {
  const n = y.length
  const k = Xcols.length
  const X = Array.from({ length: n }, (_, i) => Xcols.map((col) => col[i]))
  const Xt = transpose(X)
  const XtX = matMul(Xt, X)
  let XtXinv = tryInv(XtX)
  if (!XtXinv) XtXinv = ridgeFallback(XtX)
  if (!XtXinv) return null

  const Xty = matVec(Xt, y)
  const beta = matVec(XtXinv, Xty)
  const fitted = matVec(X, beta)
  const residuals = y.map((yi, i) => yi - fitted[i])
  const sse = residuals.reduce((s, e) => s + e * e, 0)
  const yMean = mean(y)
  const sst = y.reduce((s, yi) => s + (yi - yMean) ** 2, 0)
  const df = n - k
  const sigma2 = df > 0 ? sse / df : sse
  const covDiag = XtXinv.map((row, i) => row[i] * sigma2)
  const r2 = sst === 0 ? 0 : 1 - sse / sst

  return { beta, covDiag, fitted, residuals, r2, sse, sst, df }
}

function computeVif(XcolsNoIntercept: number[][]): number[] {
  return XcolsNoIntercept.map((_, j) => {
    const y = XcolsNoIntercept[j]
    const others = XcolsNoIntercept.filter((_, i) => i !== j)
    if (others.length === 0) return 1
    const cols = [Array(y.length).fill(1), ...others]
    const fit = olsFit(y, cols)
    if (!fit || fit.r2 >= 1) return Infinity
    return 1 / (1 - fit.r2)
  })
}

/** Heuristic tips for common collinear sets. */
function suggestCollinearityFixes(highIds: string[]): string[] {
  const set = new Set(highIds)
  const tips: string[] = []
  const dow = ['dow_mon', 'dow_tue', 'dow_wed', 'dow_thu', 'dow_fri', 'dow_sat']
  const dowHit = dow.filter((id) => set.has(id))
  if (dowHit.length >= 2 || (dowHit.length >= 1 && set.has('is_weekend'))) {
    tips.push(
      'Оставьте либо «Выходной», либо отдельные дни недели — не все сразу.',
    )
  }
  if (set.has('key_rate') && set.has('cpi_yoy')) {
    tips.push('Выключите один из пары «Ключевая ставка» / «Инфляция ИПЦ» — они часто движутся вместе.')
  }
  const fx = ['usd_rub', 'eur_rub', 'cny_rub'].filter((id) => set.has(id))
  if (fx.length >= 2) {
    tips.push(
      'Не держите все валюты сразу: оставьте одну из «USD/RUB», «EUR/RUB» или «CNY/RUB» под ваш импортный контур.',
    )
  }
  if (set.has('usd_rub') && set.has('brent')) {
    tips.push('Попробуйте оставить только «Курс USD/RUB» или только «Нефть Brent», если оба с высоким VIF.')
  }
  if (set.has('month_sin') || set.has('month_cos')) {
    tips.push(
      'Сезонность sin и cos — это пара: их лучше оставлять вместе. Если VIF высокий из‑за короткого периода, выключите оба.',
    )
  }
  return tips
}

export function runOls(dataset: AlignedDataset): OlsResult {
  const warnings: string[] = []
  const factorIds = Object.keys(dataset.X)
  const n = dataset.y.length
  const k = factorIds.length

  if (n < 10) {
    warnings.push('Малая выборка (n < 10): оценки коэффициентов и p-value могут быть нестабильны.')
  }
  if (n < k * 5) {
    warnings.push('На фактор приходится мало наблюдений — высок риск переобучения.')
  }
  const validation = computeValidation(dataset, factorIds)
  if (validation) {
    warnings.push(
      `Проверка на отложенной выборке (${validation.trainN}/${validation.testN}): R²=${validation.r2Test.toFixed(2)}, sMAPE=${validation.smapeTest.toFixed(1)}%.`,
    )
  }

  const interceptCol = Array(n).fill(1)
  const Xcols = [interceptCol, ...factorIds.map((id) => dataset.X[id])]
  const fit = olsFit(dataset.y, Xcols)
  if (!fit) {
    throw new Error('Не удалось оценить модель (вырожденная матрица факторов). Отключите коррелирующие факторы.')
  }

  const { beta, covDiag, fitted, residuals, r2, df } = fit
  const adjR2 = n > k + 1 ? 1 - ((1 - r2) * (n - 1)) / (n - k - 1) : r2

  const vifs = computeVif(factorIds.map((id) => dataset.X[id]))
  const highVif = factorIds
    .map((id, i) => ({
      id,
      label: dataset.labels[id] ?? id,
      vif: vifs[i],
    }))
    .filter((f) => f.vif > 10)
    .sort((a, b) => b.vif - a.vif)

  if (highVif.length > 0) {
    const suggestions = suggestCollinearityFixes(highVif.map((f) => f.id))
    warnings.push(
      'Мультиколлинеарность — когда несколько факторов почти дублируют друг друга (например, курс и нефть на одном периоде, или все дни недели вместе с «Выходной»). Тогда модель не понимает, кому приписать эффект: цифры β «плывут», p-value завышаются, и выводы про влияние становятся ненадёжными.',
    )
    warnings.push(
      `Высокий VIF (>10): ${highVif.map((f) => `«${f.label}» = ${f.vif.toFixed(1)}`).join('; ')}.`,
    )
    if (suggestions.length > 0) {
      warnings.push(`Что сделать: ${suggestions.join(' ')}`)
    } else {
      const drop = highVif
        .slice(0, Math.min(2, highVif.length))
        .map((f) => `«${f.label}»`)
        .join(' и ')
      warnings.push(
        `Что сделать: по очереди выключите факторы с самым высоким VIF (начните с ${drop}) и пересчитайте модель, пока предупреждение не исчезнет.`,
      )
    }
  }

  const yStd = std(dataset.y)
  const absEffects: number[] = []
  const coefficients: CoefficientRow[] = factorIds.map((id, i) => {
    const b = beta[i + 1]
    const se = Math.sqrt(Math.max(covDiag[i + 1], 0))
    const t = se > 0 ? b / se : 0
    const p = studentTPvalue(t, df)
    const xStd = std(dataset.X[id])
    const standardizedBeta = yStd > 0 && xStd > 0 ? b * (xStd / yStd) : 0
    const effect = Math.abs(b * xStd)
    absEffects.push(effect)
    return {
      id,
      label: dataset.labels[id] ?? id,
      beta: b,
      se,
      t,
      p,
      standardizedBeta,
      contributionShare: 0,
      vif: vifs[i],
      significant05: p < 0.05,
      significant01: p < 0.01,
    }
  })

  const effectSum = absEffects.reduce((a, b) => a + b, 0) || 1
  coefficients.forEach((c, i) => {
    c.contributionShare = absEffects[i] / effectSum
  })

  const means = Object.fromEntries(factorIds.map((id) => [id, mean(dataset.X[id])]))
  const baselineLevel =
    beta[0] + factorIds.reduce((s, id, i) => s + beta[i + 1] * means[id], 0)
  const baseline = Array(n).fill(baselineLevel)
  const contributions: Record<string, number[]> = {}
  for (let i = 0; i < factorIds.length; i++) {
    const id = factorIds[i]
    const b = beta[i + 1]
    contributions[id] = dataset.X[id].map((x) => b * (x - means[id]))
  }

  const interceptSe = Math.sqrt(Math.max(covDiag[0], 0))
  const interceptT = interceptSe > 0 ? beta[0] / interceptSe : 0

  return {
    n,
    k,
    r2,
    adjR2,
    intercept: beta[0],
    interceptSe,
    interceptT,
    interceptP: studentTPvalue(interceptT, df),
    coefficients,
    fitted,
    residuals,
    contributions,
    baseline,
    warnings,
    validation: validation ?? undefined,
  }
}

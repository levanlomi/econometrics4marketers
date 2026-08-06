/**
 * Verify our browser OLS against classic Wooldridge datasets closest to advertising:
 * - vote1: campaign expenditures (political ads) → vote share
 * - charity: mailings frequency (marketing) → gift size
 *
 * Usage:
 *   python3 scripts/export_wooldridge_examples.py   # needs: pip install wooldridge
 *   npx tsx scripts/verify_wooldridge.ts
 *   python3 scripts/compare_wooldridge_statsmodels.py  # needs: pip install statsmodels
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { runOls } from '../src/lib/ols.ts'
import type { AlignedDataset } from '../src/lib/types.ts'

const cases = ['vote1_share', 'vote1_expend', 'charity_mailings'] as const

if (!existsSync('./data/examples/vote1_share.json')) {
  console.error('Missing data/examples/*.json — run: python3 scripts/export_wooldridge_examples.py')
  process.exit(1)
}

const report = []
for (const name of cases) {
  const raw = JSON.parse(readFileSync(`./data/examples/${name}.json`, 'utf8'))
  const X: Record<string, number[]> = {}
  const labels: Record<string, string> = {}
  for (const [id, meta] of Object.entries(raw.X) as [string, { label: string; values: number[] }][]) {
    X[id] = meta.values
    labels[id] = meta.label
  }
  const ds: AlignedDataset = {
    dates: raw.y.map((_: number, i: number) => String(i)),
    y: raw.y,
    X,
    labels,
  }
  const r = runOls(ds)
  report.push({
    name,
    title: raw.title,
    source: raw.source,
    n: r.n,
    r2: r.r2,
    adjR2: r.adjR2,
    intercept: r.intercept,
    coefficients: r.coefficients.map((c) => ({
      id: c.id,
      label: c.label,
      beta: c.beta,
      se: c.se,
      t: c.t,
      p: c.p,
      vif: c.vif,
      significant05: c.significant05,
      contributionShare: c.contributionShare,
    })),
    warnings: r.warnings,
  })
  console.log(`\n${raw.title}`)
  console.log(`n=${r.n} R²=${(r.r2 * 100).toFixed(2)}% adjR²=${(r.adjR2 * 100).toFixed(2)}%`)
  for (const c of r.coefficients) {
    console.log(
      `  ${c.label}: β=${c.beta.toFixed(4)} p=${c.p.toFixed(4)} ${c.significant05 ? 'значим' : 'нет'}`,
    )
  }
}

writeFileSync('./data/examples/our_ols_report.json', JSON.stringify(report, null, 2))
console.log('\nWrote data/examples/our_ols_report.json')

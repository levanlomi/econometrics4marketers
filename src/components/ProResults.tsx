import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import type { AlignedDataset, OlsResult } from '../lib/types'
import { buildDecomposition } from '../lib/decomposition'
import { highVifFactorIds } from '../lib/liteSummary'
import { ContributionChart } from './ContributionChart'
import { DecompositionChart } from './DecompositionChart'
import { ResultsTable } from './ResultsTable'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

interface Props {
  result: OlsResult
  dataset: AlignedDataset
  incrementalIds: Set<string>
  onDropHighVif: (ids: string[]) => void
}

function ResidualsChart({ result, dataset }: { result: OlsResult; dataset: AlignedDataset }) {
  const data: ChartData<'line'> = {
    labels: dataset.dates,
    datasets: [
      {
        label: 'Остатки (факт − модель)',
        data: result.residuals,
        borderColor: '#8a5a00',
        backgroundColor: '#8a5a00',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.1,
      },
    ],
  }

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label(ctx) {
            const v = ctx.parsed.y
            if (v === null || v === undefined) return ''
            return `Остаток: ${v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { maxTicksLimit: 12, font: { size: 10 } },
        grid: { display: false },
      },
      y: {
        title: { display: true, text: 'Остаток' },
        grid: { color: 'rgba(28,36,32,0.08)' },
      },
    },
  }

  return (
    <div className="chart-wrap chart-wrap-sm">
      <Line data={data} options={options} />
    </div>
  )
}

export function ProResults({ result, dataset, incrementalIds, onDropHighVif }: Props) {
  const highVifIds = highVifFactorIds(result)
  const highVifCount = result.coefficients.filter((c) => c.vif > 10).length
  const df = result.n - result.k - 1
  const tCrit = df > 30 ? 1.96 : df > 10 ? 2.2 : 2.5
  const decomp = useMemo(
    () => buildDecomposition(dataset, result, incrementalIds),
    [dataset, result, incrementalIds],
  )
  const holdout = result.validation

  return (
    <div className="pro-results">
      <div className="pro-diagnostics">
        <div className="metric">
          <div className="label">n</div>
          <div className="value">{result.n}</div>
          <div className="note">Число наблюдений</div>
        </div>
        <div className="metric">
          <div className="label">k</div>
          <div className="value">{result.k}</div>
          <div className="note">Число факторов</div>
        </div>
        <div className="metric">
          <div className="label">Adj. R²</div>
          <div className="value">{(result.adjR2 * 100).toFixed(1)}%</div>
          <div className="note">С поправкой на k</div>
        </div>
        <div className="metric">
          <div className="label">OOS R²</div>
          <div className="value">
            {holdout ? `${(holdout.r2Test * 100).toFixed(1)}%` : '—'}
          </div>
          <div className="note">
            {holdout ? `holdout ${holdout.trainN}/${holdout.testN}` : 'недостаточно данных'}
          </div>
        </div>
        <div className="metric">
          <div className="label">VIF &gt; 10</div>
          <div className="value">{highVifCount}</div>
          <div className="note">Факторов с мультиколлинеарностью</div>
        </div>
      </div>

      {highVifIds.length > 0 ? (
        <div className="actions" style={{ marginTop: 0, marginBottom: '1rem' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onDropHighVif(highVifIds)}
          >
            {highVifIds.length === 1
              ? 'Убрать менее подходящий фактор (высокий VIF)'
              : `Убрать менее подходящие факторы (высокий VIF) (${highVifIds.length})`}
          </button>
          <span className="hint" style={{ margin: 0 }}>
            Из каждой похожей связки оставим более полезный фактор, снимем галочки и предложим пересчитать.
          </span>
        </div>
      ) : null}

      <ResultsTable result={result} tCrit={tCrit} showCi />

      <h3 className="lite-section-title">База и инкремент</h3>
      <DecompositionChart decomp={decomp} variant="pro" />

      <h3 className="lite-section-title">Разбор влияния факторов</h3>
      <ContributionChart dataset={dataset} result={result} />

      <h3 className="lite-section-title">Остатки модели</h3>
      <p className="hint">
        Если остатки систематически «гуляют» волной, в модели не хватает фактора или лага.
        Случайный шум вокруг нуля — хороший знак.
      </p>
      <ResidualsChart result={result} dataset={dataset} />
    </div>
  )
}

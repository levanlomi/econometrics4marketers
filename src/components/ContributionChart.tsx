import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import type { AlignedDataset, OlsResult } from '../lib/types'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

const PALETTE = [
  '#16845f', '#4f7cac', '#f59e72', '#9b7ede', '#4db6ac',
  '#e4b857', '#e06c75', '#62a96b', '#5e91d3', '#d07aa8',
  '#ed8f5a', '#6aa88f', '#b07b62', '#70869c', '#aa78a0',
]

interface Props {
  dataset: AlignedDataset
  result: OlsResult
  /** lite = plain language, no formulas; pro = technical caption */
  variant?: 'lite' | 'pro'
}

export function ContributionChart({ dataset, result, variant = 'pro' }: Props) {
  const isLite = variant === 'lite'
  const factorIds = [...result.coefficients]
    .sort((a, b) => b.contributionShare - a.contributionShare)
    .map((c) => c.id)

  // Theme-aware line colors via CSS variables fallback
  const ink =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#1c2420'
      : '#1c2420'
  const brand =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#0f6b4c'
      : '#0f6b4c'
  const muted =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#5c6b63'
      : '#5c6b63'
  const grid =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim() ||
        'rgba(28,36,32,0.08)'
      : 'rgba(28,36,32,0.08)'

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          usePointStyle: true,
          pointStyle: 'circle',
          boxWidth: 7,
          boxHeight: 7,
          padding: 16,
          color: muted,
          font: { size: 11, weight: 600 },
        },
      },
      tooltip: {
        callbacks: {
          label(ctx) {
            const v = ctx.parsed.y
            if (v === null || v === undefined) return ctx.dataset.label ?? ''
            return `${ctx.dataset.label}: ${v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          maxTicksLimit: 8,
          color: muted,
          font: { size: 10 },
          callback(_value, index) {
            const iso = dataset.dates[index] ?? ''
            const [year, month] = iso.split('-')
            return month && year ? `${month}.${year.slice(2)}` : iso
          },
        },
        grid: { display: false },
        border: { display: false },
      },
      y: {
        stacked: true,
        position: 'left',
        title: {
          display: true,
          text: isLite ? 'Вклад факторов' : 'Вклад факторов (отклонение от среднего)',
        },
        ticks: { color: muted, padding: 8 },
        grid: { color: grid },
        border: { display: false },
      },
      y1: {
        stacked: false,
        position: 'right',
        title: { display: true, text: isLite ? 'Факт и модель' : 'Факт / модель' },
        grid: { drawOnChartArea: false },
        ticks: { color: muted, padding: 8 },
        border: { display: false },
      },
    },
  }

  const data: ChartData<'line'> = {
    labels: dataset.dates,
    datasets: [
      ...factorIds.map((id, i) => ({
        label: dataset.labels[id] ?? id,
        data: result.contributions[id],
        borderWidth: 0,
        pointRadius: 0,
        backgroundColor: PALETTE[i % PALETTE.length] + 'bb',
        fill: true,
        stack: 'contrib',
        yAxisID: 'y',
        order: 5,
        // Lite starts with the strongest factors; the rest stay available in the legend.
        hidden: isLite && i >= 6,
      })),
      {
        label: isLite ? 'Факт' : 'Факт (Y)',
        data: dataset.y,
        borderColor: ink,
        backgroundColor: ink,
        borderWidth: 2.5,
        pointRadius: 0,
        fill: false,
        tension: 0.15,
        yAxisID: 'y1',
        order: 1,
        hidden: false,
      },
      {
        label: isLite ? 'Модель' : 'Модель (Ŷ)',
        data: result.fitted,
        borderColor: brand,
        backgroundColor: brand,
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false,
        tension: 0.15,
        yAxisID: 'y1',
        order: 0,
        hidden: false,
      },
    ],
  }

  return (
    <div>
      {isLite ? (
        <div className="chart-guide compact">
          <div className="chart-guide-item guide-factors">
            <span className="chart-guide-swatch" />
            <span><strong>Цвет</strong> — вклад главных факторов</span>
          </div>
          <div className="chart-guide-item guide-fact">
            <span className="chart-guide-swatch" />
            <span><strong>Сплошная линия</strong> — факт</span>
          </div>
          <div className="chart-guide-item guide-model">
            <span className="chart-guide-swatch" />
            <span><strong>Пунктир</strong> — модель</span>
          </div>
        </div>
      ) : (
        <p className="hint">
          Стек показывает вклад каждого фактора как отклонение от среднего уровня
          (βₖ · (Xₖ − mean)). Линии — фактический показатель и прогноз модели.
        </p>
      )}
      <div className="chart-surface">
        <div className="chart-wrap">
          <Line data={data} options={options} />
        </div>
        {isLite ? (
          <p className="chart-caption">
            Показаны 6 самых заметных факторов. Остальные можно включить в легенде.
          </p>
        ) : null}
      </div>
    </div>
  )
}

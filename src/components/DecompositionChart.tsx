import { useMemo, useState, type CSSProperties } from 'react'
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
  type TooltipItem,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import type { DecompositionResult } from '../lib/decomposition'
import { HelpHeader } from './HelpTip'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
)

const INC_PALETTE = [
  '#4f7cac', '#f59e72', '#9b7ede', '#4db6ac', '#e4b857',
  '#e06c75', '#62a96b', '#5e91d3', '#d07aa8', '#ed8f5a',
]

const BASE_COLOR = 'rgba(142, 161, 180, 0.72)'

type ChartRange = '1M' | '3M' | '6M' | '1Y' | 'all'

interface Props {
  decomp: DecompositionResult
  variant?: 'lite' | 'pro'
  /** Relative influence weights (e.g. OLS contributionShare) by factor id — Lite only */
  influenceById?: Record<string, number>
}

function fmt(n: number, digits = 1): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: digits })
}

function fmtPct(n: number): string {
  return `${(n * 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 })}%`
}

/** Map relative influence to 1…10, where max in the set → 10 and the weakest → at least 1. */
function toInfluenceScore(weight: number, maxWeight: number): number {
  if (maxWeight <= 0) return 1
  return Math.max(1, Math.min(10, Math.round((weight / maxWeight) * 10)))
}

function monthsForRange(range: ChartRange): number | null {
  if (range === '1M') return 1
  if (range === '3M') return 3
  if (range === '6M') return 6
  if (range === '1Y') return 12
  return null
}

function sliceStartIndex(dates: string[], range: ChartRange): number {
  const months = monthsForRange(range)
  if (months == null || dates.length === 0) return 0
  const last = dates[dates.length - 1]
  const end = new Date(`${last}T12:00:00`)
  if (Number.isNaN(end.getTime())) return 0
  const cut = new Date(end)
  cut.setMonth(cut.getMonth() - months)
  const y = cut.getFullYear()
  const m = String(cut.getMonth() + 1).padStart(2, '0')
  const d = String(cut.getDate()).padStart(2, '0')
  const cutIso = `${y}-${m}-${d}`
  const idx = dates.findIndex((iso) => iso >= cutIso)
  return idx < 0 ? 0 : idx
}

function sliceArr<T>(arr: T[], start: number): T[] {
  return arr.slice(start)
}

export function DecompositionChart({
  decomp,
  variant = 'lite',
  influenceById = {},
}: Props) {
  const isLite = variant === 'lite'
  const incIds = Object.keys(decomp.incremental)
  const [incOpen, setIncOpen] = useState(false)
  const [range, setRange] = useState<ChartRange>('all')
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set())

  function toggleSeries(key: string) {
    setHiddenSeries((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const showBaseline = !hiddenSeries.has('baseline')
  const showFact = !hiddenSeries.has('fact')
  const showModel = !hiddenSeries.has('model')
  const visibleIncIds = incIds.filter((id) => !hiddenSeries.has(id))

  const incFactorShares = useMemo(() => {
    const ids = Object.keys(decomp.incremental)
    let baseSum = 0
    let incSum = 0
    const byId: { id: string; label: string; sum: number; color: string; influence: number }[] =
      []
    for (const v of decomp.baseline) baseSum += v
    ids.forEach((id, i) => {
      const series = decomp.incremental[id] ?? []
      let sum = 0
      for (const v of series) {
        sum += v
        incSum += v
      }
      byId.push({
        id,
        label: decomp.labels[id] ?? id,
        sum,
        color: INC_PALETTE[i % INC_PALETTE.length],
        influence: influenceById[id] ?? 0,
      })
    })
    const total = baseSum + incSum
    const maxInfluence = Math.max(...byId.map((f) => f.influence), 0)
    return byId
      .map((f) => ({
        ...f,
        share: total !== 0 ? f.sum / total : 0,
        score: toInfluenceScore(f.influence, maxInfluence),
      }))
      .sort((a, b) => Math.abs(b.share) - Math.abs(a.share))
  }, [decomp, influenceById])

  const view = useMemo(() => {
    const start = isLite ? sliceStartIndex(decomp.dates, range) : 0
    return {
      dates: sliceArr(decomp.dates, start),
      baseline: sliceArr(decomp.baseline, start),
      actual: sliceArr(decomp.actual, start),
      predicted: sliceArr(decomp.predicted, start),
      incremental: Object.fromEntries(
        Object.entries(decomp.incremental).map(([id, series]) => [id, sliceArr(series, start)]),
      ),
    }
  }, [decomp, isLite, range])

  const ink =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#1c2420'
      : '#1c2420'
  const muted =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#5c6b63'
      : '#5c6b63'
  const grid =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim() ||
        'rgba(28,36,32,0.08)'
      : 'rgba(28,36,32,0.08)'

  const stackVals = [
    ...(showBaseline ? view.baseline : []),
    ...visibleIncIds.flatMap((id) => view.incremental[id] ?? []),
  ]
  const allVals = [
    ...stackVals,
    ...(showFact ? view.actual : []),
    ...(showModel ? view.predicted : []),
  ].filter((v) => Number.isFinite(v))
  const yMin = allVals.length ? Math.min(0, ...allVals) : 0
  const yMax = allVals.length ? Math.max(...allVals) * 1.05 : 1

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: !isLite,
        position: 'bottom',
        labels: {
          usePointStyle: true,
          pointStyle: 'circle',
          boxWidth: 7,
          boxHeight: 7,
          padding: 18,
          color: muted,
          font: { size: 11, weight: 600 },
        },
      },
      tooltip: {
        callbacks: {
          title(items) {
            const i = items[0]?.dataIndex ?? 0
            const iso = view.dates[i] ?? ''
            const parts = iso.split('-')
            if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`
            return iso
          },
          label(ctx: TooltipItem<'line'>) {
            const v = ctx.parsed.y
            if (v === null || v === undefined) return ''
            const i = ctx.dataIndex
            const pred = view.predicted[i] ?? 0
            const denom = Math.abs(pred) > 1e-9 ? Math.abs(pred) : 1
            const isFact = ctx.dataset.label === 'Факт'
            const share = isFact ? '' : ` (${fmtPct(v / denom)})`
            return `${ctx.dataset.label}: ${fmt(v, 1)}${share}`
          },
          footer(items) {
            const i = items[0]?.dataIndex ?? 0
            return [
              `Модель (база+инкремент): ${fmt(view.predicted[i] ?? 0, 1)}`,
              `Факт: ${fmt(view.actual[i] ?? 0, 1)}`,
            ]
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
            const iso = view.dates[index] ?? ''
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
        min: yMin,
        max: yMax,
        title: {
          display: !isLite,
          text: isLite ? 'Объём показателя' : 'База + инкремент',
        },
        ticks: { color: muted, padding: 8 },
        grid: { color: grid },
        border: { display: false },
      },
      y1: {
        stacked: false,
        display: false,
        position: 'right',
        min: yMin,
        max: yMax,
        grid: { drawOnChartArea: false },
        border: { display: false },
      },
    },
  }

  const data: ChartData<'line'> = {
    labels: view.dates,
    datasets: [
      ...(showBaseline
        ? [
            {
              label: 'База',
              data: view.baseline,
              borderWidth: 0,
              pointRadius: 0,
              backgroundColor: BASE_COLOR,
              fill: true,
              stack: 'decomp',
              yAxisID: 'y',
              order: 5,
            },
          ]
        : []),
      ...visibleIncIds.map((id) => {
        const i = incIds.indexOf(id)
        return {
          label: decomp.labels[id] ?? id,
          data: view.incremental[id],
          borderWidth: 0,
          pointRadius: 0,
          backgroundColor: INC_PALETTE[i % INC_PALETTE.length] + 'bb',
          fill: true,
          stack: 'decomp',
          yAxisID: 'y',
          order: 4,
        }
      }),
      ...(showFact
        ? [
            {
              label: 'Факт',
              data: view.actual,
              borderColor: ink,
              backgroundColor: ink,
              borderWidth: 2.5,
              pointRadius: view.dates.length > 90 ? 0 : 2,
              fill: false,
              tension: 0.15,
              yAxisID: 'y1',
              order: 0,
            },
          ]
        : []),
      ...(showModel
        ? [
            {
              label: 'Модель',
              data: view.predicted,
              borderColor: '#62a96b',
              backgroundColor: '#62a96b',
              borderWidth: 2,
              borderDash: [5, 4],
              pointRadius: 0,
              fill: false,
              tension: 0.15,
              yAxisID: 'y1',
              order: 1,
            },
          ]
        : []),
    ],
  }

  const ranges: ChartRange[] = ['1M', '3M', '6M', '1Y', 'all']

  return (
    <div className={isLite ? 'lite-decomp' : undefined}>
      {isLite ? (
        <div className="lite-decomp-top">
          <div className="decomp-stat-card decomp-stat-base">
            <span className="label">
              <HelpHeader tip="Какая часть результата объясняется «базой»: без рекламы и промо — за счёт сезона, макрофакторов, внешних рядов и прочих нерекламных факторов.">
                Доля базы
              </HelpHeader>
            </span>
            <span className="value">{fmtPct(decomp.baselineShare)}</span>
            <div className="decomp-stat-bar" aria-hidden>
              <div
                className="decomp-stat-bar-fill"
                style={{ width: `${Math.max(0, Math.min(100, decomp.baselineShare * 100))}%` }}
              />
            </div>
            <span className="sub">Результат без рекламы</span>
          </div>

          {incIds.length === 0 ? (
            <div className="decomp-stat-card decomp-stat-inc-card">
              <span className="label">Рекламных факторов нет</span>
              <span className="sub">
                Добавьте каналы с типом «Реклама / промо» — они появятся цветными слоями
              </span>
            </div>
          ) : (
            <button
              type="button"
              className={`decomp-stat-card decomp-stat-inc-card${incOpen ? ' is-open' : ''}`}
              aria-expanded={incOpen}
              onClick={() => setIncOpen((v) => !v)}
            >
              <span className="label">
                <HelpHeader tip="Какая часть результата приходится на рекламу и промо. Нажмите, чтобы увидеть долю каждого канала и силу его влияния по шкале 1–10.">
                  Доля инкремента
                </HelpHeader>
                <span className="decomp-inc-chevron" aria-hidden>
                  {incOpen ? '‹' : '›'}
                </span>
              </span>
              <span className="value">{fmtPct(decomp.incrementalShare)}</span>
              <div className="decomp-stat-bar" aria-hidden>
                <div
                  className="decomp-stat-bar-fill decomp-stat-bar-inc"
                  style={{
                    width: `${Math.max(0, Math.min(100, decomp.incrementalShare * 100))}%`,
                  }}
                />
              </div>
              <span className="sub">Результат от рекламы</span>
            </button>
          )}

          <div className="lite-decomp-legend">
            <div className="lite-decomp-legend-item">
              <span className="chart-guide-swatch guide-base-swatch" />
              <span>
                <strong>База</strong> — естественный спрос, не связанный с рекламой
              </span>
            </div>
            <div className="lite-decomp-legend-item">
              <span className="chart-guide-swatch guide-inc-swatch" />
              <span>
                <strong>Цветные слои</strong> — вклад каналов рекламы в инкремент
              </span>
            </div>
            <div className="lite-decomp-legend-item">
              <span className="chart-guide-swatch guide-fact-swatch" />
              <span>
                <strong>Линия</strong> — фактический результат (что было на самом деле)
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="decomp-summary">
          <div className="decomp-stat">
            <span className="label">
              <HelpHeader tip="Какая часть результата объясняется «базой»: без рекламы и промо.">
                Доля базы
              </HelpHeader>
            </span>
            <span className="value">{fmtPct(decomp.baselineShare)}</span>
          </div>
          {incIds.length === 0 ? (
            <div className="decomp-stat decomp-stat-wide">
              <span className="label">Рекламных факторов нет</span>
              <span className="value hint" style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                Добавьте каналы с типом «Реклама / промо»
              </span>
            </div>
          ) : (
            <button
              type="button"
              className={`decomp-stat decomp-stat-inc${incOpen ? ' is-open' : ''}`}
              aria-expanded={incOpen}
              onClick={() => setIncOpen((v) => !v)}
            >
              <span className="label">
                <HelpHeader tip="Доля рекламы и промо в результате.">
                  Доля инкремента
                </HelpHeader>
                <span className="decomp-inc-chevron" aria-hidden>
                  {incOpen ? '‹' : '›'}
                </span>
              </span>
              <span className="value">{fmtPct(decomp.incrementalShare)}</span>
            </button>
          )}
        </div>
      )}

      {incOpen && incIds.length > 0 ? (
        <div className="decomp-factor-row">
          {incFactorShares.map((f) => (
            <div
              key={f.id}
              className="decomp-factor-share"
              style={{ '--decomp-factor-color': f.color } as CSSProperties}
            >
              <span className="label" title={f.label}>
                {f.label}
              </span>
              <span className="value">{fmtPct(f.share)}</span>
              {isLite ? (
                <span
                  className="decomp-factor-strength"
                  title="Сила влияния относительно других каналов"
                >
                  сила {f.score}/10
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {!isLite ? (
        <p className="hint">
          База = intercept + β·X по неконтролируемым факторам (не ниже 0). Инкремент канала = β·X.
          Сумма слоёв ≈ прогноз; линия — фактический Y.
        </p>
      ) : null}

      {decomp.clampedBaselinePoints > 0 ? (
        <p className="hint">
          В {decomp.clampedBaselinePoints} точках сырая база ушла ниже нуля — на графике обрезана до
          0.
        </p>
      ) : null}

      <div className={isLite ? 'lite-chart-block' : undefined}>
        {isLite ? (
          <div className="lite-chart-head">
            <h4 className="lite-chart-title">Динамика показателя и вклад каналов</h4>
            <div className="lite-range-tabs" role="group" aria-label="Период графика">
              {ranges.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`lite-range-tab${range === key ? ' active' : ''}`}
                  onClick={() => setRange(key)}
                >
                  {key === 'all' ? 'Всё' : key}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {isLite ? (
          <div className="lite-channel-legend">
            <button
              type="button"
              className={`lite-channel-legend-item${showBaseline ? '' : ' is-off'}`}
              aria-pressed={showBaseline}
              onClick={() => toggleSeries('baseline')}
            >
              <span className="dot" style={{ background: BASE_COLOR }} />
              База
            </button>
            {incIds.map((id, i) => {
              const on = !hiddenSeries.has(id)
              return (
                <button
                  key={id}
                  type="button"
                  className={`lite-channel-legend-item${on ? '' : ' is-off'}`}
                  aria-pressed={on}
                  onClick={() => toggleSeries(id)}
                >
                  <span
                    className="dot"
                    style={{ background: INC_PALETTE[i % INC_PALETTE.length] }}
                  />
                  {decomp.labels[id] ?? id}
                </button>
              )
            })}
            <button
              type="button"
              className={`lite-channel-legend-item${showFact ? '' : ' is-off'}`}
              aria-pressed={showFact}
              onClick={() => toggleSeries('fact')}
            >
              <span className="dot line" style={{ background: ink }} />
              Факт
            </button>
            <button
              type="button"
              className={`lite-channel-legend-item${showModel ? '' : ' is-off'}`}
              aria-pressed={showModel}
              onClick={() => toggleSeries('model')}
            >
              <span className="dot line model" />
              Модель
            </button>
          </div>
        ) : null}

        <div className="chart-surface">
          <div className="chart-wrap chart-wrap-tall">
            <Line data={data} options={options} />
          </div>
          <p className={`chart-caption${isLite ? ' chart-caption-tip' : ''}`}>
            {isLite ? <span className="chart-tip-ico" aria-hidden>*</span> : null}
            Чем ближе линия к верхней границе цветных слоёв, тем точнее модель.
            Отрицательный слой означает вклад «в минус».
          </p>
        </div>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import type { AlignedDataset, OlsResult } from '../lib/types'
import { buildLiteSummary, highVifFactorIds } from '../lib/liteSummary'
import { buildDecomposition } from '../lib/decomposition'
import { DecompositionChart } from './DecompositionChart'
import { HelpTip } from './HelpTip'

function fmt(n: number, digits = 1): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: digits })
}

interface Props {
  result: OlsResult
  dataset: AlignedDataset
  incrementalIds: Set<string>
  onDropHighVif: (ids: string[]) => void
}

function AccuracyRing({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct))
  const r = 40
  const c = 2 * Math.PI * r
  const offset = c - (clamped / 100) * c
  return (
    <div
      className="accuracy-ring"
      aria-label={`Точность модели около ${fmt(clamped, 0)} процентов`}
    >
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle className="accuracy-ring-track" cx="50" cy="50" r={r} />
        <circle
          className="accuracy-ring-progress"
          cx="50"
          cy="50"
          r={r}
          style={{ strokeDasharray: `${c}`, strokeDashoffset: offset }}
        />
      </svg>
      <div className="accuracy-ring-center">
        <span className="accuracy-ring-value">{fmt(clamped, 0)}%</span>
        <span className="accuracy-ring-label">точность модели</span>
      </div>
    </div>
  )
}

export function LiteResults({ result, dataset, incrementalIds, onDropHighVif }: Props) {
  const summary = buildLiteSummary(result, dataset)
  const decomp = useMemo(
    () => buildDecomposition(dataset, result, incrementalIds),
    [dataset, result, incrementalIds],
  )
  const influenceById = useMemo(
    () =>
      Object.fromEntries(result.coefficients.map((c) => [c.id, c.contributionShare])),
    [result.coefficients],
  )
  const [showWeak, setShowWeak] = useState(false)
  const [showCollinearityDetails, setShowCollinearityDetails] = useState(false)
  const dropIds = highVifFactorIds(result)
  const dropLabels = dropIds.map(
    (id) => result.coefficients.find((c) => c.id === id)?.label ?? id,
  )
  const collinearityNotes = summary.collinearityNotes.filter(
    (n) => !n.toLowerCase().startsWith('что сделать'),
  )

  const trustLabel =
    summary.trust === 'green'
      ? 'Можно доверять'
      : summary.trust === 'yellow'
        ? 'Осторожно'
        : 'Пока рано верить'

  const incPct = Math.round(decomp.incrementalShare * 100)
  const accPct = Math.round(summary.accuracyPct)
  const holdout = result.validation
  const actionAdvice =
    summary.trust === 'green' && (holdout?.r2Test ?? 0) > 0.25 && decomp.incrementalShare > 0.2
      ? 'Масштабируйте рабочие каналы постепенно: +10–15% и проверьте динамику.'
      : summary.trust === 'red' || (holdout && holdout.r2Test < 0)
        ? 'Пока не перераспределяйте бюджет: сначала улучшите качество модели (период, факторы, формат данных).'
        : 'Сохраняйте текущий бюджет и тестируйте 1–2 канала отдельно небольшим экспериментом.'

  return (
    <div className="lite-results">
      <div className={`lite-model-summary trust-${summary.trust}`}>
        <AccuracyRing pct={summary.accuracyPct} />

        <div className="lite-model-trust">
          <div className={`trust-label trust-label-${summary.trust}`}>{trustLabel}</div>
          <p>{summary.trustText}</p>
          <p className="trust-footnote">Точек в расчёте: {summary.n}</p>
        </div>

        <aside className="lite-takeaways">
          <div className="lite-takeaways-title">
            Что это значит
            <HelpTip
              label="Что означают выводы"
              text="Краткий перевод метрик модели на язык маркетинга: точность, доля рекламы и фоновая база."
            />
          </div>
          <ul>
            <li>
              <span className="lite-takeaway-ico" aria-hidden>
                ◉
              </span>
              <span>Модель объясняет {accPct}% изменений показателя</span>
            </li>
            <li>
              <span className="lite-takeaway-ico" aria-hidden>
                ▤
              </span>
              <span>
                {incPct}% результата связано с маркетинговыми активностями
              </span>
            </li>
            <li>
              <span className="lite-takeaway-ico" aria-hidden>
               ◎
              </span>
              <span>Остальное — фоновые факторы и шум</span>
            </li>
            {holdout ? (
              <li>
                <span className="lite-takeaway-ico" aria-hidden>
                  ◌
                </span>
                <span>
                  На отложенном периоде: R² {fmt(holdout.r2Test, 2)}, sMAPE {fmt(holdout.smapeTest, 1)}%
                </span>
              </li>
            ) : null}
          </ul>
        </aside>
      </div>

      {summary.hasCollinearity ? (
        <div className="lite-collinear">
          <div className="lite-collinear-head">
            <div>
              <strong>Некоторые факторы повторяют друг друга</strong>
              <p>Модель может путаться, кому приписать результат.</p>
            </div>
            {collinearityNotes.length > 0 ? (
              <button
                type="button"
                className="lite-details-button"
                onClick={() => setShowCollinearityDetails((v) => !v)}
              >
                {showCollinearityDetails ? 'Скрыть детали' : 'Почему?'}
              </button>
            ) : null}
          </div>
          {showCollinearityDetails && collinearityNotes.length > 0 ? (
            <ul>
              {collinearityNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          {dropIds.length > 0 ? (
            <div className="lite-collinear-actions">
              <button
                type="button"
                className="btn"
                onClick={() => onDropHighVif(dropIds)}
              >
                {dropIds.length === 1
                  ? 'Убрать менее подходящий фактор и пересчитать'
                  : `Убрать менее подходящие факторы и пересчитать (${dropIds.length})`}
              </button>
              <p className="hint lite-collinear-drop-hint">
                Из похожих оставим более полезный. Снимем: {dropLabels.join(', ')}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <h3 className="lite-section-title">Откуда взялся результат</h3>
      <DecompositionChart
        decomp={decomp}
        variant="lite"
        influenceById={influenceById}
      />
      <div className="lite-action-card">
        <div className="lite-action-title">Рекламное действие</div>
        <p>{actionAdvice}</p>
      </div>

      {summary.notInfluencing.length > 0 ? (
        <div className="lite-weak">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowWeak((v) => !v)}
          >
            {showWeak ? 'Скрыть' : 'Показать'} факторы, которые скорее не влияют (
            {summary.notInfluencing.length})
          </button>
          {showWeak ? (
            <ul className="lite-weak-list">
              {summary.notInfluencing.map((c) => (
                <li key={c.id}>
                  <strong>{c.label}</strong>
                  <span> — заметной связи нет</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

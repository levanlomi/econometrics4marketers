import type { OlsResult } from '../lib/types'
import { COLUMN_HELP } from '../lib/helpTexts'
import { HelpHeader, HelpTip } from './HelpTip'

function pct(x: number) {
  return `${(x * 100).toFixed(1)}%`
}

function num(x: number, digits = 3) {
  if (!Number.isFinite(x)) return '—'
  return x.toLocaleString('ru-RU', { maximumFractionDigits: digits })
}

interface Props {
  result: OlsResult
  showCi?: boolean
  /** Critical t for ~95% CI (default 1.96). */
  tCrit?: number
}

export function ResultsTable({ result, showCi = false, tCrit = 1.96 }: Props) {
  return (
    <div>
      <div className="metrics">
        <div className="metric">
          <div className="label">
            <HelpHeader tip="R² показывает, какую долю колебаний вашего показателя модель смогла объяснить выбранными факторами. 80% — хорошо уложились в данные; 20% — многое осталось за кадром.">
              Точность R²
            </HelpHeader>
          </div>
          <div className="value">{pct(result.r2)}</div>
          <div className="note">Доля объяснённой дисперсии целевого показателя</div>
        </div>
        <div className="metric">
          <div className="label">
            <HelpHeader tip="Adj. R² — тот же R², но с штрафом за лишние факторы. Если добавить бесполезный фактор, adj. R² обычно падает. Смотрите на него, когда сравниваете модели с разным числом галочек.">
              Adj. R²
            </HelpHeader>
          </div>
          <div className="value">{pct(result.adjR2)}</div>
          <div className="note">С поправкой на число факторов (n = {result.n})</div>
        </div>
        <div className="metric">
          <div className="label">
            <HelpHeader tip="Сколько факторов прошли порог p&lt;0.05 — то есть связь с результатом статистически заметна. Это не означает, что фактор «точно причина», только что совпадение маловероятно.">
              Значимые факторы
            </HelpHeader>
          </div>
          <div className="value">
            {result.coefficients.filter((c) => c.significant05).length}
            <span style={{ fontSize: '1rem', color: 'var(--muted)' }}>
              {' '}
              / {result.coefficients.length}
            </span>
          </div>
          <div className="note">p &lt; 0.05 — низкая вероятность случайной связи</div>
        </div>
      </div>

      {result.warnings.length > 0 ? (
        <div className="warn-list">
          <strong>Предупреждения</strong>
          <ul>
            {result.warnings.map((w) => (
              <li key={w}>
                <span>{w}</span>
                {w.includes('Проверка на отложенной выборке') ? (
                  <span style={{ marginLeft: '0.35rem' }}>
                    <HelpTip
                      label="Что значит проверка на отложенной выборке"
                      text="Это проверка на новых данных, которые модель не видела при обучении. Сильный минус по R² или высокий sMAPE означает, что модель плохо переносится на будущее: лучше пересмотреть факторы, период или гранулярность."
                    />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <table className="results">
        <thead>
          <tr>
            <th>
              <HelpHeader tip={COLUMN_HELP.factor}>Фактор</HelpHeader>
            </th>
            <th>
              <HelpHeader tip={COLUMN_HELP.beta}>β</HelpHeader>
            </th>
            {showCi ? (
              <th>
                <HelpHeader tip="95% доверительный интервал для β: с высокой вероятностью истинный коэффициент лежит в этом диапазоне. Если интервал пересекает ноль — эффект может быть случайным.">
                  95% CI
                </HelpHeader>
              </th>
            ) : null}
            <th>
              <HelpHeader tip={COLUMN_HELP.stdBeta}>Std. β</HelpHeader>
            </th>
            <th>
              <HelpHeader tip={COLUMN_HELP.se}>SE</HelpHeader>
            </th>
            <th>
              <HelpHeader tip={COLUMN_HELP.t}>t</HelpHeader>
            </th>
            <th>
              <HelpHeader tip={COLUMN_HELP.p}>p-value</HelpHeader>
            </th>
            <th>
              <HelpHeader tip={COLUMN_HELP.sig}>Значимость</HelpHeader>
            </th>
            <th>
              <HelpHeader tip={COLUMN_HELP.share}>Вклад</HelpHeader>
            </th>
            <th>
              <HelpHeader tip={COLUMN_HELP.vif}>VIF</HelpHeader>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Константа</td>
            <td>{num(result.intercept)}</td>
            {showCi ? (
              <td>
                [{num(result.intercept - tCrit * result.interceptSe, 2)};{' '}
                {num(result.intercept + tCrit * result.interceptSe, 2)}]
              </td>
            ) : null}
            <td>—</td>
            <td>{num(result.interceptSe)}</td>
            <td>{num(result.interceptT, 2)}</td>
            <td>{num(result.interceptP, 4)}</td>
            <td className={result.interceptP < 0.05 ? 'sig-yes' : 'sig-no'}>
              {result.interceptP < 0.01 ? 'p&lt;0.01' : result.interceptP < 0.05 ? 'p&lt;0.05' : 'нет'}
            </td>
            <td>—</td>
            <td>—</td>
          </tr>
          {result.coefficients.map((c) => (
            <tr key={c.id}>
              <td>{c.label}</td>
              <td>{num(c.beta)}</td>
              {showCi ? (
                <td>
                  [{num(c.beta - tCrit * c.se, 2)}; {num(c.beta + tCrit * c.se, 2)}]
                </td>
              ) : null}
              <td>{num(c.standardizedBeta)}</td>
              <td>{num(c.se)}</td>
              <td>{num(c.t, 2)}</td>
              <td>{num(c.p, 4)}</td>
              <td className={c.significant05 ? 'sig-yes' : 'sig-no'}>
                {c.significant01 ? 'p&lt;0.01' : c.significant05 ? 'p&lt;0.05' : 'нет'}
              </td>
              <td>{pct(c.contributionShare)}</td>
              <td>{Number.isFinite(c.vif) ? num(c.vif, 1) : '∞'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="footer-note">
        Нажмите «?» у заголовков, чтобы увидеть простое объяснение метрик. Модель корреляционная:
        не доказывает причинность.
      </p>
    </div>
  )
}

import type { Granularity } from '../lib/types'

interface Props {
  from: string
  to: string
  granularity: Granularity
  minDate: string
  maxDate: string
  onChange: (next: { from: string; to: string; granularity: Granularity }) => void
}

export function PeriodPicker({ from, to, granularity, minDate, maxDate, onChange }: Props) {
  return (
    <div className="period-picker-row">
      <label className="field">
        Начало периода
        <input
          type="date"
          value={from}
          min={minDate}
          max={maxDate}
          onChange={(e) => onChange({ from: e.target.value, to, granularity })}
        />
      </label>
      <label className="field">
        Конец периода
        <input
          type="date"
          value={to}
          min={minDate}
          max={maxDate}
          onChange={(e) => onChange({ from, to: e.target.value, granularity })}
        />
      </label>
      <label
        className="field"
        title="Как агрегировать ряды перед оценкой модели"
      >
        Гранулярность
        <select
          value={granularity}
          onChange={(e) =>
            onChange({ from, to, granularity: e.target.value as Granularity })
          }
        >
          <option value="day">День</option>
          <option value="week">Неделя</option>
          <option value="month">Месяц</option>
        </select>
      </label>
    </div>
  )
}

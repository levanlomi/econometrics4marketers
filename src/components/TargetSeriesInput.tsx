interface Props {
  value: string
  onChange: (value: string) => void
  error?: string
}

export function TargetSeriesInput({ value, onChange, error }: Props) {
  return (
    <div>
      <label className="field">
        Целевой показатель (обязательно)
        <span className="sub">
          Это то, чью динамику вы разбираете: заказы, установки приложения, покупки на сайте,
          ключевые конверсии и т.п. Формат: дд.мм.гггг;значение.
        </span>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={'01.01.2024;40\n02.01.2024;43\n03.01.2024;43'}
          spellCheck={false}
        />
      </label>
      {error ? <div className="error">{error}</div> : null}
    </div>
  )
}

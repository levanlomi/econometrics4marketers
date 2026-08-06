export type UiMode = 'lite' | 'pro'

interface Props {
  mode: UiMode
  onChange: (mode: UiMode) => void
  compact?: boolean
}

export function ModeTabs({ mode, onChange, compact }: Props) {
  return (
    <div className={`mode-tabs${compact ? ' mode-tabs-compact' : ''}`} role="tablist" aria-label="Режим результатов">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'lite'}
        className={mode === 'lite' ? 'mode-tab active' : 'mode-tab'}
        onClick={() => onChange('lite')}
      >
        Lite
        {!compact ? <span className="mode-tab-sub">просто</span> : null}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'pro'}
        className={mode === 'pro' ? 'mode-tab active' : 'mode-tab'}
        onClick={() => onChange('pro')}
      >
        Pro
        {!compact ? <span className="mode-tab-sub">подробно</span> : null}
      </button>
    </div>
  )
}

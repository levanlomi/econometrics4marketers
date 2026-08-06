import { useState } from 'react'

export interface ChannelDraft {
  id: string
  name: string
  text: string
  /** incremental = реклама/промо; base = внешний фактор */
  role: 'incremental' | 'base'
}

interface Props {
  title: string
  hint: string
  channels: ChannelDraft[]
  onChange: (channels: ChannelDraft[]) => void
}

let seq = 0
function nextId() {
  seq += 1
  return `ch_${Date.now()}_${seq}`
}

function pointCount(text: string): number {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean).length
}

export function AdChannelsInput({ title, hint, channels, onChange }: Props) {
  /** Only ids in this set are expanded; imported channels stay collapsed by default. */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function addChannel() {
    const id = nextId()
    setExpandedIds((prev) => new Set(prev).add(id))
    onChange([...channels, { id, name: '', text: '', role: 'incremental' }])
  }

  function removeChannel(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    onChange(channels.filter((c) => c.id !== id))
  }

  return (
    <div className="channel-block">
      <h3 style={{ margin: '0 0 0.35rem', fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>
        {title}
      </h3>
      <p className="hint">{hint}</p>
      {channels.map((ch, index) => {
        const expanded = expandedIds.has(ch.id)
        const points = pointCount(ch.text)
        return (
          <div
            className={`channel-row${expanded ? ' is-expanded' : ' is-collapsed'}`}
            key={ch.id}
          >
            <div className="channel-row-head">
              <button
                type="button"
                className="channel-toggle"
                aria-expanded={expanded}
                aria-label={expanded ? 'Свернуть канал' : 'Развернуть канал'}
                onClick={() => toggleExpanded(ch.id)}
              >
                <span className="channel-chevron" aria-hidden>
                  {expanded ? '▾' : '▸'}
                </span>
              </button>
              <label className="field channel-name-field">
                Канал
                <input
                  type="text"
                  value={ch.name}
                  placeholder="Яндекс Директ, VK Ads…"
                  onChange={(e) => {
                    const next = [...channels]
                    next[index] = { ...ch, name: e.target.value }
                    onChange(next)
                  }}
                />
              </label>
              {!expanded ? (
                <span className="channel-summary hint">
                  {((ch.role ?? 'incremental') === 'base' ? 'внешний' : 'реклама')}
                  {' · '}
                  {points > 0 ? `${points} точек` : 'нет данных'}
                </span>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost channel-remove"
                onClick={() => removeChannel(ch.id)}
              >
                Удалить
              </button>
            </div>
            {expanded ? (
              <>
                <div className="channel-role">
                  <span className="field-label">Тип фактора</span>
                  <div className="channel-role-tabs" role="group" aria-label="Тип фактора">
                    <button
                      type="button"
                      className={`channel-role-tab${(ch.role ?? 'incremental') !== 'base' ? ' active' : ''}`}
                      onClick={() => {
                        const next = [...channels]
                        next[index] = { ...ch, role: 'incremental' }
                        onChange(next)
                      }}
                    >
                      Реклама / промо
                    </button>
                    <button
                      type="button"
                      className={`channel-role-tab${(ch.role ?? 'incremental') === 'base' ? ' active' : ''}`}
                      onClick={() => {
                        const next = [...channels]
                        next[index] = { ...ch, role: 'base' }
                        onChange(next)
                      }}
                    >
                      Внешний (в базу)
                    </button>
                  </div>
                  <p className="hint" style={{ margin: '0.35rem 0 0' }}>
                    {(ch.role ?? 'incremental') === 'base'
                      ? 'Пойдёт в «Базу» вместе с курсом, праздниками и сезонностью.'
                      : 'Пойдёт в «Инкремент» — то, что модель припишет маркетингу.'}
                  </p>
                </div>
                <label className="field channel-series-field">
                  Ряд (дд.мм.гггг;значение)
                  <textarea
                    value={ch.text}
                    onChange={(e) => {
                      const next = [...channels]
                      next[index] = { ...ch, text: e.target.value }
                      onChange(next)
                    }}
                    placeholder="01.01.2024;12000"
                    spellCheck={false}
                  />
                </label>
              </>
            ) : null}
          </div>
        )
      })}
      <button type="button" className="btn btn-ghost" onClick={addChannel}>
        + Добавить канал
      </button>
    </div>
  )
}

import type { RegressorMeta } from '../lib/types'
import { BUILTIN_FACTOR_META } from '../lib/align'
import { FACTOR_HELP } from '../lib/helpTexts'
import { HelpTip } from './HelpTip'

interface Props {
  storedMeta: RegressorMeta[]
  adLabels: Record<string, string>
  enabled: Set<string>
  onToggle: (id: string) => void
}

export function FactorToggles({ storedMeta, adLabels, enabled, onToggle }: Props) {
  const items = [
    ...storedMeta.map((m) => ({ id: m.id, label: m.label, group: 'Макро' as const })),
    ...BUILTIN_FACTOR_META.map((m) => ({
      id: m.id,
      label: m.label,
      group: 'Календарь' as const,
    })),
    ...Object.entries(adLabels).map(([id, label]) => ({
      id,
      label,
      group: 'Ваши каналы' as const,
    })),
  ]

  const groups = ['Макро', 'Календарь', 'Ваши каналы'] as const

  return (
    <div>
      {groups.map((group) => {
        const list = items.filter((i) => i.group === group)
        if (list.length === 0) return null
        return (
          <div key={group} style={{ marginBottom: '0.85rem' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>{group}</div>
            <div className="factors">
              {list.map((item) => {
                const tip = FACTOR_HELP[item.id]
                return (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={enabled.has(item.id)}
                      onChange={() => onToggle(item.id)}
                    />
                    <span className="factor-label">
                      {item.label}
                      {tip ? <HelpTip text={tip} label={`О факторе «${item.label}»`} /> : null}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

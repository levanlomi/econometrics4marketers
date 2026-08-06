import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

interface Props {
  text: string
  label?: string
}

/** Clickable “?” tip that opens a short explanation. */
export function HelpTip({ text, label = 'Подсказка' }: Props) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className="help-tip" ref={rootRef}>
      <button
        type="button"
        className="help-tip-btn"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        ?
      </button>
      {open ? (
        <span className="help-tip-pop" id={id} role="tooltip">
          {text}
        </span>
      ) : null}
    </span>
  )
}

export function HelpHeader({ children, tip }: { children: ReactNode; tip: string }) {
  return (
    <span className="help-header">
      {children}
      <HelpTip text={tip} />
    </span>
  )
}

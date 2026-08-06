import { useCallback, useMemo, useRef, useState } from 'react'
import type { ChannelDraft } from './AdChannelsInput'
import {
  cleanRowsToSeriesTexts,
  detectDateColumn,
  guessFactorIndices,
  guessTargetIndex,
  processMappedTable,
  readTabularFile,
  type ColumnMapping,
  type DuplicateStrategy,
  type RawTable,
} from '../lib/fileImport'

export interface FileImportApplyPayload {
  yText: string
  channels: ChannelDraft[]
  from: string
  to: string
  warnings: string[]
  fileName: string
  rowCount: number
}

interface Props {
  onApply: (payload: FileImportApplyPayload) => void
}

let chSeq = 0
function nextChannelId() {
  chSeq += 1
  return `file_ch_${Date.now()}_${chSeq}`
}

type WarningLevel = 'critical' | 'important' | 'info'

function warningLevel(text: string): WarningLevel {
  const t = text.toLowerCase()
  if (
    t.includes('интерпол') ||
    t.includes('дубликат') ||
    t.includes('ошиб') ||
    t.includes('не удалось') ||
    t.includes('обрезан')
  ) {
    return 'critical'
  }
  if (t.includes('пропуск') || t.includes('нул') || t.includes('поднято')) return 'important'
  return 'info'
}

export function FileDataImport({ onApply }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [table, setTable] = useState<RawTable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dateIndex, setDateIndex] = useState(0)
  const [targetIndex, setTargetIndex] = useState(0)
  const [factorIndices, setFactorIndices] = useState<number[]>([])
  const [duplicateStrategy, setDuplicateStrategy] =
    useState<DuplicateStrategy>('sum')
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([])

  const mapping: ColumnMapping | null = useMemo(() => {
    if (!table) return null
    return { dateIndex, targetIndex, factorIndices, duplicateStrategy }
  }, [table, dateIndex, targetIndex, factorIndices, duplicateStrategy])

  const preview = useMemo(() => {
    if (!table || !mapping) return null
    return processMappedTable(table, mapping)
  }, [table, mapping])

  const loadFile = useCallback(async (file: File) => {
    setBusy(true)
    setError(null)
    setPreviewWarnings([])
    try {
      const raw = await readTabularFile(file)
      const di = detectDateColumn(raw)
      if (di === null) {
        setTable(null)
        setError('Файл не содержит колонки, похожей на дату')
        return
      }
      const ti = guessTargetIndex(raw, di) ?? (di === 0 ? 1 : 0)
      const fi = guessFactorIndices(raw, di, ti)
      setTable(raw)
      setDateIndex(di)
      setTargetIndex(Math.min(ti, raw.headers.length - 1))
      setFactorIndices(fi)
      setDuplicateStrategy('sum')
    } catch (e) {
      setTable(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  function onFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    void loadFile(file)
  }

  function toggleFactor(idx: number) {
    setFactorIndices((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx].sort((a, b) => a - b),
    )
  }

  function handleApply() {
    if (!table || !mapping || !preview) return
    if (preview.error) {
      setError(preview.error)
      return
    }
    const { yText, factors } = cleanRowsToSeriesTexts(preview)
    const channels: ChannelDraft[] = factors.map((f) => ({
      id: nextChannelId(),
      name: f.name,
      text: f.text,
      role: 'incremental' as const,
    }))
    setPreviewWarnings(preview.warnings)
    onApply({
      yText,
      channels,
      from: preview.minDate,
      to: preview.maxDate,
      warnings: preview.warnings,
      fileName: table.fileName,
      rowCount: preview.rows.length,
    })
  }

  const otherColumns =
    table?.headers
      .map((h, i) => ({ h, i }))
      .filter(({ i }) => i !== dateIndex && i !== targetIndex) ?? []
  const warningsView = useMemo(() => {
    const list = (preview?.warnings ?? previewWarnings).map((text) => ({
      text,
      level: warningLevel(text),
    }))
    return {
      critical: list.filter((w) => w.level === 'critical'),
      important: list.filter((w) => w.level === 'important'),
      info: list.filter((w) => w.level === 'info'),
    }
  }, [preview?.warnings, previewWarnings])

  return (
    <div className="file-import">
      <div
        className={`file-dropzone${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          onFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls"
          hidden
          onChange={(e) => {
            onFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <strong>{busy ? 'Читаем файл…' : 'Перетащите CSV или Excel сюда'}</strong>
        <span className="hint">или нажмите, чтобы выбрать · .csv / .xlsx</span>
      </div>

      {error ? <div className="error">{error}</div> : null}

      {table ? (
        <div className="file-mapper">
          <p className="hint">
            Файл <strong>{table.fileName}</strong> · {table.rows.length} строк ·{' '}
            {table.headers.length} колонок. Укажите, что есть что — период подставится сам.
          </p>

          <div className="mapper-grid">
            <label className="field">
              Колонка даты
              <select
                value={dateIndex}
                onChange={(e) => setDateIndex(Number(e.target.value))}
              >
                {table.headers.map((h, i) => (
                  <option key={`d-${i}`} value={i}>
                    {h}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              Целевая метрика (Y)
              <select
                value={targetIndex}
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setTargetIndex(next)
                  setFactorIndices((prev) => prev.filter((i) => i !== next && i !== dateIndex))
                }}
              >
                {table.headers.map((h, i) =>
                  i === dateIndex ? null : (
                    <option key={`t-${i}`} value={i}>
                      {h}
                    </option>
                  ),
                )}
              </select>
            </label>

            {(preview?.duplicateDateCount ?? 0) > 0 ? (
              <label className="field">
                Дубликаты дат
                <select
                  value={duplicateStrategy}
                  onChange={(e) =>
                    setDuplicateStrategy(e.target.value as DuplicateStrategy)
                  }
                >
                  <option value="sum">Суммировать за день</option>
                  <option value="first">Взять первую строку</option>
                </select>
              </label>
            ) : null}
          </div>

          {otherColumns.length > 0 ? (
            <div className="factor-picks">
              <div className="field-label">Факторы из файла (реклама и др.)</div>
              <p className="hint">
                Отмеченные колонки попадут в бюджеты/факторы модели. Пустые ячейки в факторах
                станут 0; пропуски в Y — интерполяция.
              </p>
              <div className="factor-checkboxes">
                {otherColumns.map(({ h, i }) => (
                  <label key={`f-${i}`} className="check">
                    <input
                      type="checkbox"
                      checked={factorIndices.includes(i)}
                      onChange={() => toggleFactor(i)}
                    />
                    <span>{h}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {preview?.error ? <div className="error">{preview.error}</div> : null}
          {preview && !preview.error ? (
            <p className="hint file-preview-ok">
              Готово к подстановке: {preview.rows.length} точек · {preview.minDate} —{' '}
              {preview.maxDate}
              {preview.duplicateDateCount > 0
                ? ` · дубликаты дат: ${preview.duplicateDateCount}`
                : ''}
            </p>
          ) : null}
          {(preview?.warnings.length || previewWarnings.length) > 0 ? (
            <div className="file-warnings">
              {warningsView.critical.length > 0 ? (
                <div className="file-warn-group critical">
                  <strong>Критично</strong>
                  <ul>
                    {warningsView.critical.map((w) => (
                      <li key={`c-${w.text}`}>{w.text}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {warningsView.important.length > 0 ? (
                <div className="file-warn-group important">
                  <strong>Важно</strong>
                  <ul>
                    {warningsView.important.map((w) => (
                      <li key={`i-${w.text}`}>{w.text}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {warningsView.info.length > 0 ? (
                <div className="file-warn-group info">
                  <strong>Инфо</strong>
                  <ul>
                    {warningsView.info.map((w) => (
                      <li key={`n-${w.text}`}>{w.text}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={!preview || Boolean(preview.error)}
              onClick={handleApply}
            >
              Подставить в форму
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setTable(null)
                setError(null)
                setPreviewWarnings([])
              }}
            >
              Сбросить файл
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

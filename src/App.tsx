import { useEffect, useMemo, useState } from 'react'
import { AdChannelsInput, type ChannelDraft } from './components/AdChannelsInput'
import {
  FileDataImport,
  type FileImportApplyPayload,
} from './components/FileDataImport'
import { FactorToggles } from './components/FactorToggles'
import { HelpTip } from './components/HelpTip'
import { LiteResults } from './components/LiteResults'
import { ModeTabs, type UiMode } from './components/ModeTabs'
import { PeriodPicker } from './components/PeriodPicker'
import { ProResults } from './components/ProResults'
import { ResultsErrorBoundary } from './components/ResultsErrorBoundary'
import { TargetSeriesInput } from './components/TargetSeriesInput'
import {
  ThemeToggle,
  applyTheme,
  persistTheme,
  resolveInitialTheme,
  type ThemeMode,
} from './components/ThemeToggle'
import { alignDataset } from './lib/align'
import { buildDemoY, clampRangeToData } from './lib/demo'
import { buildDecomposition } from './lib/decomposition'
import { runOls } from './lib/ols'
import { parseSeriesText, slugifyChannel } from './lib/parse'
import type {
  AlignedDataset,
  Granularity,
  NamedSeries,
  OlsResult,
  RegressorsPayload,
} from './lib/types'

type DataInputMode = 'paste' | 'file'
const DOW_IDS = ['dow_mon', 'dow_tue', 'dow_wed', 'dow_thu', 'dow_fri', 'dow_sat']
const CALENDAR_CORE = [
  'is_holiday',
  'is_weekend',
  'salary_days',
  'school_holiday',
  'major_sale',
  'month_sin',
  'month_cos',
]
/** FX beyond USD — full/seasonal only; easy to collinear with usd_rub. */
const EXTRA_FX = ['eur_rub', 'cny_rub']
/** Heavy macro pair — keep out of recommended together. */
const HEAVY_MACRO = ['brent', 'cpi_yoy']

type ChannelTransform = 'raw' | 'lag1' | 'adstock05' | 'log1p' | 'adstock07_log1p'

function sortPoints(points: { date: string; value: number }[]) {
  return [...points].sort((a, b) => (a.date < b.date ? -1 : 1))
}

function transformSeries(points: { date: string; value: number }[], kind: ChannelTransform) {
  const s = sortPoints(points)
  if (kind === 'raw') return s
  if (kind === 'lag1') {
    return s.map((p, i) => ({ ...p, value: i === 0 ? 0 : s[i - 1].value }))
  }
  if (kind === 'adstock05' || kind === 'adstock07_log1p') {
    const decay = kind === 'adstock05' ? 0.5 : 0.7
    let prev = 0
    return s.map((p) => {
      const base = Math.max(0, p.value) + decay * prev
      prev = base
      return { ...p, value: kind === 'adstock07_log1p' ? Math.log1p(base) : base }
    })
  }
  return s.map((p) => ({ ...p, value: Math.log1p(Math.max(0, p.value)) }))
}

function fitSimpleRegression(x: number[], y: number[]) {
  if (x.length !== y.length || x.length < 3) return null
  const mx = x.reduce((a, b) => a + b, 0) / x.length
  const my = y.reduce((a, b) => a + b, 0) / y.length
  let num = 0
  let den = 0
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my)
    den += (x[i] - mx) ** 2
  }
  if (den <= 1e-12) return null
  const beta = num / den
  const alpha = my - beta * mx
  return { alpha, beta }
}

function smape(pred: number[], y: number[]) {
  if (pred.length === 0) return Infinity
  let s = 0
  for (let i = 0; i < pred.length; i++) {
    s += (2 * Math.abs(pred[i] - y[i])) / Math.max(Math.abs(pred[i]) + Math.abs(y[i]), 1e-9)
  }
  return (100 * s) / pred.length
}

function selectBestTransform(
  channelPoints: { date: string; value: number }[],
  yPoints: { date: string; value: number }[],
  from: string,
  to: string,
): { kind: ChannelTransform; score: number } {
  const yMap = new Map(yPoints.filter((p) => p.date >= from && p.date <= to).map((p) => [p.date, p.value]))
  const kinds: ChannelTransform[] = ['raw', 'lag1', 'adstock05', 'log1p', 'adstock07_log1p']
  let best: { kind: ChannelTransform; score: number } = { kind: 'raw', score: Infinity }
  for (const kind of kinds) {
    const transformed = transformSeries(channelPoints, kind).filter((p) => yMap.has(p.date))
    if (transformed.length < 12) continue
    const x = transformed.map((p) => p.value)
    const y = transformed.map((p) => yMap.get(p.date)!)
    const split = Math.max(8, Math.floor(x.length * 0.8))
    const fit = fitSimpleRegression(x.slice(0, split), y.slice(0, split))
    if (!fit) continue
    const pred = x.slice(split).map((v) => fit.alpha + fit.beta * v)
    const score = smape(pred, y.slice(split))
    if (score < best.score) best = { kind, score }
  }
  return best.score < Infinity ? best : { kind: 'raw', score: Infinity }
}

function defaultBuiltinEnabled(metaIds: string[]): Set<string> {
  const compactMacro = metaIds.filter(
    (id) => !EXTRA_FX.includes(id) && !HEAVY_MACRO.includes(id),
  )
  return new Set([...compactMacro, ...CALENDAR_CORE])
}

export default function App() {
  const [payload, setPayload] = useState<RegressorsPayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [from, setFrom] = useState('2024-01-01')
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [yText, setYText] = useState('')
  const [yIsDemo, setYIsDemo] = useState(false)
  const [yError, setYError] = useState<string | undefined>()
  const [channels, setChannels] = useState<ChannelDraft[]>([])
  const [enabled, setEnabled] = useState<Set<string>>(new Set())
  const [dataset, setDataset] = useState<AlignedDataset | null>(null)
  const [result, setResult] = useState<OlsResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [mode, setMode] = useState<UiMode>('lite')
  const [dataInputMode, setDataInputMode] = useState<DataInputMode>('paste')
  const [importNote, setImportNote] = useState<string | null>(null)
  const [theme, setTheme] = useState<ThemeMode>(() => resolveInitialTheme())
  const [factorsOpen, setFactorsOpen] = useState(false)
  const [pruneReport, setPruneReport] = useState<string | null>(null)
  const [transformNotes, setTransformNotes] = useState<string[]>([])

  useEffect(() => {
    applyTheme(theme)
    persistTheme(theme)
  }, [theme])

  useEffect(() => {
    fetch('./data/regressors.json')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<RegressorsPayload>
      })
      .then((data) => {
        setPayload(data)
        setEnabled(defaultBuiltinEnabled(data.meta.map((m) => m.id)))
        const range = clampRangeToData(data.startDate, data.endDate)
        setFrom(range.from)
        setTo(range.to)
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [])

  useEffect(() => {
    if (!payload || !yIsDemo) return
    setYText(buildDemoY(from, to, granularity))
  }, [payload, from, to, granularity, yIsDemo])

  const adSeries: NamedSeries[] = useMemo(() => {
    const out: NamedSeries[] = []
    channels.forEach((ch, i) => {
      if (!ch.text.trim()) return
      const parsed = parseSeriesText(ch.text)
      if (parsed.error || parsed.points.length === 0) return
      const id = slugifyChannel(ch.name || `channel_${i + 1}`, 'channel', i)
      out.push({
        id,
        label: ch.name || `Канал ${i + 1}`,
        points: parsed.points,
      })
    })
    return out
  }, [channels])

  /** Factor ids that count toward Incremental (marketing), not Baseline. */
  const incrementalIds = useMemo(() => {
    const ids = new Set<string>()
    channels.forEach((ch, i) => {
      if (!ch.text.trim()) return
      if ((ch.role ?? 'incremental') !== 'incremental') return
      const parsed = parseSeriesText(ch.text)
      if (parsed.error || parsed.points.length === 0) return
      ids.add(slugifyChannel(ch.name || `channel_${i + 1}`, 'channel', i))
    })
    return ids
  }, [channels])

  const adLabels = useMemo(
    () => Object.fromEntries(adSeries.map((s) => [s.id, s.label])),
    [adSeries],
  )
  const parsedYPreview = useMemo(() => parseSeriesText(yText), [yText])
  const yReady = !parsedYPreview.error && parsedYPreview.points.length >= 5
  const channelsReady = channels.every((ch) => {
    if (!ch.text.trim()) return true
    const p = parseSeriesText(ch.text)
    return !p.error && p.points.length > 0
  })
  const factorsReady = enabled.size >= 1
  const runReady = yReady && channelsReady && factorsReady
  const nextAction = !yReady
    ? 'Добавьте минимум 5 точек целевой метрики Y.'
    : !channelsReady
      ? 'Проверьте формат рядов каналов: дд.мм.гггг;значение.'
      : !factorsReady
        ? 'Включите хотя бы один фактор модели.'
        : 'Все готово — запустите оценку модели.'

  useEffect(() => {
    if (adSeries.length === 0) return
    setEnabled((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const s of adSeries) {
        if (!next.has(s.id)) {
          next.add(s.id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [adSeries])

  function toggleFactor(id: string) {
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function applyPreset(kind: 'channels_only' | 'basic' | 'full' | 'recommended') {
    const macroIds = payload.meta.map((m) => m.id)
    const channelIds = adSeries.map((s) => s.id)
    const compactMacro = macroIds.filter(
      (id) => !EXTRA_FX.includes(id) && !HEAVY_MACRO.includes(id),
    )
    if (kind === 'channels_only') {
      // Только рекламные каналы пользователя — без макро, календаря и рядов с ролью «внешний»
      const adOnly = channels
        .map((ch, i) => {
          if (!ch.text.trim()) return null
          if ((ch.role ?? 'incremental') === 'base') return null
          return slugifyChannel(ch.name || `channel_${i + 1}`, 'channel', i)
        })
        .filter((id): id is string => id !== null)
      setEnabled(new Set(adOnly))
      return
    }
    if (kind === 'full') {
      setEnabled(new Set([...macroIds, ...DOW_IDS, ...CALENDAR_CORE, ...channelIds]))
      return
    }
    if (kind === 'recommended') {
      const byGranularity =
        granularity === 'day'
          ? [...compactMacro, ...CALENDAR_CORE, ...DOW_IDS]
          : [...compactMacro, ...CALENDAR_CORE]
      setEnabled(new Set([...byGranularity, ...channelIds]))
      return
    }
    // Базовый: макро без лишних валют и без brent+cpi, календарь, каналы
    setEnabled(new Set([...compactMacro, ...CALENDAR_CORE, ...channelIds]))
  }

  function handleRun(factorOverride?: Set<string>, afterRun?: (r: OlsResult) => void) {
    if (!payload) return
    setRunError(null)
    if (!factorOverride) setPruneReport(null)
    setResult(null)
    setDataset(null)

    const parsedY = parseSeriesText(yText)
    if (parsedY.error) {
      setYError(parsedY.error)
      return
    }
    setYError(undefined)

    for (const ch of channels) {
      if (!ch.text.trim()) continue
      const p = parseSeriesText(ch.text)
      if (p.error) {
        setRunError(`${ch.name || 'Канал'}: ${p.error}`)
        return
      }
    }

    const factors = factorOverride ?? enabled
    const transformedNotes: string[] = []
    const transformedAdSeries: NamedSeries[] = adSeries.map((s) => {
      const best = selectBestTransform(s.points, parsedY.points, from, to)
      if (best.kind === 'raw') return s
      transformedNotes.push(`${s.label}: ${best.kind} (sMAPE ${best.score.toFixed(1)}%)`)
      return {
        ...s,
        points: transformSeries(s.points, best.kind),
      }
    })
    const alignedRaw = alignDataset({
      payload,
      yPoints: parsedY.points,
      adSeries,
      granularity,
      from,
      to,
      enabledFactors: [...factors],
    })
    const alignedTransformed =
      transformedNotes.length > 0
        ? alignDataset({
            payload,
            yPoints: parsedY.points,
            adSeries: transformedAdSeries,
            granularity,
            from,
            to,
            enabledFactors: [...factors],
          })
        : null

    if (alignedRaw.error || !alignedRaw.dataset) {
      setRunError(alignedRaw.error ?? 'Не удалось подготовить данные')
      return
    }

    try {
      const rawResult = runOls(alignedRaw.dataset)
      let selectedDataset = alignedRaw.dataset
      let selectedResult = rawResult
      let selectedNotes: string[] = []

      if (alignedTransformed?.dataset && !alignedTransformed.error) {
        const transformedResult = runOls(alignedTransformed.dataset)
        const rawDecomp = buildDecomposition(alignedRaw.dataset, rawResult, incrementalIds)
        const trDecomp = buildDecomposition(
          alignedTransformed.dataset,
          transformedResult,
          incrementalIds,
        )
        const rawClampRate = rawDecomp.clampedBaselinePoints / Math.max(rawDecomp.dates.length, 1)
        const trClampRate = trDecomp.clampedBaselinePoints / Math.max(trDecomp.dates.length, 1)
        const rawScore = (rawResult.validation?.smapeTest ?? 100) + rawClampRate * 35
        const trScore = (transformedResult.validation?.smapeTest ?? 100) + trClampRate * 35
        const betterEnough = trScore + 1 < rawScore
        const safeBaseline = trClampRate < 0.8
        if (betterEnough && safeBaseline) {
          selectedDataset = alignedTransformed.dataset
          selectedResult = transformedResult
          selectedNotes = transformedNotes
        } else if (transformedNotes.length > 0) {
          selectedNotes = [
            'Автотрансформации проверены, но отключены: не улучшили holdout или ухудшили базу.',
          ]
        }
      }

      setTransformNotes(selectedNotes)
      setDataset(selectedDataset)
      setResult(selectedResult)
      afterRun?.(selectedResult)
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e))
    }
  }

  function handleDropHighVif(ids: string[]) {
    const dropped = ids.map((id) => result?.coefficients.find((c) => c.id === id)?.label ?? id)
    const beforeHigh = result?.coefficients.filter((c) => c.vif > 10).length ?? 0
    const why = ids
      .map((id) => {
        const c = result?.coefficients.find((row) => row.id === id)
        return c ? `«${c.label}» (VIF ${c.vif.toFixed(1)})` : `«${id}»`
      })
      .join(', ')
    setPruneReport(`Перед пересчётом снято: ${why}.`)
    setEnabled((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      queueMicrotask(() =>
        handleRun(next, (nextResult) => {
          const afterHigh = nextResult.coefficients.filter((c) => c.vif > 10).length
          setPruneReport(
            `Сняты факторы: ${dropped.join(', ')}. VIF>10: было ${beforeHigh}, стало ${afterHigh}.`,
          )
        }),
      )
      return next
    })
  }

  function handleFileApply(imported: FileImportApplyPayload) {
    let fromNext = imported.from
    let toNext = imported.to
    const notes = [...imported.warnings]

    if (payload) {
      if (fromNext < payload.startDate) {
        notes.push(
          `Начало периода поднято до ${payload.startDate} (раньше нет предустановленных факторов).`,
        )
        fromNext = payload.startDate
      }
      if (toNext > payload.endDate) {
        notes.push(
          `Конец периода обрезан до ${payload.endDate} (позже нет предустановленных факторов).`,
        )
        toNext = payload.endDate
      }
      if (toNext < fromNext) {
        fromNext = payload.startDate
        toNext = payload.endDate
      }
    }

    setYText(imported.yText)
    setYIsDemo(false)
    setYError(undefined)
    setChannels(imported.channels)
    setFrom(fromNext)
    setTo(toNext)
    setImportNote(
      `Загружено из «${imported.fileName}»: ${imported.rowCount} точек · период ${fromNext} — ${toNext}` +
        (notes.length ? `. ${notes.join(' ')}` : ''),
    )
    setDataInputMode('paste')
  }

  if (loadError) {
    return (
      <div className="app">
        <div className="error">Не удалось загрузить регрессоры: {loadError}</div>
      </div>
    )
  }

  if (!payload) {
    return (
      <div className="app">
        <p className="hint">Загрузка предустановленных факторов…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-top">
          <h1>Эконометрика для маркетолога</h1>
          <ThemeToggle
            theme={theme}
            onToggle={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          />
        </div>
        <p>
          Бесплатная онлайн-модель влияния факторов на ваш целевой показатель.
          Вставьте заказы, установки или конверсии — и оцените, как курс, нефть,
          праздники и ваши рекламные каналы связаны с результатом.
        </p>
      </header>

      <section className="panel">
        <h2>Период и гранулярность</h2>
        <p className="hint data-meta">
          Предустановленные факторы: {payload.startDate} — {payload.endDate}, обновлено{' '}
          {new Date(payload.updatedAt).toLocaleDateString('ru-RU')}
        </p>
        <PeriodPicker
          from={from}
          to={to}
          granularity={granularity}
          minDate={payload.startDate}
          maxDate={payload.endDate}
          onChange={(next) => {
            setFrom(next.from)
            setTo(next.to)
            setGranularity(next.granularity)
          }}
        />
      </section>

      <section className="panel">
        <h2>Ваши данные</h2>
        <p className="hint">
          Можно вставить ряды вручную или загрузить CSV/Excel. Нужны даты — так
          подтягиваются курс, нефть, праздники и сезонность.
        </p>

        <div className="mode-tabs mode-tabs-compact data-source-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={dataInputMode === 'paste'}
            className={`mode-tab${dataInputMode === 'paste' ? ' active' : ''}`}
            onClick={() => setDataInputMode('paste')}
          >
            Вставить текст
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={dataInputMode === 'file'}
            className={`mode-tab${dataInputMode === 'file' ? ' active' : ''}`}
            onClick={() => setDataInputMode('file')}
          >
            Загрузить файл
          </button>
        </div>

        {importNote ? (
          <div className="import-note">
            {importNote}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setImportNote(null)}
            >
              Скрыть
            </button>
          </div>
        ) : null}

        {dataInputMode === 'file' ? (
          <FileDataImport onApply={handleFileApply} />
        ) : (
          <>
            <TargetSeriesInput
              value={yText}
              onChange={(v) => {
                setYText(v)
                setYIsDemo(false)
                setImportNote(null)
              }}
              error={yError}
            />
            <AdChannelsInput
              title="Бюджеты / показы рекламных каналов (опционально)"
              hint="Добавьте ряды расходов или показов по каналам. По умолчанию они идут в «Инкремент»; можно переключить в «Внешний» — тогда фактор попадёт в Базу вместе с курсом и календарём."
              channels={channels}
              onChange={setChannels}
            />
          </>
        )}
      </section>

      <section className="panel">
        <button
          type="button"
          className="panel-fold"
          aria-expanded={factorsOpen}
          onClick={() => setFactorsOpen((v) => !v)}
        >
          <span className="panel-fold-chevron" aria-hidden>
            {factorsOpen ? '▾' : '▸'}
          </span>
          <span className="panel-fold-text">
            <span className="panel-fold-title-row">
              <span className="panel-fold-title">Факторы модели</span>
              <HelpTip
                label="О разделе «Факторы модели»"
                text="По умолчанию включены макропоказатели и календарные эффекты. Нажмите «?» у конкретного фактора, чтобы понять, когда его стоит включать."
              />
            </span>
            <span className="panel-fold-sub">
              {factorsOpen
                ? 'Скрыть список факторов'
                : `Показать список (${enabled.size} вкл.)`}
            </span>
          </span>
        </button>
        {factorsOpen ? (
          <>
            <div className="factor-presets">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => applyPreset('channels_only')}
              >
                Без внешних факторов
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => applyPreset('basic')}>
                Базовый старт
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => applyPreset('full')}>
                Полный набор
              </button>
              <button type="button" className="btn" onClick={() => applyPreset('recommended')}>
                Рекомендуемый набор
              </button>
            </div>
            <FactorToggles
              storedMeta={payload.meta}
              adLabels={adLabels}
              enabled={enabled}
              onToggle={toggleFactor}
            />
          </>
        ) : null}
        <div className="run-checklist">
          <div className="run-checklist-title">Проверка перед запуском</div>
          <ul>
            <li className={yReady ? 'ok' : 'warn'}>
              {yReady ? '✓' : '•'} Целевая метрика Y: {yReady ? 'готово' : 'нужно 5+ точек'}
            </li>
            <li className={channelsReady ? 'ok' : 'warn'}>
              {channelsReady ? '✓' : '•'} Каналы: {channelsReady ? 'формат корректный' : 'есть ошибки формата'}
            </li>
            <li className={factorsReady ? 'ok' : 'warn'}>
              {factorsReady ? '✓' : '•'} Факторы: {enabled.size} включено
            </li>
          </ul>
          <p className="hint">{nextAction}</p>
          {transformNotes.length > 0 ? (
            <div className="hint auto-transform-note">
              Автоподбор трансформаций каналов: {transformNotes.join(' · ')}
            </div>
          ) : null}
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => handleRun()} disabled={!runReady}>
            Оценить модель
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setYText(buildDemoY(from, to, granularity))
              setYIsDemo(true)
            }}
          >
            Подставить демо-ряд Y
          </button>
        </div>
        {runError ? <div className="error">{runError}</div> : null}
      </section>

      {result && dataset ? (
        <section className="panel">
          <div className="results-header">
            <h2 className="results-title">
              Результаты модели
              <HelpTip
                label="О результатах модели"
                text="Lite показывает точность, доверие к модели и разложение результата на базу и рекламу. Pro — подробные коэффициенты и диагностика."
              />
            </h2>
            <ModeTabs mode={mode} onChange={setMode} />
          </div>
          {pruneReport ? <p className="hint prune-report">{pruneReport}</p> : null}
          <ResultsErrorBoundary>
            {mode === 'lite' ? (
              <LiteResults
                result={result}
                dataset={dataset}
                incrementalIds={incrementalIds}
                onDropHighVif={handleDropHighVif}
              />
            ) : (
              <ProResults
                result={result}
                dataset={dataset}
                incrementalIds={incrementalIds}
                onDropHighVif={handleDropHighVif}
              />
            )}
          </ResultsErrorBoundary>
        </section>
      ) : null}

      <p className="footer-note">
        Инструмент работает полностью в браузере (GitHub Pages). Данные не отправляются на
        сервер.
        <br />
        Это OLS-регрессия для разведочного анализа, а не доказательство причинности.
      </p>
    </div>
  )
}

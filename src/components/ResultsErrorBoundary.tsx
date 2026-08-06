import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallbackTitle?: string
}

interface State {
  error: Error | null
}

/** Keeps the rest of the app visible if a results chart throws. */
export class ResultsErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Results render error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error" style={{ marginTop: '1rem' }}>
          <strong>{this.props.fallbackTitle ?? 'Не удалось показать результаты'}</strong>
          <p style={{ margin: '0.35rem 0 0' }}>{this.state.error.message}</p>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: '0.5rem' }}
            onClick={() => this.setState({ error: null })}
          >
            Попробовать снова
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

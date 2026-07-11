import { Component, type ReactNode, type ErrorInfo } from 'react';
import { I18nContext, type I18nContextValue } from '../../i18n/I18nContext';
import { logger } from '../../services/logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  static contextType = I18nContext;
  declare context: I18nContextValue;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary]', error, errorInfo);

    const isDomError =
      error.name === 'NotFoundError' ||
      error.message?.includes('removeChild') ||
      error.message?.includes('insertBefore') ||
      error.message?.includes('not a child of this node');

    if (isDomError && this.state.retryCount < 3) {
      logger.warn(`[ErrorBoundary] DOM reconciliation error detected, auto-retrying (attempt ${this.state.retryCount + 1}/3)`);
      setTimeout(() => {
        this.setState({ hasError: false, error: null, errorInfo: null, retryCount: this.state.retryCount + 1 });
      }, 100);
    }
  }

  handleManualRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, retryCount: 0 });
  };

  render() {
    if (this.state.hasError) {
      const isDomError =
        this.state.error?.name === 'NotFoundError' ||
        this.state.error?.message?.includes('removeChild') ||
        this.state.error?.message?.includes('insertBefore');

      if (isDomError && this.state.retryCount < 3) {
        return (
          <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
            <div className="text-center p-8">
              <p className="text-sm" style={{ color: 'color-mix(in srgb, var(--text-color) 60%, transparent)' }}>
                {this.context.t('errorBoundary.recovering')}
              </p>
            </div>
          </div>
        );
      }

      const mutedText = 'color-mix(in srgb, var(--text-color) 60%, transparent)';

      return (
        <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
          <div className="max-w-2xl text-center space-y-4 p-8">
            <p className="text-4xl">&#x26A0;</p>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-color)' }}>
              {this.context.t('errorBoundary.title')}
            </h1>
            <p className="text-sm" style={{ color: mutedText }}>
              {this.context.t('errorBoundary.description')}
            </p>
            {this.state.error && (
              <div className="text-left">
                <p className="text-sm font-semibold text-[var(--color-status-danger)] mb-1">{this.state.error.message}</p>
                <pre
                  className="text-[11px] p-3 rounded-lg overflow-auto max-h-48 whitespace-pre-wrap break-all"
                  style={{ backgroundColor: 'var(--color-surface-raised)', color: 'color-mix(in srgb, var(--color-status-danger) 70%, transparent)' }}
                >
                  {this.state.error.stack}
                </pre>
              </div>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleManualRetry}
                className="px-4 py-2 bg-primary text-[var(--color-text-inverse)] text-sm rounded-lg hover:bg-primary-hover transition-colors"
              >
                {this.context.t('errorBoundary.retry')}
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-[var(--text-color)] text-sm rounded-lg hover:bg-[color-mix(in_srgb,var(--text-color)_10%,transparent)] transition-colors"
                style={{ backgroundColor: 'var(--color-surface-elevated)' }}
              >
                {this.context.t('errorBoundary.reload')}
              </button>
            </div>
            {isDomError && (
              <p className="text-xs mt-4" style={{ color: 'color-mix(in srgb, var(--text-color) 40%, transparent)' }}>
                {this.context.t('errorBoundary.domErrorHint')}
              </p>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

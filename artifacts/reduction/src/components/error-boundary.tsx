import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
  /** Called once per caught error, after it is logged (main.tsx reports it). */
  onError?: (error: Error, componentStack: string) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

// Inline styles on the app's own tokens: the scaffold wrote this with
// Tailwind classes, and index.css never imports Tailwind, so they styled
// nothing. "Reload" rather than a reset, because the root boundary's
// children are the whole app and re-rendering them usually throws again.
function DefaultFallback({ error }: ErrorFallbackProps) {
  return (
    <div style={{ minHeight: "100svh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--page)", color: "var(--ink)", padding: 24 }}>
      <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Something went wrong</h1>
        <p style={{ marginTop: 8, color: "var(--muted)", fontSize: 16 }}>
          The page hit an error. Your recipes are safe; reloading usually fixes it.
        </p>
        {/* Dev only: messages can carry API responses and other internals. */}
        {import.meta.env.DEV ? (
          <pre style={{ marginTop: 16, overflowX: "auto", textAlign: "left", fontSize: 12, background: "var(--card)", padding: 12, borderRadius: 8 }}>
            {error.message || String(error)}
          </pre>
        ) : null}
        <button type="button" className="rd-btn" style={{ marginTop: 16, minHeight: 44, fontSize: 16 }} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      'ErrorBoundary caught an error:',
      toError(error),
      info.componentStack,
    );
    this.props.onError?.(toError(error), info.componentStack ?? "");
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}

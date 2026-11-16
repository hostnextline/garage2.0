/* A part of the screen that throws while drawing no longer leaves a blank (or a frozen, stale) area: the boundary shows
   « Quelque chose n'a pas marché » with « Recharger » instead, and reports the error once. Around the whole app, each
   screen (tried again on the next address: resetKey) and each floating host (silent: it simply disappears until the
   next screen). */
import { Component, type ComponentChildren } from 'preact';
import { t } from '../lib/i18n';
import { reportError } from '../platform/report';

export interface ErrorBoundaryProps {
  /** 'root', 'screen:/job/:id', 'host:hermes': where the report says it happened */
  name: string;
  /** when it changes, the children are tried again (the address, for a screen) */
  resetKey?: unknown;
  /** draw nothing instead of the message (a bubble, a banner over the screens) */
  silent?: boolean;
  /** what to show instead of the default message */
  fallback?: (p: { error: unknown; retry: () => void }) => ComponentChildren;
  children?: ComponentChildren;
}
interface State { error: unknown; failed: boolean; key: unknown }

/** the default message: plain markup and words with a fallback, so it can draw even when the kit itself is broken */
export function CrashMessage(p: { retry?: () => void }) {
  const say = (k: string, fr: string) => { try { const s = t(k); return s === k ? fr : s; } catch { return fr; } };
  return (
    <div class="page" role="alert" data-testid="crash">
      <div class="empty">
        <h3>{say('shell.crash.title', 'Quelque chose n’a pas marché')}</h3>
        <p style={{ margin: 0 }}>{say('shell.crash.text', 'Rien n’est perdu : tes changements sont gardés sur le téléphone.')}</p>
        <button type="button" class="btn btn-primary" onClick={() => { try { location.reload(); } catch { p.retry?.(); } }} data-testid="crash-reload">
          <span class="btn-txt">{say('shell.reload', 'Recharger')}</span>
        </button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null, failed: false, key: undefined };
  static getDerivedStateFromError(error: unknown): Partial<State> { return { error, failed: true }; }
  static getDerivedStateFromProps(p: ErrorBoundaryProps, s: State): Partial<State> | null {
    // another address: the screen gets a fresh try
    if (p.resetKey !== s.key) return { key: p.resetKey, failed: false, error: null };
    return null;
  }
  componentDidCatch(error: unknown) {
    reportError(error, this.props.name, 'render');
  }
  retry = () => { this.setState({ failed: false, error: null }); };
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.silent) return null;
    if (this.props.fallback) return this.props.fallback({ error: this.state.error, retry: this.retry });
    return <CrashMessage retry={this.retry} />;
  }
}

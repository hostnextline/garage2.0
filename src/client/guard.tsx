/* A screen of the customer's page that throws while drawing (an answer the page did not expect): the customer reads
   « Un problème est survenu », « Réessayer » and whom to call, never a blank page (client-page-28). */
import { Component, type ComponentChildren } from 'preact';
import { parseLink, recallGarage } from './link';
import { pickLang } from './i18n';
import { ErrorState } from './ui';

export class Guard extends Component<{ children: ComponentChildren; onRetry?: () => void }, { failed: boolean }> {
  state = { failed: false };
  componentDidCatch(e: unknown) {
    console.error('client page:', e);
    this.setState({ failed: true });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const l = pickLang(parseLink(location.hash).l, null);
    const retry = this.props.onRetry ?? (() => location.reload());
    return (
      <div class="cl">
        <main class="cl-wrap cl-main" id="main"><ErrorState code="server" l={l} garage={recallGarage()} onRetry={retry} /></main>
      </div>
    );
  }
}

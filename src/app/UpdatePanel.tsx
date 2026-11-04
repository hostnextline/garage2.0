/* « Mise à jour de l'app »: which version this phone has, « Vérifier les mises à jour », and « Mettre à jour maintenant »
   when a new version is ready. Shown in Réglages and in Mon compte (every phone updates itself). */
import { RefreshCw, ArrowUpCircle } from 'lucide-preact';
import { t, lang } from '../lib/i18n';
import { stamp } from '../lib/dates';
import { APP_VERSION, BUILT_AT } from '../lib/config';
import { Panel, Button, Banner, Kv } from '../ui';
import { updateReady, updateState, remoteVersion, checkForUpdate, applyUpdate, isImportant } from './pwa';

export function versionLabel(version = APP_VERSION, builtAt = BUILT_AT, l = lang.value): string {
  const when = builtAt ? stamp(builtAt, l) : '';
  const short = version && version !== 'dev' ? version.slice(0, 7) : t('shell.update.devVersion');
  return when ? `${when} (${short})` : short;
}

export function UpdatePanel(p: { 'data-testid'?: string; titled?: boolean } = {}) {
  const s = updateState.value;
  const ready = updateReady.value || s === 'ready';
  const rv = remoteVersion.value;
  const notes = ready && rv?.notes ? rv.notes : null;
  return (
    <Panel title={p.titled === false ? undefined : t('shell.update.title')} help={p.titled === false ? undefined : t('shell.update.help')} data-testid={p['data-testid'] || 'update-panel'}>
      <div class="stack">
        {p.titled === false && <p class="muted" style={{ margin: 0 }}>{t('shell.update.help')}</p>}
        <Kv items={[[t('shell.update.mine'), <span data-testid="update-version">{versionLabel()}</span>]]} />
        {ready ? (
          <Banner kind={isImportant(rv) ? 'warn' : 'info'} title={isImportant(rv) ? t('shell.update.important') : t('shell.update.ready')}
            action={<Button size="sm" variant="primary" icon={<ArrowUpCircle size={16} />} onClick={applyUpdate} data-testid="update-apply">{t('shell.update.apply')}</Button>}
            data-testid="update-ready">
            {notes && <span class="small">{t('shell.update.notes', { notes })}</span>}
          </Banner>
        ) : s === 'none' ? (
          <Banner kind="ok" data-testid="update-none">{t('shell.update.none')}</Banner>
        ) : s === 'offline' ? (
          <Banner kind="warn" data-testid="update-offline">{t('shell.update.offline')}</Banner>
        ) : s === 'error' ? (
          <Banner kind="warn" data-testid="update-error">{t('shell.update.error')}</Banner>
        ) : null}
        {!ready && (
          <Button icon={<RefreshCw size={18} class={s === 'checking' ? 'spin-slow' : ''} />} busy={s === 'checking'} onClick={() => void checkForUpdate()} data-testid="update-check">
            {s === 'checking' ? t('shell.update.checking') : t('shell.update.check')}
          </Button>
        )}
      </div>
    </Panel>
  );
}

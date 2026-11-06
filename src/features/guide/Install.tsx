/* « Installer l'app sur ton téléphone »: the browser's own install button when it offers one (Android, computer),
   else the two or three taps to do (iPhone: Partager, Sur l'écran d'accueil; Android: ⋮, Installer l'app). */
import { computed } from '@preact/signals';
import { installEvent, appInstalled } from '../../app/pwa';
import { Download, Share, EllipsisVertical, Copy, ExternalLink } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { appBase, movedTo } from '../../lib/config';
import { Panel, Button, Banner, toast } from '../../ui';

// the browser's offer is caught at the app's start (src/app/pwa.ts): this screen may open much later
const canPrompt = computed(() => !!installEvent.value);
const installed = appInstalled;

export function isStandalone(): boolean {
  try { return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true; } catch { return false; }
}
export function platform(ua: string = navigator.userAgent, touchMac = false): 'ios' | 'android' | 'other' {
  if (/iPhone|iPad|iPod/i.test(ua) || touchMac) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}
const isTouchMac = () => { try { return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1; } catch { return false; } };

export function InstallPanel() {
  const done = installed.value || isStandalone();
  const where = platform(navigator.userAgent, isTouchMac());
  const install = async () => {
    const e = installEvent.value;
    if (!e) return;
    await e.prompt();
    const r = await e.userChoice.catch(() => null);
    installEvent.value = null;   // an offer is used only once
    if (r?.outcome === 'accepted') installed.value = true;
  };
  const moved = movedTo();
  const url = moved || appBase();
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast(t('guide.install.copied'), { kind: 'ok' }); } catch { /* the address stays shown */ }
  };
  // on the old address, the app is installed from its new one (installing this one would keep the old address)
  if (moved) return (
    <Panel title={t('guide.install.title')} sub={t('guide.install.movedLead')} data-testid="guide-install">
      <div class="stack" style={{ gap: 'var(--sp-3)' }}>
        <div class="guide-url"><code>{url}</code><Button icon={<Copy size={18} />} onClick={copy}>{t('guide.install.copy')}</Button></div>
        <div><Button variant="primary" href={moved} target="_blank" icon={<ExternalLink size={18} />} data-testid="guide-install-open">{t('shell.moved.open')}</Button></div>
      </div>
    </Panel>
  );
  return (
    <Panel title={t('guide.install.title')} sub={done ? undefined : t('guide.install.lead')} data-testid="guide-install">
      {done ? <Banner kind="ok">{t('guide.install.installed')}</Banner> : (
        <div class="stack">
          {canPrompt.value && <div><Button variant="primary" icon={<Download size={18} />} onClick={install} data-testid="guide-install-button">{t('guide.install.button')}</Button></div>}
          <div class="guide-how">
            {where !== 'android' && (
              <div>
                <h3>{t('guide.install.iphone')}</h3>
                <ol>
                  <li>{t('guide.install.iphone1')}<Share class="guide-inline-icon" aria-hidden="true" /></li>
                  <li>{t('guide.install.iphone2')}</li>
                  <li>{t('guide.install.iphone3')}</li>
                </ol>
              </div>
            )}
            {where !== 'ios' && (
              <div>
                <h3>{t('guide.install.android')}</h3>
                <ol>
                  <li>{t('guide.install.android1')}<EllipsisVertical class="guide-inline-icon" aria-hidden="true" /></li>
                  <li>{t('guide.install.android2')}</li>
                  <li>{t('guide.install.android3')}</li>
                </ol>
              </div>
            )}
          </div>
          {where === 'other' && (
            <div class="stack" style={{ gap: 'var(--sp-2)' }}>
              <span class="muted small">{t('guide.install.computer')}</span>
              <div class="guide-url"><code>{url}</code><Button icon={<Copy size={18} />} onClick={copy}>{t('guide.install.copy')}</Button></div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

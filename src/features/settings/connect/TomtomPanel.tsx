/* TomTom (Part 27, « Vraies routes »): read only, like the other outside services' state. Two keys, never typed here: the
   SERVER key (a secret of the server's functions: the function « drive » says only whether it has one, roadsStatus) and
   the BROWSER key (maps and addresses, given when the app is built: config.ts). Branché = the server has its key. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Map as MapIcon } from 'lucide-preact';
import { t, lang } from '../../../lib/i18n';
import { TOMTOM_KEY } from '../../../lib/config';
import { roadsStatus, type RoadsStatus } from '../../../data/roads';
import { errorMessage } from '../../../data/api';
import { Panel, Pill, Button, Skeleton } from '../../../ui';
import { failWords, refusalOf } from '../booking/roadsModel';
import { Status } from './GhlPanel';

export function TomtomPanel(p: { browserKey?: string } = {}) {
  const browser = (p.browserKey ?? TOMTOM_KEY) !== '';
  const [s, setS] = useState<RoadsStatus | null>(null);
  const asked = useRef(0);
  useEffect(() => () => { asked.current = -1; }, []);
  const load = async () => {
    const n = ++asked.current;
    setS(null);
    let r: RoadsStatus;
    try { r = await roadsStatus(); } catch (e) { r = refusalOf(e); }
    if (n === asked.current) setS(r);
  };
  useEffect(() => { void load(); }, []);
  const nf = (n: number) => n.toLocaleString(lang.value === 'en' ? 'en-CA' : 'fr-CA');
  return (
    <Panel title={t('settings.connect.tomtom')} data-testid="connect-tomtom">
      <div class="stack">
        <div class="row-wrap" data-testid="tomtom-state"><MapIcon size={20} class="faint" aria-hidden="true" />
          {!s ? <Skeleton h={18} /> : s.ok ? <Status on={s.key} /> : <Pill tone="muted">{t('settings.connect.tomtomUnknown')}</Pill>}
        </div>
        <p class="muted" style={{ margin: 0 }}>{t('settings.connect.tomtomText')}</p>
        {s && s.ok && <p class="small" style={{ margin: 0 }} data-testid="tomtom-server">{t(s.key ? 'settings.connect.tomtomServerOn' : 'settings.connect.tomtomServerOff')}</p>}
        {s && !s.ok && (
          <div class="row-wrap" data-testid="tomtom-error">
            <span class="small grow">{failWords(s, (r) => errorMessage(r))}</span>
            <Button size="sm" onClick={() => load()} data-testid="tomtom-retry">{t('common.retry')}</Button>
          </div>
        )}
        {s && s.ok && s.month && <p class="small" style={{ margin: 0 }} data-testid="tomtom-month">{t('settings.connect.tomtomMonth', { tx: nf(s.month.tx), cap: nf(s.month.cap) })}</p>}
        <p class="small" style={{ margin: 0 }} data-testid="tomtom-browser">{t(browser ? 'settings.connect.tomtomBrowserOn' : 'settings.connect.tomtomBrowserOff')}</p>
        <p class="small muted" style={{ margin: 0 }}>{t('settings.connect.tomtomWhere')}</p>
      </div>
    </Panel>
  );
}

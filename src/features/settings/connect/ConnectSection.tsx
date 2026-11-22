/* Branchements (owner): GoHighLevel (automatic texts and team invitations), the incoming calls and texts, and Stripe
   (« Payer » by card on invoices). The keys are written here once and kept on the server; the screen only learns
   whether each one is set. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../lib/i18n';
import { errorMessage } from '../../../data/api';
import { refreshAccess } from '../../../data/auth';
import { Panel, Button, Banner, Skeleton } from '../../../ui';
import { teamDo } from '../../../domain/team/teamApi';
import { GhlPanel } from './GhlPanel';
import { RingPanel, TextsPanel } from './IncomingPanels';
import { StripePanel } from './StripePanel';
import { useSectionAnchor } from '../SectionFrame';
import { secretsOf, type Secrets } from './secrets';

export function ConnectSection() {
  const [s, setS] = useState<Secrets | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState('');
  // the latest ask wins: an answer that comes back after a newer one (or after leaving the section) is dropped
  const asked = useRef(0);
  useEffect(() => () => { asked.current = -1; }, []);
  const load = async () => {
    const n = ++asked.current;
    setState('loading');
    try {
      const r = await teamDo<Partial<Secrets>>('secrets');
      if (n !== asked.current) return;
      setS(secretsOf(r)); setState('ok');
    } catch (e) { if (n === asked.current) { setError(errorMessage(e)); setState('error'); } }
  };
  /** a key was plugged or unplugged: this device learns at once whether texts and card payments now work (settings-team-13) */
  const changed = async () => { await Promise.all([load(), refreshAccess()]); };
  useEffect(() => { void load(); }, []);
  const anchor = useSectionAnchor();
  return (
    <div class="settings-section stack-lg" data-testid="settings-connect">
      <p class="muted" style={{ margin: 0 }} data-tour={anchor}>{t('settings.connect.lead')}</p>
      {state === 'loading' && !s && <Panel><Skeleton h={18} lines={3} /><p class="small muted" style={{ margin: 'var(--sp-3) 0 0' }}>{t('settings.connect.loading')}</p></Panel>}
      {state === 'error' && <Banner kind="warn" title={t('settings.connect.error')} action={<Button size="sm" onClick={() => load()}>{t('common.retry')}</Button>}>{error}</Banner>}
      {s && <GhlPanel s={s} onChanged={changed} />}
      {s && <RingPanel />}
      {s && <TextsPanel />}
      {s && <StripePanel s={s} onChanged={changed} />}
    </div>
  );
}

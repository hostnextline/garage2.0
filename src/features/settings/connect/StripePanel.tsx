/* Stripe: the secret key (live only on the real server), its state, unplug. */
import { useState } from 'preact/hooks';
import { CreditCard, Unplug } from 'lucide-preact';
import { t } from '../../../lib/i18n';
import { errorMessage } from '../../../data/api';
import { Panel, Field, Input, Button, Pill, Banner, toast } from '../../../ui';
import { teamDo } from '../../../domain/team/teamApi';
import { Status } from './GhlPanel';
import type { Secrets } from './secrets';

export function StripePanel(p: { s: Secrets; onChanged: () => Promise<void> }) {
  const st = p.s.stripe;
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!key.trim()) return;
    try {
      await teamDo('secrets-set', { stripe_key: key.trim() });
      toast(t('settings.connect.saved'), { kind: 'ok' });
      setKey(''); setErr(null);
      await p.onChanged();
    } catch (e) {
      if (String((e as { code?: string }).code) === 'stripe_key') setErr(errorMessage(e)); else toast(errorMessage(e), { kind: 'bad' });
    }
  };
  const unplug = async () => {
    try { await teamDo('secrets-set', { stripe_key: '' }); toast(t('settings.connect.unplugged'), { kind: 'ok' }); await p.onChanged(); }
    catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
  };
  return (
    <Panel title={t('settings.connect.stripe')} data-testid="connect-stripe">
      <div class="stack">
        <div class="row-wrap"><CreditCard size={20} class="faint" aria-hidden="true" /><Status on={st.on} />{st.on && (st.test ? <Pill tone="warn">{t('settings.connect.test_mode')}</Pill> : <Pill tone="ok">{t('settings.connect.live_mode')}</Pill>)}</div>
        <p class="muted" style={{ margin: 0 }}>{t('settings.connect.stripeText')}</p>
        {st.on && <p class="small" style={{ margin: 0 }}>{t('settings.connect.stripeState', { end: st.end || '…' })}</p>}
        {st.on && st.test && <Banner kind="warn">{t('settings.connect.testModeHint')}</Banner>}
        <Field label={t('settings.connect.stripeKey')} help={t('settings.connect.stripeKeyHelp')} error={err}>
          <Input type="password" autoComplete="off" value={key} onValue={(v) => { setKey(v); setErr(null); }} placeholder={st.on ? t('settings.connect.keepKey') : 'sk_live_…'} invalid={!!err} data-testid="stripe-key" />
        </Field>
        <div class="row-wrap">
          <Button variant="primary" onClick={save} disabled={!key.trim()} data-testid="stripe-save">{t('settings.connect.save')}</Button>
          {st.on && <Button variant="danger" icon={<Unplug size={18} />} confirm={t('settings.connect.unplugConfirm')} onClick={unplug}>{t('settings.connect.unplug')}</Button>}
        </div>
      </div>
    </Panel>
  );
}

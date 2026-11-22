/* GoHighLevel: the key and the location (kept on the server, shown as « finit par … »), unplug, and a test text. */
import { useState } from 'preact/hooks';
import { MessageSquareText, Send, Unplug } from 'lucide-preact';
import { t, lang } from '../../../lib/i18n';
import { phoneDigits } from '../../../lib/text';
import { access } from '../../../data/auth';
import { team, errorMessage } from '../../../data/api';
import { Panel, Field, Input, PhoneInput, Button, Pill, toast } from '../../../ui';
import { teamDo } from '../../../domain/team/teamApi';
import { ghlBody, type Secrets } from './secrets';

export function Status(p: { on: boolean }) {
  return p.on ? <Pill tone="ok">{t('settings.connect.on')}</Pill> : <Pill tone="muted">{t('settings.connect.off')}</Pill>;
}

export function GhlPanel(p: { s: Secrets; onChanged: () => Promise<void> }) {
  const g = p.s.ghl;
  const [token, setToken] = useState('');
  const [loc, setLoc] = useState('');
  const [err, setErr] = useState<{ token?: string; loc?: string }>({});
  const [phone, setPhone] = useState(access.value?.phone || '');
  const [phoneErr, setPhoneErr] = useState<string | null>(null);
  const save = async () => {
    const body = ghlBody(token, loc);
    if (!body) { setErr({ token: t('settings.connect.needKey') }); return; }
    setErr({});
    try {
      await teamDo('secrets-set', body);
      toast(t('settings.connect.saved'), { kind: 'ok' });
      setToken(''); setLoc('');
      await p.onChanged();
    } catch (e) {
      // a refused key or location is said under its box
      const code = String((e as { code?: string }).code || '');
      if (code === 'ghl_token') setErr({ token: errorMessage(e) });
      else if (code === 'ghl_location') setErr({ loc: errorMessage(e) });
      else toast(errorMessage(e), { kind: 'bad' });
    }
  };
  const unplug = async () => {
    try { await teamDo('secrets-set', { ghl_token: '', ghl_location: '' }); toast(t('settings.connect.unplugged'), { kind: 'ok' }); await p.onChanged(); }
    catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
  };
  const test = async () => {
    if (!phoneDigits(phone)) { setPhoneErr(t('errors.phone')); return; }
    setPhoneErr(null);
    try {
      const r = await team<{ sent?: string }>('sms-test', { phone, lang: lang.value });
      if (r.ok) toast(t('settings.connect.testSent'), { kind: 'ok' });
      else if (r.code === 'phone') setPhoneErr(errorMessage(r));
      else if (r.sent === 'off') toast(t('settings.connect.testOff'), { kind: 'bad' });
      else toast(r.error || r.code ? t('settings.connect.testFailed', { error: r.error || errorMessage(r) }) : t('settings.connect.testOff'), { kind: 'bad' });
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
  };
  return (
    <Panel title={t('settings.connect.ghl')} data-testid="connect-ghl">
      <div class="stack">
        <div class="row-wrap"><MessageSquareText size={20} class="faint" aria-hidden="true" /><Status on={g.on} /></div>
        <p class="muted" style={{ margin: 0 }}>{t('settings.connect.ghlText')}</p>
        {g.on && <p class="small" style={{ margin: 0 }}>{t('settings.connect.ghlState', { end: g.token_end || '…', loc: g.location || '…' })}</p>}
        <div class="grid-2">
          <Field label={t('settings.connect.ghlToken')} help={t('settings.connect.ghlTokenHelp')} error={err.token}>
            <Input type="password" autoComplete="off" value={token} onValue={setToken} placeholder={g.on ? t('settings.connect.keepKey') : 'pit-…'} invalid={!!err.token} data-testid="ghl-token" />
          </Field>
          <Field label={t('settings.connect.ghlLocation')} help={t('settings.connect.ghlLocationHelp')} error={err.loc}>
            <Input autoComplete="off" value={loc} onValue={setLoc} placeholder={g.on ? t('settings.connect.keepKey') : ''} invalid={!!err.loc} data-testid="ghl-location" />
          </Field>
        </div>
        <div class="row-wrap">
          <Button variant="primary" onClick={save} disabled={!token.trim() && !loc.trim()} data-testid="ghl-save">{t('settings.connect.save')}</Button>
          {g.on && <Button variant="danger" icon={<Unplug size={18} />} confirm={t('settings.connect.unplugConfirm')} onClick={unplug}>{t('settings.connect.unplug')}</Button>}
        </div>
        <div class="settings-test">
          <Field label={t('settings.connect.testPhone')} help={t('settings.connect.testHelp')} error={phoneErr}>
            <PhoneInput value={phone} onValue={(v) => { setPhone(v); setPhoneErr(null); }} invalid={!!phoneErr} />
          </Field>
          <Button icon={<Send size={18} />} onClick={test} data-testid="ghl-test">{t('settings.connect.test')}</Button>
        </div>
      </div>
    </Panel>
  );
}

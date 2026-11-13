/* Branchements (owner): GoHighLevel (automatic texts and team invitations) and Stripe (« Payer » by card on invoices).
   The keys are written here once and kept on the server; the screen only learns whether each one is set. */
import { useEffect, useState } from 'preact/hooks';
import { MessageSquareText, MessageCircle, CreditCard, Send, Unplug, PhoneCall, Copy } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { phoneDigits } from '../../lib/text';
import { access, callFn } from '../../data/auth';
import { checkCalls } from '../booking/CallBanner';
import { checkTexts } from '../conversation/TextHost';
import { team, errorMessage } from '../../data/api';
import { Panel, Field, Input, PhoneInput, Button, Pill, Banner, Skeleton, toast } from '../../ui';
import { teamDo } from '../team/teamApi';

interface Secrets { ghl: { on: boolean; token_end: string | null; location: string | null }; stripe: { on: boolean; test: boolean; end: string | null; webhook: boolean } }

export function ConnectSection() {
  const [s, setS] = useState<Secrets | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState('');
  const load = async () => {
    setState('loading');
    try {
      const r = await teamDo<Secrets>('secrets');
      setS({ ghl: { on: !!r.ghl?.on, token_end: r.ghl?.token_end ?? null, location: r.ghl?.location ?? null }, stripe: { on: !!r.stripe?.on, test: !!r.stripe?.test, end: r.stripe?.end ?? null, webhook: !!r.stripe?.webhook } });
      setState('ok');
    } catch (e) { setError(errorMessage(e)); setState('error'); }
  };
  useEffect(() => { void load(); }, []);
  return (
    <div class="settings-section stack-lg" data-testid="settings-connect">
      <p class="muted" style={{ margin: 0 }}>{t('settings.connect.lead')}</p>
      {state === 'loading' && !s && <Panel><Skeleton h={18} lines={3} /><p class="small muted" style={{ margin: 'var(--sp-3) 0 0' }}>{t('settings.connect.loading')}</p></Panel>}
      {state === 'error' && <Banner kind="warn" title={t('settings.connect.error')} action={<Button size="sm" onClick={() => void load()}>{t('common.retry')}</Button>}>{error}</Banner>}
      {s && <GhlPanel s={s} onChanged={load} />}
      {s && <RingPanel />}
      {s && <TextsPanel />}
      {s && <StripePanel s={s} onChanged={load} />}
    </div>
  );
}

function Status(p: { on: boolean }) {
  return p.on ? <Pill tone="ok">{t('settings.connect.on')}</Pill> : <Pill tone="muted">{t('settings.connect.off')}</Pill>;
}

function GhlPanel(p: { s: Secrets; onChanged: () => Promise<void> }) {
  const g = p.s.ghl;
  const [token, setToken] = useState('');
  const [loc, setLoc] = useState('');
  const [err, setErr] = useState<{ token?: string; loc?: string }>({});
  const [phone, setPhone] = useState(access.value?.phone || '');
  const [phoneErr, setPhoneErr] = useState<string | null>(null);
  const save = async () => {
    if (!token.trim() && !loc.trim()) { setErr({ token: t('settings.connect.needKey') }); return; }
    setErr({});
    const body: Record<string, string> = {};
    if (token.trim()) body.ghl_token = token.trim();
    if (loc.trim()) body.ghl_location = loc.trim();
    try {
      await teamDo('secrets-set', body);
      toast(t('settings.connect.saved'), { kind: 'ok' });
      setToken(''); setLoc('');
      await p.onChanged();
    } catch (e) {
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

/** « Appels entrants »: the address GoHighLevel calls when the garage's number rings (made on the server, shown to the owner) */
function RingPanel() {
  const [url, setUrl] = useState('');
  const link = async (renew = false) => {
    try {
      const r = await callFn<{ url?: string }>('ring', { action: 'link', renew }, 20000);
      if (!r.ok || !r.url) throw new Error(r.error || '');
      setUrl(r.url);
      if (renew) toast(t('settings.connect.ringRenewed'), { kind: 'ok' });
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast(t('settings.connect.ringCopied')); }
    catch { toast(t('settings.connect.ringCopyFail'), { kind: 'bad' }); }
  };
  const tryIt = async () => {
    try {
      const r = await callFn('ring', { action: 'test' }, 20000);
      if (!r.ok) throw new Error(r.error || '');
      toast(t('settings.connect.ringTried'));
      setTimeout(checkCalls, 800);
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
  };
  return (
    <Panel title={t('settings.connect.ring')} data-testid="connect-ring">
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}><PhoneCall size={16} aria-hidden="true" /> {t('settings.connect.ringText')}</p>
        {!url ? <div><Button variant="primary" onClick={() => link()} data-testid="ring-get">{t('settings.connect.ringGet')}</Button></div> : (
          <>
            <Field label={t('settings.connect.ringUrl')}>
              <Input value={url} onValue={() => undefined} readOnly data-testid="ring-url" />
            </Field>
            <p class="small muted" style={{ margin: 0 }}>{t('settings.connect.ringSteps')}</p>
            <div class="row-wrap">
              <Button variant="primary" icon={<Copy size={18} />} onClick={copy} data-testid="ring-copy">{t('settings.connect.ringCopy')}</Button>
              <Button variant="ghost" onClick={() => link(true)} data-testid="ring-renew">{t('settings.connect.ringRenew')}</Button>
            </div>
          </>
        )}
        <div><Button icon={<Send size={18} />} onClick={tryIt} data-testid="ring-try">{t('settings.connect.ringTry')}</Button></div>
      </div>
    </Panel>
  );
}

/** « Textos entrants »: the address GoHighLevel calls when somebody texts the garage's number (the calls' key, « &t=sms ») */
function TextsPanel() {
  const [url, setUrl] = useState('');
  const link = async () => {
    try {
      const r = await callFn<{ text_url?: string }>('ring', { action: 'link' }, 20000);
      if (!r.ok || !r.text_url) throw new Error(r.error || '');
      setUrl(r.text_url);
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast(t('settings.connect.ringCopied')); }
    catch { toast(t('settings.connect.ringCopyFail'), { kind: 'bad' }); }
  };
  const tryIt = async () => {
    try {
      const r = await callFn('ring', { action: 'test', kind: 'text' }, 20000);
      if (!r.ok) throw new Error(r.error || '');
      toast(t('settings.connect.textsTried'));
      setTimeout(checkTexts, 800);
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
  };
  return (
    <Panel title={t('settings.connect.texts')} data-testid="connect-texts">
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}><MessageCircle size={16} aria-hidden="true" /> {t('settings.connect.textsText')}</p>
        {!url ? <div><Button variant="primary" onClick={link} data-testid="texts-get">{t('settings.connect.ringGet')}</Button></div> : (
          <>
            <Field label={t('settings.connect.textsUrl')}>
              <Input value={url} onValue={() => undefined} readOnly data-testid="texts-url" />
            </Field>
            <p class="small muted" style={{ margin: 0 }}>{t('settings.connect.textsSteps')}</p>
            <div class="row-wrap">
              <Button variant="primary" icon={<Copy size={18} />} onClick={copy} data-testid="texts-copy">{t('settings.connect.ringCopy')}</Button>
            </div>
          </>
        )}
        <div><Button icon={<Send size={18} />} onClick={tryIt} data-testid="texts-try">{t('settings.connect.ringTry')}</Button></div>
      </div>
    </Panel>
  );
}

function StripePanel(p: { s: Secrets; onChanged: () => Promise<void> }) {
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

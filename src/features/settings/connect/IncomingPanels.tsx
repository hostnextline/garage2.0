/* « Appels entrants » and « Textos entrants »: the switch « dans mon compte » (only this owner's account gets the banner or
   the bubble), this device's alert while the app is closed (one Web Push address serves both), the address GoHighLevel
   calls (made once on the server, shown to the owner), and « Essayer ». */
import { useEffect, useRef, useState } from 'preact/hooks';
import { MessageCircle, Send, PhoneCall, Copy } from 'lucide-preact';
import { t } from '../../../lib/i18n';
import { callFn, refreshAccess } from '../../../data/auth';
import { errorMessage, updateMe } from '../../../data/api';
import { checkCalls, callsOn, checkTexts, textsOn } from '../../../services/bubbles';
import { pushState, pushOn, pushOff, type PushState } from '../../../services/push';
import { Panel, Field, Input, Button, Switch, toast } from '../../../ui';
import { copyText } from '../../../domain/team/teamApi';
import { dropAlert } from './secrets';

type Kind = 'calls' | 'texts';
const isOn = (k: Kind) => (k === 'calls' ? callsOn() : textsOn());

/** « Recevoir … dans mon compte »: said done only once the account really says so (it used to say « allumé » after a
    failure: settings-team-20) */
async function setMine(kind: Kind, v: boolean) {
  const other: Kind = kind === 'calls' ? 'texts' : 'calls';
  // the alert stays while the other switch still needs it; a device that cannot drop it keeps it (nothing to tell)
  if (dropAlert(v, isOn(other))) await pushOff().catch(() => undefined);
  await updateMe({ prefs: { [kind]: v } });
  await refreshAccess();
  if (isOn(kind) === v) toast(t(`settings.connect.${kind}Mine${v ? 'On' : 'Off'}`), { kind: 'ok' });
  else toast(t('settings.connect.mineFailed'), { kind: 'bad' });
}

/** this device's alert while the app is closed (asked again when the account switch changes) */
function PushAlert(p: { mine: boolean; testid: string }) {
  const [alert, setAlert] = useState<PushState | null>(null);
  useEffect(() => {
    let alive = true;
    void pushState().catch(() => 'unsupported' as const).then((s) => { if (alive) setAlert(s); });
    return () => { alive = false; };
  }, [p.mine]);
  const setPush = async (v: boolean) => {
    try {
      if (v) await pushOn(); else await pushOff();
      toast(t(v ? 'settings.connect.alertOn' : 'settings.connect.alertOff'), { kind: 'ok' });
    } catch (e) {
      const code = String((e as { code?: string }).code || '');
      toast(code === 'denied' || code === 'unsupported' ? t(`settings.connect.alertHint.${code}`) : errorMessage(e), { kind: 'bad' });
    }
    setAlert(await pushState().catch(() => 'off' as const));
  };
  if (!p.mine || !alert) return null;
  return <Switch checked={alert === 'on'} onChange={(v) => void setPush(v)} disabled={alert !== 'on' && alert !== 'off'} label={t('settings.connect.alert')}
    hint={t(`settings.connect.alertHint.${alert === 'on' ? 'off' : alert}`)} data-testid={p.testid} />;
}

/** the address GoHighLevel calls, asked once from the server (`ring { action: 'link' }`) */
function useHookLink(field: 'url' | 'text_url') {
  const [url, setUrl] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const get = async () => {
    try {
      const r = await callFn<{ url?: string; text_url?: string }>('ring', { action: 'link' }, 20000);
      if (!r.ok || !r[field]) throw new Error(r.error || '');
      if (alive.current) setUrl(r[field]!);
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
  };
  const copy = async () => {
    const ok = await copyText(url);
    toast(ok ? t('settings.connect.ringCopied') : t('settings.connect.ringCopyFail'), { kind: ok ? 'info' : 'bad' });
  };
  return { url, get, copy };
}

/** « Essayer »: a pretend call or text from « Client TEST »; the banner or bubble is asked for right after */
async function tryIt(kind: Kind) {
  try {
    const r = await callFn('ring', kind === 'calls' ? { action: 'test' } : { action: 'test', kind: 'text' }, 20000);
    if (!r.ok) throw new Error(r.error || '');
    toast(t(kind === 'calls' ? 'settings.connect.ringTried' : 'settings.connect.textsTried'));
    setTimeout(kind === 'calls' ? checkCalls : checkTexts, 800);
  } catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
}

export function RingPanel() {
  const mine = callsOn();
  const hook = useHookLink('url');
  return (
    <Panel title={t('settings.connect.ring')} data-testid="connect-ring">
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}><PhoneCall size={16} aria-hidden="true" /> {t('settings.connect.ringText')}</p>
        <Switch checked={mine} onChange={(v) => void setMine('calls', v)} label={t('settings.connect.callsMine')} hint={t('settings.connect.callsMineHint')} data-testid="calls-mine" />
        <PushAlert mine={mine} testid="calls-alert" />
        {!hook.url ? <div><Button variant="primary" onClick={hook.get} data-testid="ring-get">{t('settings.connect.ringGet')}</Button></div> : (
          <>
            <Field label={t('settings.connect.ringUrl')}>
              <Input value={hook.url} onValue={() => undefined} readOnly data-testid="ring-url" />
            </Field>
            <p class="small muted" style={{ margin: 0 }}>{t('settings.connect.ringSteps')}</p>
            <div class="row-wrap">
              <Button variant="primary" icon={<Copy size={18} />} onClick={hook.copy} data-testid="ring-copy">{t('settings.connect.ringCopy')}</Button>
            </div>
          </>
        )}
        <div><Button icon={<Send size={18} />} onClick={() => tryIt('calls')} data-testid="ring-try">{t('settings.connect.ringTry')}</Button></div>
      </div>
    </Panel>
  );
}

export function TextsPanel() {
  const mine = textsOn();
  const hook = useHookLink('text_url');
  return (
    <Panel title={t('settings.connect.texts')} data-testid="connect-texts">
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}><MessageCircle size={16} aria-hidden="true" /> {t('settings.connect.textsText')}</p>
        <Switch checked={mine} onChange={(v) => void setMine('texts', v)} label={t('settings.connect.textsMine')} hint={t('settings.connect.textsMineHint')} data-testid="texts-mine" />
        <PushAlert mine={mine} testid="texts-alert" />
        {!hook.url ? <div><Button variant="primary" onClick={hook.get} data-testid="texts-get">{t('settings.connect.ringGet')}</Button></div> : (
          <>
            <Field label={t('settings.connect.textsUrl')}>
              <Input value={hook.url} onValue={() => undefined} readOnly data-testid="texts-url" />
            </Field>
            <p class="small muted" style={{ margin: 0 }}>{t('settings.connect.textsSteps')}</p>
            <div class="row-wrap">
              <Button variant="primary" icon={<Copy size={18} />} onClick={hook.copy} data-testid="texts-copy">{t('settings.connect.ringCopy')}</Button>
            </div>
          </>
        )}
        <div><Button icon={<Send size={18} />} onClick={() => tryIt('texts')} disabled={!mine} data-testid="texts-try">{t('settings.connect.ringTry')}</Button></div>
      </div>
    </Panel>
  );
}

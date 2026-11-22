/* « Ses infos »: name, short name, phone (the e-mail is the sign-in: shown, not changed here). Saved with its own button. */
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { memberUpdate } from '../../data/api';
import { Panel, Button, Field, Input, PhoneInput, run } from '../../ui';
import type { Enqueue } from './useQueue';

export function InfosPanel(p: { id: string; full_name: string; short_name: string | null; phone: string | null; email: string | null; enqueue: Enqueue }) {
  const saved = { full_name: p.full_name || '', short_name: p.short_name || '', phone: p.phone || '' };
  const [d, setD] = useState(saved);
  const [err, setErr] = useState<string | null>(null);
  // the stored values changed (saved here or elsewhere): start again from them
  useEffect(() => { setD(saved); }, [p.full_name, p.short_name, p.phone]);
  const dirty = d.full_name.trim() !== saved.full_name || d.short_name.trim() !== saved.short_name || d.phone.trim() !== saved.phone;
  const save = async () => {
    if (!d.full_name.trim()) { setErr(t('team.person.needName')); return; }
    setErr(null);
    await p.enqueue(() => run(() => memberUpdate(p.id, { full_name: d.full_name.trim(), short_name: d.short_name.trim(), phone: d.phone.trim() }), { ok: t('team.person.infosSaved') }));
  };
  return (
    <Panel plain title={t('team.person.infos')}>
      <div class="stack">
        <Field label={t('team.person.name')} error={err}><Input value={d.full_name} onValue={(v) => setD({ ...d, full_name: v })} autoComplete="off" invalid={!!err} /></Field>
        <div class="grid-2">
          <Field label={t('team.person.short')} optional><Input value={d.short_name} onValue={(v) => setD({ ...d, short_name: v })} autoComplete="off" maxLength={40} /></Field>
          <Field label={t('team.person.phone')} optional><PhoneInput value={d.phone} onValue={(v) => setD({ ...d, phone: v })} /></Field>
        </div>
        {p.email && <p class="small muted" style={{ margin: 0 }}>{t('team.person.emailLine', { email: p.email })}</p>}
        <div><Button variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} onClick={save} data-testid="person-save">{t('team.person.saveInfos')}</Button></div>
      </div>
    </Panel>
  );
}

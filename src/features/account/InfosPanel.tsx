import { useEffect, useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { access, refreshAccess, isOwner } from '../../data/auth';
import { updateMe, memberUpdate } from '../../data/api';
import { Panel, Field, Input, PhoneInput, Button, run } from '../../ui';

/* my name (the owner changes it; others ask the owner) and my phone */
export function InfosPanel() {
  const a = access.value!;
  const owner = isOwner();
  const saved = { full_name: a.full_name || '', short_name: a.short_name || '', phone: a.phone || '' };
  const [d, setD] = useState(saved);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setD(saved); }, [a.full_name, a.short_name, a.phone]);
  const dirty = d.phone.trim() !== saved.phone || (owner && (d.full_name.trim() !== saved.full_name || d.short_name.trim() !== saved.short_name));
  const save = async () => {
    if (owner && !d.full_name.trim()) { setErr(t('account.needName')); return; }
    setErr(null);
    await run(async () => {
      if (owner && (d.full_name.trim() !== saved.full_name || d.short_name.trim() !== saved.short_name)) {
        await memberUpdate(a.id, { full_name: d.full_name.trim(), short_name: d.short_name.trim() });
      }
      if (d.phone.trim() !== saved.phone) { await updateMe({ phone: d.phone.trim() }); await refreshAccess(); }
    }, { ok: t('account.saved') });
  };
  return (
    <Panel title={t('account.infos')}>
      <div class="stack">
        {owner ? (
          <div class="grid-2">
            <Field label={t('account.name')} error={err}><Input value={d.full_name} onValue={(v) => setD({ ...d, full_name: v })} autoComplete="name" invalid={!!err} /></Field>
            <Field label={t('account.short')} hint={t('account.shortHint')} optional><Input value={d.short_name} onValue={(v) => setD({ ...d, short_name: v })} autoComplete="nickname" maxLength={40} /></Field>
          </div>
        ) : (
          <p class="small muted" style={{ margin: 0 }}>{t('account.nameByOwner')}</p>
        )}
        <Field label={t('account.phone')} hint={t('account.phoneHint')} optional>
          <PhoneInput value={d.phone} onValue={(v) => setD({ ...d, phone: v })} />
        </Field>
        {a.email && <p class="small muted" style={{ margin: 0 }}>{t('account.emailLine', { email: a.email })}</p>}
        <div><Button variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} onClick={save} data-testid="account-save">{t('account.save')}</Button></div>
      </div>
    </Panel>
  );
}


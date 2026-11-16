/* A service's sheet: names fr/en, category, price or « à confirmer », duration, taxes, « Camion seulement », offered or
   hidden, promo with an end date, its place in the list, what is included (fr/en), what it needs from the car, and the
   inventory parts it uses (saved at once). A new service keeps this sheet once created, to add its parts right away. */
import { useMemo, useState } from 'preact/hooks';
import { Plus, Trash2 } from 'lucide-preact';
import { t, lang } from '../../../lib/i18n';
import { duration, today } from '../../../lib/dates';
import { money } from '../../../lib/money';
import { servicesList, service as serviceOf, serviceName, settings } from '../../../data/select';
import { saveService } from '../../../data/api';
import { uuid } from '../../../data/sync';
import type { Service } from '../../../data/types';
import { Panel, Button, IconButton, Sheet, Field, Input, MoneyInput, Seg, Switch, Stepper, DateInput, ask, attempt, toast } from '../../../ui';
import { changesOf, withChanges } from '../draft';
import { toDraft, toRow, check, type ServiceDraft } from './serviceModel';
import { NeedsPanel } from './NeedsPanel';
import { PartsPanel } from './PartsPanel';

export function ServiceSheet(p: { id: string | null; onClose: () => void }) {
  if (!p.id) return null;
  return <ServiceOpen key={p.id} {...p} id={p.id} />;
}

function ServiceOpen(p: { id: string; onClose: () => void }) {
  const [made, setMade] = useState<string | null>(null);
  const sid = p.id === 'new' ? made : p.id;
  const isNew = !sid;
  const s = sid ? serviceOf(sid) : undefined;
  const saved = toDraft(s, Math.max(0, ...servicesList.value.map((x) => x.sort || 0)));
  // only the fields typed here: the row coming back from the server (or changed on another device) updates the others,
  // and never wipes what is being typed (settings-team-09)
  const [touched, setTouched] = useState<Partial<ServiceDraft>>({});
  const d = withChanges(saved, touched);
  const dirty = Object.keys(changesOf(saved, d)).length > 0;
  const [err, setErr] = useState<{ name?: string; price?: string }>({});
  const put = <K extends keyof ServiceDraft>(k: K, v: ServiceDraft[K]) => setTouched(changesOf(saved, { ...d, [k]: v }));
  const cats = useMemo(() => [...new Set(servicesList.value.map((x) => x.category).filter(Boolean))].sort(), [servicesList.value]);
  const rate = settings.value.billing.hourly_cents;

  /** closing with changes not saved asks first (the backdrop, the phone's back) */
  const close = async () => {
    if (dirty && !(await ask({ title: t('settings.services.leave.title'), text: t('settings.services.leave.text'), ok: t('settings.services.leave.ok'), danger: true }))) return;
    p.onClose();
  };
  const save = async () => {
    const e = check(d);
    setErr(e);
    if (Object.keys(e).length) { toast(t('settings.fixErrors'), { kind: 'bad' }); return; }
    const id = sid || uuid();
    const ok = await attempt(() => saveService(toRow(id, d)), { ok: t('settings.services.saved') });
    if (!ok) return;
    setTouched({});
    if (isNew) setMade(id); else p.onClose();
  };
  const remove = async () => {
    if (!sid) { p.onClose(); return; }
    if (await attempt(() => saveService({ id: sid, deleted_at: new Date().toISOString() }), { ok: t('settings.services.deleted') })) p.onClose();
  };

  return (
    <Sheet open onClose={() => void close()} wide title={isNew ? t('settings.services.new') : t('settings.services.edit')} sub={isNew ? undefined : serviceName(s || ({ name_fr: d.name_fr, name_en: d.name_en } as Service), lang.value)} data-testid="service-sheet"
      footer={<>
        {!isNew && <Button variant="danger" icon={<Trash2 size={18} />} confirm={t('settings.services.deleteConfirm')} onClick={remove} data-testid="service-delete">{t('settings.services.delete')}</Button>}
        <Button variant="primary" disabled={!dirty && !isNew} onClick={save} data-testid="service-save">{t('settings.services.save')}</Button>
      </>}>
      <div class="settings-svc-grid">
        <div class="stack">
          <div class="grid-2">
            <Field label={t('settings.services.nameFr')} error={err.name}>
              <Input value={d.name_fr} onValue={(v) => { put('name_fr', v); setErr({ ...err, name: undefined }); }} invalid={!!err.name} autoComplete="off" data-testid="service-name" />
            </Field>
            <Field label={t('settings.services.nameEn')} help={t('settings.services.nameEnHelp')} optional>
              <Input value={d.name_en} onValue={(v) => put('name_en', v)} autoComplete="off" />
            </Field>
          </div>
          <Field label={t('settings.services.category')} help={t('settings.services.categoryHelp')} optional>
            <Input value={d.category} onValue={(v) => put('category', v)} list="settings-cats" autoComplete="off" />
          </Field>
          <datalist id="settings-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          <Field label={t('settings.services.priceKind')} group>
            <Seg value={d.fixed} onValue={(v) => put('fixed', v)} label={t('settings.services.priceKind')} data-testid="service-pricekind"
              options={[{ value: 'fixed', label: t('settings.services.fixed') }, { value: 'hourly', label: t('settings.services.hourly') }]} />
          </Field>
          {d.fixed === 'fixed'
            ? <Field label={t('settings.services.price')} error={err.price}><MoneyInput cents={d.price_cents} onCents={(c) => { put('price_cents', c); setErr({ ...err, price: undefined }); }} allowNegative invalid={!!err.price} aria-label={t('settings.services.price')} /></Field>
            : <p class="small muted" style={{ margin: 0 }}>{rate ? t('settings.services.hourlyHint', { rate: money(rate, lang.value) }) : t('settings.services.hourlyHintNoRate')}</p>}
          <Field label={t('settings.services.duration')} help={t('settings.services.durationHelp')} group>
            <Stepper value={d.duration_min} onValue={(v) => put('duration_min', v)} step={15} min={5} max={720} label={t('settings.services.duration')} format={(v) => duration(v, lang.value)} />
          </Field>
          <Switch checked={d.taxable} onChange={(v) => put('taxable', v)} label={t('settings.services.taxable')} hint={t('settings.services.taxableHint')} />
          <Switch checked={d.needs_machine} onChange={(v) => put('needs_machine', v)} label={t('settings.services.machine')} hint={t('settings.services.machineHint')} data-testid="service-machine" />
          <Switch checked={d.active} onChange={(v) => put('active', v)} label={t('settings.services.active')} hint={t('settings.services.activeHint')} data-testid="service-active" />
          <Switch checked={d.is_promo} onChange={(v) => put('is_promo', v)} label={t('settings.services.isPromo')} hint={t('settings.services.isPromoHint')} />
          {d.is_promo && (
            <Field label={t('settings.services.until')} hint={t('settings.services.untilHint')} optional>
              <DateInput value={d.promo_until} onValue={(v) => put('promo_until', v)} min={today()} aria-label={t('settings.services.until')} />
            </Field>
          )}
          <Field label={t('settings.services.sort')} help={t('settings.services.sortHelp')} group>
            <Stepper value={d.sort} onValue={(v) => put('sort', v)} min={0} max={999} label={t('settings.services.sort')} />
          </Field>
        </div>
        <div class="stack">
          <Panel plain title={t('settings.services.includes')} help={t('settings.services.includesHelp')}>
            <div class="stack">
              {d.includes.map((inc, i) => (
                <div key={i} class="settings-include">
                  <Input value={inc.fr} onValue={(v) => put('includes', d.includes.map((x, k) => (k === i ? { ...x, fr: v } : x)))} aria-label={t('settings.services.includeFr')} placeholder={t('settings.services.includeFr')} />
                  <Input value={inc.en} onValue={(v) => put('includes', d.includes.map((x, k) => (k === i ? { ...x, en: v } : x)))} aria-label={t('settings.services.includeEn')} placeholder={t('settings.services.includeEn')} />
                  <IconButton icon={<Trash2 />} label={t('settings.services.removeInclude')} onClick={() => put('includes', d.includes.filter((_, k) => k !== i))} />
                </div>
              ))}
              <div><Button size="sm" icon={<Plus size={16} />} onClick={() => put('includes', [...d.includes, { fr: '', en: '' }])}>{t('settings.services.addInclude')}</Button></div>
            </div>
          </Panel>
          <NeedsPanel d={d} onNeeds={(n) => put('needs', n)} />
          <PartsPanel serviceId={sid} />
        </div>
      </div>
    </Sheet>
  );
}

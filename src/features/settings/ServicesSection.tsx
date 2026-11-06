/* Services et prix: the price list (rows), and a service's sheet: names fr/en, category, price or « à confirmer »,
   duration, taxes, promo with an end date, what is included (fr/en), offered or hidden, its place in the list, and the
   inventory parts it uses (service_parts: each change here is saved at once). */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Plus, Trash2 } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { duration, shortDate, today } from '../../lib/dates';
import { money } from '../../lib/money';
import { matches } from '../../lib/text';
import { servicesList, service as serviceOf, serviceName, partsOfService, inventoryList, settings } from '../../data/select';
import { getRow } from '../../data/store';
import { saveService, saveServicePart, Refused } from '../../data/api';
import { updateRow, uuid } from '../../data/sync';
import { preview } from '../../data/auth';
import type { Service, ServicePart, InventoryItem, Need, NeedKind, TireSeason } from '../../data/types';
import { Panel, Rows, RowItem, Pill, Money, Button, IconButton, Sheet, Field, Input, MoneyInput, Seg, Switch, Stepper, DateInput, Select, SearchInput, Empty, Banner, Chips, attempt, run, toast } from '../../ui';
import { isDirty, cleanText } from './draft';
import { NEED_KINDS, guessNeeds } from '../inventory/needs';

export function ServicesSection() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);   // a service id, or 'new'
  const all = servicesList.value;
  const list = all.filter((s) => matches(q, s.name_fr, s.name_en, s.category));
  return (
    <div class="settings-section stack-lg" data-testid="settings-services">
      <Panel flush title={t('settings.services.list')} help={t('settings.services.listHelp')}
        action={<Button variant="primary" size="sm" icon={<Plus size={18} />} onClick={() => setOpen('new')} data-testid="service-add">{t('settings.services.add')}</Button>}>
        {all.length > 8 && <div class="settings-search"><SearchInput value={q} onValue={setQ} placeholder={t('settings.services.search')} /></div>}
        {!all.length
          ? <Empty title={t('settings.services.none')} text={t('settings.services.noneText')} action={<Button variant="primary" icon={<Plus size={18} />} onClick={() => setOpen('new')}>{t('settings.services.add')}</Button>} />
          : !list.length ? <Empty title={t('settings.services.noMatch')} />
          : (
            <Rows>
              {list.map((s) => (
                <RowItem key={s.id} onClick={() => setOpen(s.id)} data-testid={`service-${s.id}`} chevron class={s.active ? '' : 'settings-off'}
                  title={serviceName(s, lang.value)}
                  sub={s.is_promo
                    ? <span class="settings-promo">{s.promo_until ? t('settings.services.promoUntil', { date: shortDate(s.promo_until, lang.value) }) : t('settings.services.promo')}</span>
                    : t('settings.services.meta', { category: cap(s.category), duration: duration(s.duration_min, lang.value) })}
                  end={<span class="settings-svc-end">
                    {!s.active && <Pill tone="muted">{t('settings.services.hidden')}</Pill>}
                    {s.price_cents == null ? <span class="small muted">{t('settings.services.toConfirm')}</span> : <Money cents={s.price_cents} />}
                  </span>} />
              ))}
            </Rows>
          )}
      </Panel>
      <ServiceSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

interface Draft {
  name_fr: string; name_en: string; category: string; fixed: 'fixed' | 'hourly'; price_cents: number | null; duration_min: number; taxable: boolean;
  is_promo: boolean; promo_until: string; includes: { fr: string; en: string }[]; active: boolean; sort: number;
  /** null: guessed from the name (the needs of the week) */
  needs: Need[] | null;
}
const toDraft = (s: Service | undefined): Draft => ({
  name_fr: s?.name_fr || '', name_en: s?.name_en || '', category: s?.category || '', fixed: s && s.price_cents == null ? 'hourly' : 'fixed',
  price_cents: s?.price_cents ?? null, duration_min: s?.duration_min ?? 60, taxable: s?.taxable ?? true, is_promo: !!s?.is_promo,
  promo_until: s?.promo_until || '', includes: (s?.includes || []).map((i) => ({ fr: i.fr || '', en: i.en || '' })), active: s?.active ?? true,
  sort: s?.sort ?? (Math.max(0, ...servicesList.value.map((x) => x.sort || 0)) + 1),
  needs: Array.isArray(s?.needs) ? s!.needs : null
});

function ServiceSheet(p: { id: string | null; onClose: () => void }) {
  if (!p.id) return null;
  return <ServiceOpen key={p.id} {...p} id={p.id} />;
}
function ServiceOpen(p: { id: string; onClose: () => void }) {
  // a new service keeps this same sheet once created (to add its parts right away)
  const [made, setMade] = useState<string | null>(null);
  const sid = p.id === 'new' ? made : p.id;
  const isNew = !sid;
  const s = sid ? serviceOf(sid) : undefined;
  const saved = useMemo(() => toDraft(s), [s?.updated_at, sid, !!s]);
  const [d, setD] = useState<Draft>(saved);
  const [err, setErr] = useState<{ name?: string; price?: string }>({});
  useEffect(() => { setD(saved); }, [saved]);
  const dirty = isDirty(saved, d);
  const put = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const cats = useMemo(() => [...new Set(servicesList.value.map((x) => x.category).filter(Boolean))].sort(), [servicesList.value]);
  const rate = settings.value.billing.hourly_cents;

  const save = async () => {
    const e: { name?: string; price?: string } = {};
    if (!d.name_fr.trim()) e.name = t('settings.services.needName');
    if (d.fixed === 'fixed' && d.price_cents == null) e.price = t('settings.services.needPrice');
    setErr(e);
    if (Object.keys(e).length) { toast(t('settings.fixErrors'), { kind: 'bad' }); return; }
    const id = sid || uuid();
    const ok = await attempt(() => saveService({
      id, name_fr: d.name_fr.trim(), name_en: cleanText(d.name_en), category: (cleanText(d.category) || 'autre').toLowerCase(),
      price_cents: d.fixed === 'fixed' ? d.price_cents : null, duration_min: Math.min(720, Math.max(5, Math.round(d.duration_min))), taxable: d.taxable,
      is_promo: d.is_promo, promo_until: d.is_promo && d.promo_until ? d.promo_until : null,
      includes: d.includes.map((i) => ({ fr: i.fr.trim(), en: i.en.trim() || undefined })).filter((i) => i.fr), active: d.active, sort: Math.max(0, Math.round(d.sort)),
      needs: d.needs
    }), { ok: t('settings.services.saved') });
    if (ok && isNew) setMade(id);
    else if (ok) p.onClose();
  };
  const remove = async () => {
    if (!sid) { p.onClose(); return; }
    if (await attempt(() => saveService({ id: sid, deleted_at: new Date().toISOString() }), { ok: t('settings.services.deleted') })) p.onClose();
  };

  return (
    <Sheet open onClose={p.onClose} wide title={isNew ? t('settings.services.new') : t('settings.services.edit')} sub={isNew ? undefined : serviceName(s || toServiceStub(d), lang.value)} data-testid="service-sheet"
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
const toServiceStub = (d: Draft) => ({ name_fr: d.name_fr, name_en: d.name_en } as Service);

/* what the service takes that depends on the car (the needs of the week): said here, or guessed from its name */
function NeedsPanel(p: { d: Draft; onNeeds: (n: Need[] | null) => void }) {
  const guessed = p.d.needs == null;
  const needs = guessed ? guessNeeds({ name_fr: p.d.name_fr, name_en: p.d.name_en, includes: p.d.includes }) : p.d.needs!;
  const kinds = needs.map((n) => n.kind);
  const tires = needs.find((n) => n.kind === 'tires');
  const set = (next: Need[]) => p.onNeeds(next);
  const pick = (ks: NeedKind[]) => set(NEED_KINDS.filter((k) => ks.includes(k)).map((k) => needs.find((n) => n.kind === k) || (k === 'tires' ? { kind: k, qty: 4, season: null } : { kind: k })));
  const tire = (patch: Partial<Need>) => set(needs.map((n) => (n.kind === 'tires' ? { ...n, ...patch } : n)));
  return (
    <Panel plain title={t('settings.services.needs.title')} help={t('settings.services.needs.help')} data-testid="service-needs">
      <div class="stack">
        <Chips multiple label={t('settings.services.needs.title')} value={kinds} onValue={(v) => pick(v as NeedKind[])} data-testid="service-needs-kinds"
          options={NEED_KINDS.map((k) => ({ value: k, label: t(`settings.services.needs.kinds.${k}`) }))} />
        {tires && (
          <div class="grid-2">
            <Field label={t('settings.services.needs.tiresQty')} group>
              <Stepper value={tires.qty || 4} onValue={(v) => tire({ qty: v })} min={1} max={8} label={t('settings.services.needs.tiresQty')} />
            </Field>
            <Field label={t('settings.services.needs.season')} group>
              <Seg value={(tires.season || 'any') as TireSeason | 'any'} onValue={(v) => tire({ season: v === 'any' ? null : (v as TireSeason) })} label={t('settings.services.needs.season')}
                options={(['winter', 'summer', 'all', 'any'] as const).map((x) => ({ value: x, label: t(`settings.services.needs.seasons.${x}`) }))} />
            </Field>
          </div>
        )}
        <p class="small muted" style={{ margin: 0 }} data-testid="service-needs-note">
          {guessed ? (kinds.length ? t('settings.services.needs.guessed') : t('settings.services.needs.guessedNone')) : kinds.length ? t('settings.services.needs.said') : t('settings.services.needs.nothing')}
        </p>
        {!guessed && <div><Button size="sm" variant="ghost" onClick={() => p.onNeeds(null)} data-testid="service-needs-guess">{t('settings.services.needs.backToGuess')}</Button></div>}
      </div>
    </Panel>
  );
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* parts removed in this session: re-adding the same part brings its row back (the database keeps one per service and part) */
const removedParts = new Map<string, string>();
function guard() { if (preview.value) throw new Refused('preview', t('errors.preview')); }

function PartsPanel(p: { serviceId: string | null }) {
  const [item, setItem] = useState('');
  const [qty, setQty] = useState(1);
  const items = inventoryList.value;
  if (!p.serviceId) return <Panel plain title={t('settings.services.parts')}><p class="muted small" style={{ margin: 0 }}>{t('settings.services.partsFirst')}</p></Panel>;
  const sid = p.serviceId;
  const parts = partsOfService(sid);
  const used = new Set(parts.map((x) => x.item_id));
  const choices = items.filter((i) => !used.has(i.id));
  const nameOf = (id: string) => getRow<InventoryItem>('inventory_items', id)?.name || '—';
  const unitOf = (id: string) => getRow<InventoryItem>('inventory_items', id)?.unit || '';
  const add = async () => {
    if (!item) return;
    const back = removedParts.get(`${sid}|${item}`);
    const ok = await attempt(async () => {
      guard();
      if (back) { await updateRow('service_parts', back, { deleted_at: null, qty }); removedParts.delete(`${sid}|${item}`); }
      else await saveServicePart({ id: uuid(), service_id: sid, item_id: item, qty });
    }, { ok: t('settings.services.partAdded') });
    if (ok) { setItem(''); setQty(1); }
  };
  const remove = async (sp: ServicePart) => {
    if (await attempt(() => saveServicePart({ id: sp.id, deleted_at: new Date().toISOString() }), { ok: t('settings.services.partRemoved') })) removedParts.set(`${sid}|${sp.item_id}`, sp.id);
  };
  return (
    <Panel plain title={t('settings.services.parts')} help={t('settings.services.partsHelp')} data-testid="service-parts">
      <div class="stack">
        {!parts.length && <p class="muted small" style={{ margin: 0 }}>{t('settings.services.noParts')}</p>}
        {parts.length > 0 && (
          <div class="settings-parts">
            {parts.map((sp) => (
              <div key={sp.id} class="settings-part">
                <span class="grow ellipsis">{nameOf(sp.item_id)}</span>
                <Stepper value={Number(sp.qty)} min={0.5} max={999} step={sp.qty % 1 ? 0.5 : 1} label={`${t('settings.services.qty')}, ${nameOf(sp.item_id)}`}
                  format={(v) => `${v.toLocaleString(lang.value === 'en' ? 'en-CA' : 'fr-CA')} ${unitOf(sp.item_id)}`}
                  onValue={(v) => void run(() => saveServicePart({ id: sp.id, qty: v }))} />
                <IconButton icon={<Trash2 />} label={t('settings.services.removePart')} onClick={() => remove(sp)} />
              </div>
            ))}
          </div>
        )}
        {!items.length ? <Banner kind="info">{t('settings.services.noInventory')}</Banner> : choices.length > 0 && (
          <div class="settings-part-add">
            <Select value={item} onValue={setItem} placeholder={t('settings.services.choosePart')} aria-label={t('settings.services.part')}
              options={choices.map((i) => ({ value: i.id, label: i.name }))} />
            <Stepper value={qty} onValue={setQty} min={0.5} max={999} step={1} label={t('settings.services.qty')} format={(v) => `${v.toLocaleString(lang.value === 'en' ? 'en-CA' : 'fr-CA')} ${item ? unitOf(item) : ''}`} />
            <Button icon={<Plus size={18} />} disabled={!item} onClick={add} data-testid="part-add">{t('settings.services.addPart')}</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

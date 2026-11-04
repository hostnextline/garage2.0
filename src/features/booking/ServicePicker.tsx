/* The services of the price list as tappable rows (promos first, then by category), quantities for parts and labour,
   a free line; used by booking, estimates and the job sheet (« Ajouter du travail »).
   The lines are written in the customer's language (lang); the screen around stays in the person's language. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Check, Plus, X, Tag } from 'lucide-preact';
import type { ItemKind } from '../../data/types';
import { activeServices, service as serviceRow, serviceName } from '../../data/select';
import { t, lang as appLang } from '../../lib/i18n';
import { duration, today } from '../../lib/dates';
import { money } from '../../lib/money';
import { matches } from '../../lib/text';
import { Button, IconButton, Sheet, Field, Input, MoneyInput, Check as CheckBox, Seg, Stepper, SearchInput, Money, Empty, Skeleton } from '../../ui';
import { net } from '../../data/sync';
import { draftOfService, workMinutes } from './logic';
import { dayMonth } from './when';
import './booking.css';

export interface ItemDraft {
  id?: string; kind: ItemKind; service_id: string | null; item_id?: string | null; description: string; qty: number; unit_cents: number;
  taxable: boolean; duration_min: number | null; note?: string | null;
}
export interface ServicePickerProps {
  value: ItemDraft[]; onValue: (items: ItemDraft[]) => void; lang?: 'fr' | 'en'; allowCustom?: boolean;
  /** the screen shows its own total (with taxes): leave out the line under the chosen services */
  hideTotal?: boolean;
}

/** minutes of work of the chosen lines (services without a duration count 45 min) */
export function itemsDuration(items: ItemDraft[]): number { return items.reduce((n, i) => n + (i.duration_min ?? (i.kind === 'service' ? 45 : 0)) * (i.kind === 'service' ? Math.max(1, i.qty) : 1), 0); }

function categoryTitle(cat: string): string {
  const k = `booking.svc.categories.${cat}`;
  const s = t(k);
  if (s !== k) return s;
  const c = String(cat || '').trim();
  return c ? c.charAt(0).toUpperCase() + c.slice(1) : t('booking.svc.categories.autre');
}
const kindWord = (k: ItemKind) => t(`booking.svc.kinds.${k}`);

export function ServicePicker(p: ServicePickerProps) {
  const l = p.lang || appLang.value;
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState(false);
  const all = activeServices.value;
  // keep the latest value for the effect below (the customer's language changed)
  const valueRef = useRef(p.value);
  valueRef.current = p.value;

  /* the customer's language changed: the lines of the price list follow (a line written by hand stays as it is) */
  useEffect(() => {
    const other = l === 'en' ? 'fr' : 'en';
    let changed = false;
    const next = valueRef.current.map((it) => {
      const s = it.service_id ? serviceRow(it.service_id) : undefined;
      if (!s) return it;
      const want = serviceName(s, l);
      if (it.description !== want && it.description === serviceName(s, other)) { changed = true; return { ...it, description: want }; }
      return it;
    });
    if (changed) p.onValue(next);
  }, [l]);

  const chosen = new Set(p.value.map((i) => i.service_id).filter(Boolean) as string[]);
  const groups = useMemo(() => {
    const list = all.filter((s) => !q.trim() || matches(q, s.name_fr, s.name_en, s.category));
    const out: { key: string; title: string; promo: boolean; items: typeof list }[] = [];
    const promos = list.filter((s) => s.is_promo);
    if (promos.length) out.push({ key: '__promo', title: t('booking.svc.promos'), promo: true, items: promos });
    for (const s of list.filter((x) => !x.is_promo)) {
      const key = s.category || 'autre';
      let g = out.find((x) => x.key === key && !x.promo);
      if (!g) { g = { key, title: categoryTitle(key), promo: false, items: [] }; out.push(g); }
      g.items.push(s);
    }
    return out;
  }, [all, q, appLang.value]);

  const toggle = (id: string) => {
    if (chosen.has(id)) { p.onValue(p.value.filter((i) => i.service_id !== id)); return; }
    const s = serviceRow(id);
    if (s) p.onValue([...p.value, draftOfService(s, l)]);
  };
  const setLine = (idx: number, patch: Partial<ItemDraft>) => p.onValue(p.value.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeLine = (idx: number) => p.onValue(p.value.filter((_, i) => i !== idx));

  const minutes = workMinutes(p.value);
  const subtotal = p.value.reduce((n, i) => n + Math.round((Number(i.qty) || 0) * i.unit_cents) * (i.kind === 'discount' ? -1 : 1), 0);
  const toConfirm = p.value.some((i) => i.service_id && serviceRow(i.service_id)?.price_cents == null);

  return (
    <div class="svc" data-testid="service-picker">
      {all.length > 8 && <SearchInput value={q} onValue={setQ} placeholder={t('booking.svc.search')} />}
      {!all.length && !net.value.ready && <div aria-busy="true"><span class="sr-only">{t('common.loading')}</span><Skeleton h={56} lines={3} /></div>}
      {!all.length && net.value.ready && <Empty title={t('booking.svc.empty')} text={t('booking.svc.emptyText')} />}
      {all.length > 0 && !groups.length && <p class="muted small svc-nomatch">{t('booking.svc.noMatch')}</p>}
      {groups.map((g) => (
        <div class={`svc-group${g.promo ? ' svc-group-promo' : ''}`} key={g.key} role="group" aria-label={g.title}>
          <h3 class="svc-group-title">{g.promo && <Tag size={16} aria-hidden="true" />}{g.title}</h3>
          <div class="svc-list">
            {g.items.map((s) => {
              const on = chosen.has(s.id);
              return (
                <button key={s.id} type="button" class={`svc-row${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggle(s.id)} data-testid={`svc-${s.id}`}>
                  <span class="svc-box" aria-hidden="true">{on && <Check size={18} />}</span>
                  <span class="svc-main">
                    <span class="svc-name">{serviceName(s, appLang.value)}</span>
                    <span class="svc-sub">
                      {s.is_promo && s.promo_until ? <span class="svc-promo">{t('booking.svc.promo', { date: dayMonth(s.promo_until, appLang.value, today()) })}</span> : null}
                      <span>{s.duration_min ? duration(s.duration_min, appLang.value) : t('booking.svc.noTime')}</span>
                    </span>
                  </span>
                  <span class="svc-price">{s.price_cents == null ? <span class="svc-confirm">{t('booking.svc.toConfirm')}</span> : <Money cents={s.price_cents} />}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {p.allowCustom && (
        <div>
          <Button icon={<Plus />} onClick={() => setCustom(true)} data-testid="svc-custom">{t('booking.svc.custom')}</Button>
        </div>
      )}
      {p.value.length > 0 && (
        <div class="svc-chosen" data-testid="svc-chosen">
          <h3 class="svc-group-title">{t('booking.svc.chosen')}</h3>
          <ul class="svc-lines">
            {p.value.map((it, i) => {
              const stepper = it.kind === 'part' || it.kind === 'labour';
              const s = it.service_id ? serviceRow(it.service_id) : undefined;
              return (
                <li key={`${it.service_id || 'x'}-${i}`} class="svc-line">
                  <span class="svc-line-main">
                    <span class="svc-line-name">{it.description}</span>
                    <span class="svc-sub">
                      {it.kind !== 'service' && <span>{kindWord(it.kind)}</span>}
                      {(it.duration_min ?? 0) > 0 && <span>{duration((it.duration_min || 0) * (it.kind === 'service' ? Math.max(1, it.qty) : 1), appLang.value)}</span>}
                    </span>
                  </span>
                  {stepper && <Stepper value={Number(it.qty) || 1} min={1} max={99} label={`${t('booking.svc.qty')} : ${it.description}`} onValue={(v) => setLine(i, { qty: v })} />}
                  <span class="svc-price">
                    {s && s.price_cents == null && !it.unit_cents ? <span class="svc-confirm">{t('booking.svc.toConfirm')}</span> : <Money cents={Math.round((Number(it.qty) || 0) * it.unit_cents) * (it.kind === 'discount' ? -1 : 1)} />}
                  </span>
                  <IconButton icon={<X />} label={t('booking.svc.remove', { name: it.description })} onClick={() => removeLine(i)} />
                </li>
              );
            })}
          </ul>
          {!p.hideTotal && <p class="svc-total">
            <span>{minutes > 0 ? t('booking.svc.total', { d: duration(minutes, appLang.value) }) : t('booking.svc.noTime')}</span>
            <span class="money">{money(subtotal, appLang.value)}{toConfirm ? ` + ${t('booking.svc.toConfirm').toLowerCase()}` : ''}</span>
          </p>}
        </div>
      )}
      {p.allowCustom && <CustomLine open={custom} onClose={() => setCustom(false)} onAdd={(it) => { p.onValue([...p.value, it]); setCustom(false); }} />}
    </div>
  );
}

/* « Ligne libre »: a part, labour or a fee that is not on the price list */
function CustomLine(p: { open: boolean; onClose: () => void; onAdd: (it: ItemDraft) => void }) {
  const [desc, setDesc] = useState('');
  const [kind, setKind] = useState<ItemKind>('part');
  const [price, setPrice] = useState<number | null>(null);
  const [taxable, setTaxable] = useState(true);
  const [mins, setMins] = useState(0);
  const [minsTouched, setMinsTouched] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (p.open) { setDesc(''); setKind('part'); setPrice(null); setTaxable(true); setMins(0); setMinsTouched(false); setErr(null); } }, [p.open]);
  const pickKind = (k: ItemKind) => { setKind(k); if (!minsTouched) setMins(k === 'labour' ? 30 : 0); };
  const add = () => {
    if (!desc.trim()) { setErr(t('booking.svc.descRequired')); return; }
    p.onAdd({ kind, service_id: null, item_id: null, description: desc.trim(), qty: 1, unit_cents: price ?? 0, taxable, duration_min: mins > 0 ? mins : null, note: null });
  };
  return (
    <Sheet open={p.open} onClose={p.onClose} title={t('booking.svc.custom')}
      footer={<><Button onClick={p.onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={add} data-testid="svc-custom-add">{t('booking.svc.customAdd')}</Button></>}>
      <div class="stack">
        <Field label={t('booking.svc.customDesc')} hint={t('booking.svc.customDescHint')} error={err}>
          <Input value={desc} onValue={(v) => { setDesc(v); if (err) setErr(null); }} autoFocus maxLength={200} invalid={!!err} onEnter={add} data-testid="svc-custom-desc" />
        </Field>
        <Field label={t('booking.svc.customKind')} group>
          <Seg value={kind} onValue={pickKind} label={t('booking.svc.customKind')}
            options={(['part', 'labour', 'fee'] as ItemKind[]).map((k) => ({ value: k, label: kindWord(k) }))} />
        </Field>
        <Field label={t('booking.svc.customPrice')} hint={t('booking.svc.customPriceHint')} optional>
          <MoneyInput cents={price} onCents={setPrice} />
        </Field>
        <CheckBox checked={taxable} onChange={setTaxable} label={t('booking.svc.customTaxable')} />
        <Field label={t('booking.svc.customTime')} hint={t('booking.svc.customTimeHint')} group>
          <Stepper value={mins} min={0} max={480} step={15} label={t('booking.svc.customTime')} format={(v) => (v ? duration(v, appLang.value) : '0')}
            onValue={(v) => { setMins(v); setMinsTouched(true); }} />
        </Field>
      </div>
    </Sheet>
  );
}

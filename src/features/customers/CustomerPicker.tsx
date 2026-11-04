/* Pick a customer by name, phone, address, plate or car, or create one on the spot (shared with booking and
   estimates). Typing searches at once; ↑ ↓ choose, Entrée takes the highlighted customer; recent customers show
   before anything is typed. « Nouveau client » opens a short sheet; what was typed fills it (a phone number goes to
   the phone, words to the name). */
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { Search, X, UserPlus, Phone, Car } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { customer, customerName } from '../../data/select';
import { saveCustomer } from '../../data/api';
import { Avatar, Button, Sheet, Banner, Skeleton, run } from '../../ui';
import { net } from '../../data/sync';
import { factsOf, searchIndex, recentFirst } from './facts';
import { useSettled, useFocusOnMount } from './hooks';
import { searchList, draftFromQuery } from './search';
import { CustomerFields, emptyDraft, checkDraft, hasErrors, customerPatch, type Draft, type DraftErrors } from './CustomerFields';
import { Flags, Bit, carName } from './bits';
import './customers.css';

export interface CustomerPickerProps {
  value: string | null;
  onPick: (customerId: string | null) => void;
  /** offer « Nouveau client » (a short form in a sheet) when the search finds nobody */
  allowCreate?: boolean;
  autoFocus?: boolean;
  /** what the search box says (default « Nom, téléphone, adresse… ») */
  placeholder?: string;
}

const SHOWN = 8, RECENT = 5;

export function CustomerPicker(p: CustomerPickerProps) {
  if (p.value) return <Picked id={p.value} onChange={() => p.onPick(null)} />;
  return <PickerSearch {...p} />;
}

/* ---------- the chosen customer ---------- */
function Picked(p: { id: string; onChange: () => void }) {
  const c = customer(p.id);
  const f = factsOf(p.id);
  if (!c) {
    return (
      <div class="customers-picked" data-testid="customer-picked">
        {net.value.ready ? <span class="grow muted">{t('customers.picker.missing')}</span> : <span class="grow" aria-busy="true"><Skeleton h={18} lines={2} /></span>}
        <Button size="sm" onClick={p.onChange}>{t('customers.picker.change')}</Button>
      </div>
    );
  }
  return (
    <div class="customers-picked" data-testid="customer-picked">
      <Avatar name={customerName(c)} />
      <span class="grow customers-picked-main">
        <b class="ellipsis">{customerName(c)}</b>
        <span class="customers-line">
          {c.phone && <Bit icon={<Phone size={14} aria-hidden="true" />}>{c.phone}</Bit>}
          {f.cars[0] && <Bit icon={<Car size={14} aria-hidden="true" />}>{carName(f.cars[0])}{f.cars.length > 1 ? ` ${t('customers.carMore', { n: f.cars.length - 1 })}` : ''}</Bit>}
        </span>
        <Flags c={c} owed={f.owed} noSms />
      </span>
      <Button size="sm" onClick={p.onChange} data-testid="customer-change">{t('customers.picker.change')}</Button>
    </div>
  );
}

/* ---------- searching ---------- */
function PickerSearch(p: CustomerPickerProps) {
  const base = useId();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<Partial<Draft> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const all = recentFirst.value;
  const index = searchIndex.value;
  const typed = useSettled(q.trim(), all.length > 800 ? 100 : 0);
  const found = useMemo(() => searchList(all, typed, (c) => index.get(c.id)), [all, index, typed]);
  useFocusOnMount(p.autoFocus, () => input.current);
  const shown = found.slice(0, typed ? SHOWN : RECENT);
  useEffect(() => setActive(0), [typed]);

  const pick = (id: string) => { p.onPick(id); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' && shown.length) { e.preventDefault(); setActive((a) => (a + 1) % shown.length); }
    else if (e.key === 'ArrowUp' && shown.length) { e.preventDefault(); setActive((a) => (a - 1 + shown.length) % shown.length); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      // the very long list searches a moment after the keys: Entrée uses what is typed now
      const now = q.trim();
      const list = now === typed ? shown : searchList(all, now, (c) => index.get(c.id)).slice(0, now ? SHOWN : RECENT);
      const choice = now === typed ? list[active] : list[0];
      if (choice) pick(choice.id);
      else if (now && p.allowCreate) setCreating(draftFromQuery(now));
    } else if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); setQ(''); }
  };
  const optId = (i: number) => `${base}-o${i}`;
  const listId = `${base}-l`;
  const label = p.placeholder || t('customers.picker.placeholder');
  return (
    <div class="customers-picker" data-testid="customer-picker">
      <span class="input-wrap search">
        <Search class="search-icon" aria-hidden="true" />
        <input ref={input} class="input" type="search" enterKeyHint="search" autoComplete="off" spellcheck={false} autoFocus={p.autoFocus}
          placeholder={label} aria-label={t('customers.picker.label')} value={q}
          role="combobox" aria-autocomplete="list" aria-expanded={shown.length > 0} aria-controls={listId}
          aria-activedescendant={shown.length ? optId(Math.min(active, shown.length - 1)) : undefined}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} onKeyDown={onKey} data-testid="customer-search" />
        {q && <button type="button" class="iconbtn" aria-label={t('customers.picker.clear')} onClick={() => { setQ(''); input.current?.focus(); }}><X /></button>}
      </span>
      {!typed && shown.length > 0 && <p class="customers-picker-head">{t('customers.picker.recent')}</p>}
      {shown.length > 0 && (
        <div class="customers-options" role="listbox" id={listId} aria-label={t('customers.picker.label')}>
          {shown.map((c, i) => {
            const f = factsOf(c.id);
            return (
              <div key={c.id} id={optId(i)} role="option" aria-selected={i === active} class={`customers-option${i === active ? ' is-active' : ''}`}
                onPointerDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(c.id)} data-testid="customer-option">
                <Avatar name={customerName(c)} size="sm" />
                <span class="customers-option-main">
                  <b class="ellipsis">{customerName(c)}{c.company && (c.first_name || c.last_name) ? <span class="faint"> {c.company}</span> : null}</b>
                  <span class="customers-line">
                    {c.phone && <Bit icon={<Phone size={14} aria-hidden="true" />}>{c.phone}</Bit>}
                    {f.cars[0] && <Bit icon={<Car size={14} aria-hidden="true" />}>{carName(f.cars[0])}</Bit>}
                  </span>
                </span>
                <Flags c={c} owed={f.owed} class="customers-option-flags" />
              </div>
            );
          })}
        </div>
      )}
      {typed && found.length > shown.length && <p class="small muted customers-picker-more">{t('customers.picker.more', { n: found.length - shown.length })}</p>}
      {typed && !found.length && (
        <div class="customers-picker-none" role="status">
          <span class="muted">{t('customers.picker.none', { q: typed })}</span>
          {p.allowCreate && <Button variant="primary" icon={<UserPlus size={18} />} onClick={() => setCreating(draftFromQuery(typed))} data-testid="picker-create-typed">{t('customers.picker.create', { q: typed })}</Button>}
        </div>
      )}
      {!all.length && !typed && <p class="muted small" style={{ margin: 0 }}>{t('customers.picker.noCustomers')}</p>}
      {p.allowCreate && (found.length > 0 || !typed) && (
        <Button variant="ghost" icon={<UserPlus size={18} />} onClick={() => setCreating(typed ? draftFromQuery(typed) : {})} class="customers-picker-new" data-testid="picker-new">{t('customers.newCustomer')}</Button>
      )}
      {creating && <QuickCreate initial={creating} onClose={() => setCreating(null)} onCreated={(id) => { setCreating(null); pick(id); }} />}
    </div>
  );
}

/* ---------- the short sheet: prénom, nom, téléphone, adresse, langue ---------- */
function QuickCreate(p: { initial: Partial<Draft>; onClose: () => void; onCreated: (id: string) => void }) {
  const [d, setD] = useState<Draft>(() => emptyDraft(p.initial));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<Draft>) => { const n = { ...d, ...patch }; setD(n); if (tried) setErrors(checkDraft(n)); };
  const create = async () => {
    setTried(true);
    const e = checkDraft(d);
    setErrors(e);
    if (hasErrors(e)) return;
    const id = await run(() => saveCustomer(customerPatch(d)), { ok: t('customers.file.created') });
    if (id) p.onCreated(id);
  };
  return (
    <Sheet open onClose={p.onClose} title={t('customers.picker.createTitle')} data-testid="quick-create"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" icon={<UserPlus size={18} />} onClick={create} data-testid="quick-create-ok">{t('customers.picker.createOk')}</Button>
      </>}>
      {tried && hasErrors(errors) && <Banner kind="bad">{t('customers.form.fix')}</Banner>}
      <CustomerFields draft={d} set={set} errors={errors} short autoFocus={!p.initial.first_name}
        dupAction={(c) => <Button onClick={() => p.onCreated(c.id)} data-testid="dup-pick">{t('customers.dup.pick', { name: c.first_name || customerName(c) })}</Button>} />
    </Sheet>
  );
}

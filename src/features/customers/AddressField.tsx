/* An address with suggestions as you type (Photon, OpenStreetMap); gives back the address, the unit, the postal code
   and the position (lat/lng) used by the planner and the map. With no signal or no answer, the address is kept as
   typed (lat/lng null) and the field says so. Shared with booking and estimates. */
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { MapPin, CircleCheck, Search, X, CloudOff } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { findPostal, postalCode, splitUnit, civicNumber } from '../../lib/text';
import { Spinner } from '../../ui';
import { photonUrl, photonQuery, suggestionsOf, type Suggestion } from './photon';
import { splitPasted, cityOf } from './address';
import { useFocusOnMount } from './hooks';
import './customers.css';

export interface PlaceValue { address: string; unit: string | null; postal_code: string | null; lat: number | null; lng: number | null; city?: string | null }
export interface AddressFieldProps {
  value: PlaceValue; onValue: (v: PlaceValue) => void; label?: string; autoFocus?: boolean;
  /** also show the unit and postal code fields (a customer's file). Without them, a unit typed or pasted with the
      address (« 3-1250 rue Graham ») still goes to value.unit, and a postal code in the address to value.postal_code. */
  details?: boolean;
  id?: string; 'data-testid'?: string;
}
export const EMPTY_PLACE: PlaceValue = { address: '', unit: null, postal_code: null, lat: null, lng: null, city: null };

/* ---------- searching ---------- */
interface Found { places: Suggestion[]; error: 'offline' | null }
const cache = new Map<string, Suggestion[]>();
/** asks Photon (6 s at most); never throws */
export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Found> {
  const query = photonQuery(q);
  if (query.length < 3 || !/\p{L}/u.test(query)) return { places: [], error: null };
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit) return { places: hit, error: null };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { places: [], error: 'offline' };
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  signal?.addEventListener('abort', stop);
  const timer = setTimeout(stop, 6000);
  try {
    const r = await fetch(photonUrl(query), { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return { places: [], error: 'offline' };
    const places = suggestionsOf(await r.json(), query);
    cache.set(key, places);
    if (cache.size > 60) cache.delete(cache.keys().next().value as string);
    return { places, error: null };
  } catch {
    return { places: [], error: 'offline' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}
/** address → possible places (empty when nothing is found or there is no signal) */
export async function geocode(q: string): Promise<PlaceValue[]> {
  const { line, unit } = splitPasted(q);
  return (await searchPlaces(line)).places.map((s) => ({ ...s.place, unit: unit ?? null }));
}

/* ---------- the field ---------- */
type State = 'idle' | 'busy' | 'none' | 'offline';
export function AddressField(p: AddressFieldProps) {
  const v: PlaceValue = { ...EMPTY_PLACE, ...(p.value || {}) };
  const base = useId();
  const id = p.id || `${base}-a`;
  const listId = `${base}-l`;
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [state, setState] = useState<State>('idle');
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [postalText, setPostalText] = useState(v.postal_code || '');
  const [postalBad, setPostalBad] = useState(false);
  const typed = useRef(false);
  const run = useRef(0);
  const vRef = useRef(v);
  vRef.current = v;
  const emit = (patch: Partial<PlaceValue>) => p.onValue({ ...vRef.current, ...patch });
  useFocusOnMount(p.autoFocus, () => document.getElementById(id));

  useEffect(() => { if (document.activeElement?.id !== `${base}-p`) setPostalText(v.postal_code || ''); }, [v.postal_code]);

  const search = async (text: string, show = true) => {
    const n = ++run.current;
    setState('busy');
    const r = await searchPlaces(text);
    if (n !== run.current) return;
    setItems(r.places);
    setActive(0);
    setOpen(show && r.places.length > 0);
    setState(r.error ? 'offline' : r.places.length ? 'idle' : 'none');
  };
  // suggestions as you type, 300 ms after the last key
  useEffect(() => {
    if (!typed.current) return;
    const text = v.address.trim();
    if (photonQuery(text).length < 3 || !/\p{L}/u.test(text)) { run.current++; setItems([]); setOpen(false); setState('idle'); return; }
    const tm = setTimeout(() => void search(text), 300);
    return () => clearTimeout(tm);
  }, [v.address]);
  // the signal is back while the person is in the field: search again
  useEffect(() => {
    const on = () => { if (state === 'offline' && v.address.trim() && v.lat == null) void search(v.address, focused); };
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [state, v.address, v.lat, focused]);

  const pick = (s: Suggestion) => {
    typed.current = false;
    run.current++;
    setPicked(s);
    setOpen(false);
    setItems([]);
    setState('idle');
    emit({ address: s.place.address, postal_code: s.place.postal_code || vRef.current.postal_code || null, lat: s.place.lat, lng: s.place.lng, city: s.place.city ?? null });
  };
  const onInput = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    const kind = (e as InputEvent).inputType || '';
    typed.current = true;
    setPicked(null);
    if (/^insertFrom(Paste|Drop)$|^insertReplacementText$/.test(kind)) {
      const s = splitPasted(el.value);
      emit({ address: s.line, unit: s.unit ?? vRef.current.unit, postal_code: s.postal ?? vRef.current.postal_code, lat: null, lng: null, city: null });
      return;
    }
    emit({ address: el.value, lat: null, lng: null, city: null, postal_code: findPostal(el.value) ?? vRef.current.postal_code });
  };
  // a pasted address keeps its line breaks here (an input drops them): « 180-8255 av. Mountain Sights⏎Montréal, QC H4P 2B5 »
  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLInputElement;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? el.value.length;
    const s = splitPasted(el.value.slice(0, a) + text + el.value.slice(b));
    typed.current = true;
    setPicked(null);
    emit({ address: s.line, unit: s.unit ?? vRef.current.unit, postal_code: s.postal ?? vRef.current.postal_code, lat: null, lng: null, city: null });
  };
  const onBlur = () => {
    setFocused(false);
    setTimeout(() => setOpen(false), 120);
    // « 3-1250 rue Graham » typed by hand: the unit goes to its own field
    const cur = vRef.current;
    if (!cur.unit && cur.address) {
      const s = splitUnit(cur.address);
      if (s.unit) emit({ address: s.line, unit: s.unit });
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (open && items.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); return; }
      if (e.key === 'Enter') { e.preventDefault(); pick(items[Math.max(0, active)]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    } else if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setOpen(true); }
  };
  const clear = () => {
    typed.current = false;
    run.current++;
    setItems([]); setOpen(false); setState('idle'); setPicked(null);
    p.onValue({ ...EMPTY_PLACE });
    document.getElementById(id)?.focus();
  };

  const hasText = !!v.address.trim();
  const located = v.lat != null && v.lng != null;
  let hint: ComponentChildren = null;
  if (state === 'busy') hint = <Spinner label={t('customers.address.searching')} />;
  else if (state === 'offline' && hasText && !located) hint = <span class="customers-hint is-warn"><CloudOff size={16} aria-hidden="true" />{t('customers.address.offline')}</span>;
  else if (state === 'none' && hasText && !located) hint = <span class="customers-hint is-warn">{t('customers.address.none')}</span>;
  else if (located && picked && !picked.exact) hint = <span class="customers-hint is-ok"><CircleCheck size={16} aria-hidden="true" />{t('customers.address.street')}</span>;
  else if (located) hint = <span class="customers-hint is-ok"><CircleCheck size={16} aria-hidden="true" />{t('customers.address.found')}</span>;
  else if (hasText && picked && !picked.exact) hint = <span class="customers-hint is-warn">{t('customers.address.streetNoPos')}</span>;
  else if (hasText && !open && !focused) {
    hint = (
      <span class="customers-hint is-warn">
        <MapPin size={16} aria-hidden="true" />
        <span class="grow">{civicNumber(v.address) ? t('customers.address.toFind') : t('customers.address.noCivic')}</span>
        <button type="button" class="btn btn-sm btn-secondary" onClick={() => { typed.current = false; void search(v.address); }}>
          <Search size={16} aria-hidden="true" /><span class="btn-txt">{t('customers.address.find')}</span>
        </button>
      </span>
    );
  }

  const optId = (i: number) => `${base}-o${i}`;
  return (
    <div class="customers-address" data-testid={p['data-testid'] || 'address-field'}>
      <div class="field">
        <label class="field-label" for={id}>{p.label || t('customers.address.label')}</label>
        <span class="input-wrap">
          <input
            id={id} class="input" type="text" autoComplete="street-address" enterKeyHint="next" autoFocus={p.autoFocus}
            placeholder={t('customers.address.placeholder')} value={v.address} spellcheck={false}
            role="combobox" aria-autocomplete="list" aria-expanded={open && items.length > 0} aria-controls={listId}
            aria-activedescendant={open && items.length ? optId(active) : undefined} aria-describedby={`${base}-h`}
            onInput={onInput} onPaste={onPaste} onKeyDown={onKey} onFocus={() => { setFocused(true); if (items.length && !located) setOpen(true); }} onBlur={onBlur}
            data-testid="address-input"
          />
          {hasText && <button type="button" class="iconbtn" aria-label={t('customers.address.clear')} onClick={clear}><X /></button>}
        </span>
        {open && items.length > 0 && (
          <ul class="customers-sugg" role="listbox" id={listId} aria-label={t('customers.address.suggestions')} data-testid="address-suggestions">
            {items.map((s, i) => (
              <li key={s.key} id={optId(i)} role="option" aria-selected={i === active} class={i === active ? 'is-active' : ''}
                onPointerDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(s)}>
                <MapPin size={18} aria-hidden="true" class={s.exact ? 'customers-sugg-pin' : 'customers-sugg-pin is-street'} />
                <span class="customers-sugg-txt"><b>{s.label}</b>{s.sub && <span>{s.sub}</span>}</span>
              </li>
            ))}
          </ul>
        )}
        <span id={`${base}-h`} class="customers-address-hint" aria-live="polite">{hint}</span>
      </div>
      {p.details && <div class="customers-address-row">
        <label class="field">
          <span class="field-label">{t('customers.address.unit')}<span class="faint">({t('common.optional')})</span></span>
          <input class="input" type="text" autoComplete="address-line2" value={v.unit || ''} placeholder={t('customers.address.unitPlaceholder')}
            onInput={(e) => emit({ unit: (e.currentTarget as HTMLInputElement).value || null })} data-testid="address-unit" />
        </label>
        <label class="field">
          <span class="field-label">{t('customers.address.postal')}</span>
          <input id={`${base}-p`} class="input customers-postal" type="text" autoComplete="postal-code" value={postalText} placeholder={t('customers.address.postalPlaceholder')} maxLength={7}
            aria-invalid={postalBad || undefined} onInput={(e) => { const s = (e.currentTarget as HTMLInputElement).value; setPostalText(s); setPostalBad(false); emit({ postal_code: s.trim() ? s : null }); }}
            onBlur={() => { const s = postalText.trim(); if (!s) { setPostalBad(false); return; } const pc = postalCode(s); setPostalBad(!pc); if (pc) { setPostalText(pc); emit({ postal_code: pc }); } }}
            data-testid="address-postal" />
          {postalBad && <span class="field-error" role="alert">{t('customers.address.postalError')}</span>}
        </label>
      </div>}
    </div>
  );
}

/** the place to save on a customer or a job: the city read from the address when Photon did not give it */
export function placeFields(v: PlaceValue): { address: string | null; unit: string | null; postal_code: string | null; lat: number | null; lng: number | null; city: string | null } {
  const address = v.address.trim() || null;
  return {
    address,
    unit: v.unit?.trim() || null,
    postal_code: postalCode(v.postal_code) || v.postal_code?.trim().toUpperCase() || null,
    lat: address ? v.lat : null,
    lng: address ? v.lng : null,
    city: v.city || cityOf(address)
  };
}

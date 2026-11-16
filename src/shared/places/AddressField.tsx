/* An address with suggestions as you type (Photon, OpenStreetMap); gives back the address, the unit, the postal code
   and the position (lat/lng) used by the planner and the map. With no signal or no answer, the address is kept as
   typed (lat/lng null) and the field says so. Shared with booking and estimates.
   This file only draws: the rules are in addressEdit.ts and addressState.ts, the work over time in useAddressField.ts. */
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { MapPin, CircleCheck, Search, X, CloudOff } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { postalCode } from '../../lib/text';
import { Spinner } from '../../ui';
import { useFocusOnMount } from '../../ui/hooks';
import { useAddressField } from './useAddressField';
import { hasDoor } from './addressEdit';
import type { PlaceValue } from './place';
import './customers.css';

export { EMPTY_PLACE, placeFields, type PlaceValue } from './place';
export { searchPlaces } from './places';

export interface AddressFieldProps {
  value: PlaceValue; onValue: (v: PlaceValue) => void; label?: string; autoFocus?: boolean;
  /** also show the unit and postal code fields (a customer's file). Without them, a unit typed or pasted with the
      address (« 3-1250 rue Graham ») still goes to value.unit, and a postal code in the address to value.postal_code. */
  details?: boolean;
  id?: string; 'data-testid'?: string;
}

export function AddressField(p: AddressFieldProps) {
  const f = useAddressField(p.value, p.onValue);
  const { v, st } = f;
  const base = useId();
  const id = p.id || `${base}-a`;
  const listId = `${base}-l`;
  useFocusOnMount(p.autoFocus, () => document.getElementById(id));

  // suggestions opened by « Chercher » close when the person taps elsewhere
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!st.open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) f.dispatch({ type: 'close' }); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [st.open]);

  const onInput = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    const kind = (e as InputEvent).inputType || '';
    if (/^insertFrom(Paste|Drop)$|^insertReplacementText$/.test(kind)) f.paste(el.value);
    else f.type(el.value);
  };
  // a pasted address keeps its line breaks here (an input drops them): « 180-8255 av. Mountain Sights⏎Montréal, QC H4P 2B5 »
  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLInputElement;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? el.value.length;
    f.paste(el.value.slice(0, a) + text + el.value.slice(b));
  };
  const onKey = (e: KeyboardEvent) => {
    if (st.open && st.items.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); f.dispatch({ type: 'move', by: 1 }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); f.dispatch({ type: 'move', by: -1 }); return; }
      if (e.key === 'Enter') { e.preventDefault(); f.pick(st.items[Math.max(0, st.active)]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); f.dispatch({ type: 'close' }); return; }
    } else if (e.key === 'ArrowDown' && st.items.length) { e.preventDefault(); f.dispatch({ type: 'openList' }); }
  };
  const clear = () => {
    f.clear();
    document.getElementById(id)?.focus();
  };

  const hasText = !!v.address.trim();
  const located = v.lat != null && v.lng != null;
  const picked = st.picked;
  let hint: ComponentChildren = null;
  if (st.status === 'busy') hint = <Spinner label={t('customers.address.searching')} />;
  else if (st.status === 'offline' && hasText && !located) hint = <span class="customers-hint is-warn"><CloudOff size={16} aria-hidden="true" />{t('customers.address.offline')}</span>;
  else if (st.status === 'none' && hasText && !located) hint = <span class="customers-hint is-warn">{t('customers.address.none')}</span>;
  else if (located && picked && !picked.exact) hint = <span class="customers-hint is-ok"><CircleCheck size={16} aria-hidden="true" />{t('customers.address.street')}</span>;
  else if (located) hint = <span class="customers-hint is-ok"><CircleCheck size={16} aria-hidden="true" />{t('customers.address.found')}</span>;
  else if (hasText && picked && !picked.exact) hint = <span class="customers-hint is-warn">{t('customers.address.streetNoPos')}</span>;
  else if (hasText && !st.open && !st.focused) {
    hint = (
      <span class="customers-hint is-warn">
        <MapPin size={16} aria-hidden="true" />
        <span class="grow">{hasDoor(v.address) ? t('customers.address.toFind') : t('customers.address.noCivic')}</span>
        <button type="button" class="btn btn-sm btn-secondary" onClick={f.find}>
          <Search size={16} aria-hidden="true" /><span class="btn-txt">{t('customers.address.find')}</span>
        </button>
      </span>
    );
  }

  const optId = (i: number) => `${base}-o${i}`;
  const listOpen = st.open && st.items.length > 0;
  return (
    <div ref={box} class="customers-address" data-testid={p['data-testid'] || 'address-field'}>
      <div class="field">
        <label class="field-label" for={id}>{p.label || t('customers.address.label')}</label>
        <span class="input-wrap">
          <input
            id={id} class="input" type="text" autoComplete="street-address" enterKeyHint="next" autoFocus={p.autoFocus}
            placeholder={t('customers.address.placeholder')} value={v.address} spellcheck={false}
            role="combobox" aria-autocomplete="list" aria-expanded={listOpen} aria-controls={listId}
            aria-activedescendant={listOpen ? optId(st.active) : undefined} aria-describedby={`${base}-h`}
            onInput={onInput} onPaste={onPaste} onKeyDown={onKey} onFocus={f.focus} onBlur={f.blur}
            data-testid="address-input"
          />
          {hasText && <button type="button" class="iconbtn" aria-label={t('customers.address.clear')} onClick={clear}><X /></button>}
        </span>
        {listOpen && (
          <ul class="customers-sugg" role="listbox" id={listId} aria-label={t('customers.address.suggestions')} data-testid="address-suggestions">
            {st.items.map((s, i) => (
              <li key={s.key} id={optId(i)} role="option" aria-selected={i === st.active} class={i === st.active ? 'is-active' : ''}
                onPointerDown={(e) => e.preventDefault()} onMouseEnter={() => f.dispatch({ type: 'hover', index: i })} onClick={() => f.pick(s)}>
                <MapPin size={18} aria-hidden="true" class={s.exact ? 'customers-sugg-pin' : 'customers-sugg-pin is-street'} />
                <span class="customers-sugg-txt"><b>{s.label}</b>{s.sub && <span>{s.sub}</span>}</span>
              </li>
            ))}
          </ul>
        )}
        <span id={`${base}-h`} class="customers-address-hint" aria-live="polite">{hint}</span>
      </div>
      {p.details && <PlaceDetails base={base} v={v} onDetail={f.detail} />}
    </div>
  );
}

/** « App., unité » and « Code postal » (a customer's file). The postal code is shown as typed until the person leaves
    the box, then written the Canada Post way, or marked when it is not one. */
function PlaceDetails(p: { base: string; v: PlaceValue; onDetail: (patch: Partial<PlaceValue>) => void }) {
  const postalId = `${p.base}-p`;
  const [postalText, setPostalText] = useState(p.v.postal_code || '');
  const [postalBad, setPostalBad] = useState(false);
  useEffect(() => { if (document.activeElement?.id !== postalId) setPostalText(p.v.postal_code || ''); }, [p.v.postal_code]);
  return (
    <div class="customers-address-row">
      <label class="field">
        <span class="field-label">{t('customers.address.unit')}<span class="faint">({t('common.optional')})</span></span>
        <input class="input" type="text" autoComplete="address-line2" value={p.v.unit || ''} placeholder={t('customers.address.unitPlaceholder')}
          onInput={(e) => p.onDetail({ unit: (e.currentTarget as HTMLInputElement).value || null })} data-testid="address-unit" />
      </label>
      <label class="field">
        <span class="field-label">{t('customers.address.postal')}</span>
        <input id={postalId} class="input customers-postal" type="text" autoComplete="postal-code" value={postalText} placeholder={t('customers.address.postalPlaceholder')} maxLength={7}
          aria-invalid={postalBad || undefined} onInput={(e) => { const s = (e.currentTarget as HTMLInputElement).value; setPostalText(s); setPostalBad(false); p.onDetail({ postal_code: s.trim() ? s : null }); }}
          onBlur={() => { const s = postalText.trim(); if (!s) { setPostalBad(false); return; } const pc = postalCode(s); setPostalBad(!pc); if (pc) { setPostalText(pc); p.onDetail({ postal_code: pc }); } }}
          data-testid="address-postal" />
        {postalBad && <span class="field-error" role="alert">{t('customers.address.postalError')}</span>}
      </label>
    </div>
  );
}

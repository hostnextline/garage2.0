/* Form fields. Every input is controlled by a value and an onValue(newValue) callback.
   Text is 16 px in inputs so phones don't zoom; touch targets are 48 px. */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { Minus, Plus, Search, X } from 'lucide-preact';
import { parseMoney, moneyInput } from '../lib/money';
import { formatPhone } from '../lib/text';
import { lang, t } from '../lib/i18n';
import { Help } from './Help';

/* ---------- the label around a field ---------- */
export interface FieldProps {
  label: ComponentChildren; hint?: ComponentChildren; error?: ComponentChildren | null; optional?: boolean; help?: string;
  /** a group of buttons (Seg, Chips…) rather than one input: rendered as a fieldset */
  group?: boolean; class?: string; children: ComponentChildren; 'data-tour'?: string;
}
export function Field(p: FieldProps) {
  const head = (
    <span class="field-label">
      {p.label}
      {p.optional && <span class="faint">({t('common.optional')})</span>}
      {p.help && <Help text={p.help} />}
    </span>
  );
  const tail = (
    <>
      {p.error ? <span class="field-error" role="alert">{p.error}</span> : p.hint ? <span class="field-hint">{p.hint}</span> : null}
    </>
  );
  if (p.group) {
    return (
      <fieldset class={`field field-group ${p.class || ''}`} data-tour={p['data-tour']}>
        <legend class="field-label">{p.label}{p.optional && <span class="faint">({t('common.optional')})</span>}{p.help && <Help text={p.help} />}</legend>
        {p.children}
        {tail}
      </fieldset>
    );
  }
  return <label class={`field ${p.class || ''}`} data-tour={p['data-tour']}>{head}{p.children}{tail}</label>;
}

type InputBase = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onInput' | 'size' | 'label' | 'icon'>;
export interface InputProps extends InputBase {
  value: string | number | null | undefined;
  onValue: (v: string) => void;
  invalid?: boolean;
  onEnter?: () => void;
}
/** autoFocus only works on the first page load of an app like this one: focus the field when it appears */
function useAutoFocus<T extends HTMLElement>(on: boolean | undefined) {
  const ref = useRef<T>(null);
  useEffect(() => { if (on) { const el = ref.current; if (el) requestAnimationFrame(() => el.focus({ preventScroll: true })); } }, []);
  return ref;
}
export function Input({ value, onValue, invalid, onEnter, class: cls, ...rest }: InputProps) {
  const ref = useAutoFocus<HTMLInputElement>(!!rest.autoFocus);
  return (
    <input
      ref={ref}
      {...rest}
      class={`input ${cls || ''}`}
      value={value == null ? '' : String(value)}
      aria-invalid={invalid || undefined}
      onInput={(e) => onValue((e.currentTarget as HTMLInputElement).value)}
      onKeyDown={(e) => { if (onEnter && e.key === 'Enter') { e.preventDefault(); onEnter(); } (rest.onKeyDown as ((ev: KeyboardEvent) => void) | undefined)?.(e); }}
    />
  );
}

/** a text input with a button inside it (show password, clear, scan…) */
export function InputWithButton(p: InputProps & { button: ComponentChildren }) {
  const { button, ...rest } = p;
  return <span class="input-wrap"><Input {...rest} />{button}</span>;
}

export interface TextareaProps extends Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onInput' | 'rows'> { value: string | null | undefined; onValue: (v: string) => void; rows?: number }
export function Textarea({ value, onValue, class: cls, rows = 3, ...rest }: TextareaProps) {
  const ref = useAutoFocus<HTMLTextAreaElement>(!!rest.autoFocus);
  return <textarea ref={ref} {...rest} rows={rows} class={`textarea ${cls || ''}`} value={value ?? ''} onInput={(e) => onValue((e.currentTarget as HTMLTextAreaElement).value)} />;
}

export interface Option<V extends string = string> { value: V; label: ComponentChildren; disabled?: boolean; hint?: ComponentChildren }
export interface SelectProps<V extends string> { value: V | null | undefined; onValue: (v: V) => void; options: Option<V>[]; placeholder?: string; disabled?: boolean; class?: string; id?: string; 'aria-label'?: string }
export function Select<V extends string>(p: SelectProps<V>) {
  return (
    <select class={`select ${p.class || ''}`} id={p.id} aria-label={p['aria-label']} disabled={p.disabled} value={p.value ?? ''}
      onChange={(e) => p.onValue((e.currentTarget as HTMLSelectElement).value as V)}>
      {p.placeholder != null && <option value="" disabled>{p.placeholder}</option>}
      {p.options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{typeof o.label === 'string' ? o.label : String(o.value)}</option>)}
    </select>
  );
}

/** amounts in cents. Accepts "59,99", "59.99", "59 $"; shows "59,99" (fr) or "59.99" (en) once left. */
export interface MoneyInputProps { cents: number | null | undefined; onCents: (c: number | null) => void; allowNegative?: boolean; placeholder?: string; disabled?: boolean; id?: string; 'aria-label'?: string; autoFocus?: boolean; invalid?: boolean }
export function MoneyInput(p: MoneyInputProps) {
  const [text, setText] = useState(() => moneyInput(p.cents, lang.value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(moneyInput(p.cents, lang.value)); }, [p.cents, lang.value]);
  const commit = (s: string) => {
    let c = parseMoney(s);
    if (c != null && c < 0 && !p.allowNegative) c = -c;
    p.onCents(s.trim() === '' ? null : c);
    return c;
  };
  return (
    <span class="input-wrap input-money-wrap">
      <input
        class="input input-money" inputMode="decimal" id={p.id} aria-label={p['aria-label']} placeholder={p.placeholder ?? (lang.value === 'en' ? '0.00' : '0,00')}
        disabled={p.disabled} autoFocus={p.autoFocus} aria-invalid={p.invalid || (text.trim() !== '' && parseMoney(text) == null) || undefined} value={text}
        onFocus={(e) => { focused.current = true; (e.currentTarget as HTMLInputElement).select(); }}
        onInput={(e) => { const s = (e.currentTarget as HTMLInputElement).value; setText(s); commit(s); }}
        onBlur={() => { focused.current = false; const c = commit(text); setText(c == null ? text : moneyInput(c, lang.value)); }}
      />
      <span class="input-unit" aria-hidden="true">$</span>
    </span>
  );
}

/** a North American phone number, cleaned when the field is left ("514 555-1234") */
export function PhoneInput(p: { value: string | null | undefined; onValue: (v: string) => void; id?: string; invalid?: boolean; autoFocus?: boolean; placeholder?: string }) {
  return (
    <input class="input" type="tel" inputMode="tel" autoComplete="tel" id={p.id} autoFocus={p.autoFocus} placeholder={p.placeholder ?? '514 555-1234'}
      aria-invalid={p.invalid || undefined} value={p.value ?? ''}
      onInput={(e) => p.onValue((e.currentTarget as HTMLInputElement).value)}
      onBlur={(e) => { const v = (e.currentTarget as HTMLInputElement).value; const f = formatPhone(v); if (f !== v) p.onValue(f); }} />
  );
}

export function SearchInput(p: {
  value: string; onValue: (v: string) => void; placeholder?: string; autoFocus?: boolean; id?: string; 'data-tour'?: string; 'data-testid'?: string;
  onKeyDown?: (e: KeyboardEvent) => void; 'aria-controls'?: string; 'aria-activedescendant'?: string; 'aria-expanded'?: boolean; role?: 'combobox' | 'searchbox';
}) {
  const ref = useAutoFocus<HTMLInputElement>(p.autoFocus);
  return (
    <span class="input-wrap search" data-tour={p['data-tour']}>
      <Search class="search-icon" aria-hidden="true" />
      <input ref={ref} class="input" type="search" enterKeyHint="search" id={p.id} autoFocus={p.autoFocus} placeholder={p.placeholder ?? t('common.search')}
        aria-label={p.placeholder ?? t('common.search')} value={p.value} onInput={(e) => p.onValue((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={p.onKeyDown} role={p.role} aria-controls={p['aria-controls']} aria-activedescendant={p['aria-activedescendant']} aria-expanded={p['aria-expanded']}
        data-testid={p['data-testid']} />
      {p.value && <button type="button" class="iconbtn" aria-label={t('common.close')} onClick={() => p.onValue('')}><X /></button>}
    </span>
  );
}

export function Check(p: { checked: boolean; onChange: (v: boolean) => void; label: ComponentChildren; hint?: ComponentChildren; disabled?: boolean; 'data-testid'?: string }) {
  return (
    <label class="check">
      <input type="checkbox" checked={p.checked} disabled={p.disabled} data-testid={p['data-testid']} onChange={(e) => p.onChange((e.currentTarget as HTMLInputElement).checked)} />
      <span class="grow"><span>{p.label}</span>{p.hint && <span class="field-hint" style={{ display: 'block' }}>{p.hint}</span>}</span>
    </label>
  );
}

export function Switch(p: { checked: boolean; onChange: (v: boolean) => void; label: ComponentChildren; hint?: ComponentChildren; disabled?: boolean; 'data-testid'?: string }) {
  const id = useId();
  return (
    <div class="switch-row">
      <label class="grow" for={id}>
        <span class="switch-label">{p.label}</span>
        {p.hint && <span class="field-hint" style={{ display: 'block' }}>{p.hint}</span>}
      </label>
      <button id={id} type="button" role="switch" class="switch" aria-checked={p.checked} disabled={p.disabled} data-testid={p['data-testid']} onClick={() => p.onChange(!p.checked)} />
    </div>
  );
}

/** a short choice of 2–5 options shown side by side */
export function Seg<V extends string>(p: { value: V | null | undefined; onValue: (v: V) => void; options: Option<V>[]; label?: string; class?: string; 'data-testid'?: string }) {
  return (
    <div class={`seg ${p.class || ''}`} role="group" aria-label={p.label} data-testid={p['data-testid']}>
      {p.options.map((o) => (
        <button key={o.value} type="button" aria-pressed={p.value === o.value} disabled={o.disabled} onClick={() => p.onValue(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** tappable choices (one, or several with multiple) */
export function Chips<V extends string>(p: { options: Option<V>[]; value: V[]; onValue: (v: V[]) => void; multiple?: boolean; label?: string; 'data-testid'?: string }) {
  const toggle = (v: V) => {
    if (!p.multiple) { p.onValue(p.value.includes(v) ? [] : [v]); return; }
    p.onValue(p.value.includes(v) ? p.value.filter((x) => x !== v) : [...p.value, v]);
  };
  return (
    <div class="chips" role="group" aria-label={p.label} data-testid={p['data-testid']}>
      {p.options.map((o) => (
        <button key={o.value} type="button" class="chip" aria-pressed={p.value.includes(o.value)} disabled={o.disabled} onClick={() => toggle(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** − value + (durations, quantities) */
export function Stepper(p: { value: number; onValue: (v: number) => void; step?: number; min?: number; max?: number; format?: (v: number) => ComponentChildren; label: string }) {
  const step = p.step ?? 1, min = p.min ?? -Infinity, max = p.max ?? Infinity;
  const set = (v: number) => p.onValue(Math.min(max, Math.max(min, Math.round(v * 1000) / 1000)));
  return (
    <div class="stepper" role="group" aria-label={p.label}>
      <button type="button" class="btn btn-secondary btn-sm" aria-label={`${p.label} −`} disabled={p.value - step < min} onClick={() => set(p.value - step)}><Minus /></button>
      <output aria-live="polite">{p.format ? p.format(p.value) : p.value}</output>
      <button type="button" class="btn btn-secondary btn-sm" aria-label={`${p.label} +`} disabled={p.value + step > max} onClick={() => set(p.value + step)}><Plus /></button>
    </div>
  );
}

/** a calendar day (YYYY-MM-DD) */
export function DateInput(p: { value: string | null | undefined; onValue: (v: string) => void; min?: string; max?: string; id?: string; 'aria-label'?: string }) {
  return <input class="input" type="date" id={p.id} aria-label={p['aria-label']} min={p.min} max={p.max} value={p.value ?? ''} onInput={(e) => p.onValue((e.currentTarget as HTMLInputElement).value)} />;
}

/** a form that never reloads the page; Enter in a field submits */
export function Form(p: { onSubmit: () => unknown; children: ComponentChildren; class?: string; id?: string }) {
  return <form class={p.class} id={p.id} noValidate onSubmit={(e) => { e.preventDefault(); void p.onSubmit(); }}>{p.children}</form>;
}

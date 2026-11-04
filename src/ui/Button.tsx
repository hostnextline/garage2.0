/* Buttons. An onClick that returns a promise shows a spinner until it is done (no double taps).
   confirm="…": the first tap arms the button and shows that text; the second tap (within 4 s) does the action. */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Clickable = (e: MouseEvent) => unknown;

function useAsyncClick(onClick: Clickable | undefined, confirm: string | undefined, blocked: boolean) {
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; if (timer.current) clearTimeout(timer.current); }, []);
  const click = async (e: MouseEvent) => {
    if (busy || blocked) { e.preventDefault(); return; }
    if (confirm && !armed) {
      e.preventDefault();
      setArmed(true);
      timer.current = setTimeout(() => alive.current && setArmed(false), 4000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    if (!onClick) return;
    const r = onClick(e) as Promise<unknown> | unknown;
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      setBusy(true);
      try { await r; } catch { /* the action shows its own message */ } finally { if (alive.current) setBusy(false); }
    }
  };
  return { busy, armed, click };
}

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  block?: boolean;
  icon?: ComponentChildren;
  iconEnd?: ComponentChildren;
  busy?: boolean;
  disabled?: boolean;
  confirm?: string;
  type?: 'button' | 'submit';
  onClick?: Clickable;
  href?: string;
  target?: string;
  download?: string;
  class?: string;
  title?: string;
  label?: string;           // accessible name when the text is not enough
  form?: string;
  id?: string;
  children?: ComponentChildren;
  'data-tour'?: string;
  'data-testid'?: string;
}
export function Button(p: ButtonProps) {
  const { busy, armed, click } = useAsyncClick(p.onClick, p.confirm, !!p.disabled);
  const isBusy = !!p.busy || busy;
  const cls = ['btn', `btn-${armed ? 'danger' : p.variant || 'secondary'}`, p.size === 'sm' && 'btn-sm', p.block && 'btn-block', armed && 'is-armed', p.class]
    .filter(Boolean).join(' ');
  const inner = (
    <>
      {isBusy ? <span class="spin" aria-hidden="true" /> : p.icon}
      <span class="btn-txt">{armed ? p.confirm : p.children}</span>
      {p.iconEnd}
    </>
  );
  const common = {
    class: cls, title: p.title, id: p.id, 'aria-label': p.label, 'aria-busy': isBusy || undefined,
    'data-tour': p['data-tour'], 'data-testid': p['data-testid'], 'aria-live': (p.confirm ? 'polite' : undefined) as JSX.AriaAttributes['aria-live']
  };
  if (p.href && !p.disabled) {
    return <a {...common} href={p.href} target={p.target} download={p.download} rel={p.target === '_blank' ? 'noopener' : undefined} onClick={p.onClick || p.confirm ? click : undefined}>{inner}</a>;
  }
  return <button {...common} type={p.type || 'button'} form={p.form} disabled={p.disabled} onClick={click}>{inner}</button>;
}

export interface IconButtonProps { icon: ComponentChildren; label: string; onClick?: Clickable; href?: string; class?: string; disabled?: boolean; confirm?: string; pressed?: boolean; 'data-tour'?: string; 'data-testid'?: string }
export function IconButton(p: IconButtonProps) {
  const { busy, armed, click } = useAsyncClick(p.onClick, p.confirm, !!p.disabled);
  const cls = ['iconbtn', armed && 'is-armed', p.class].filter(Boolean).join(' ');
  const label = armed && p.confirm ? p.confirm : p.label;
  if (p.href) return <a class={cls} href={p.href} aria-label={label} title={label} data-tour={p['data-tour']} data-testid={p['data-testid']} onClick={p.onClick ? click : undefined}>{p.icon}</a>;
  return (
    <button type="button" class={cls} aria-label={label} title={label} aria-pressed={p.pressed} disabled={p.disabled} aria-busy={busy || undefined}
      data-tour={p['data-tour']} data-testid={p['data-testid']} onClick={click}>
      {busy ? <span class="spin" aria-hidden="true" /> : p.icon}
    </button>
  );
}

/** the one obvious next step of a screen: signal red in a chrome ring, like an engine start button */
export interface BigStepProps { icon: ComponentChildren; label: ComponentChildren; sub?: ComponentChildren; onClick?: Clickable; href?: string; disabled?: boolean; confirm?: string; 'data-tour'?: string; 'data-testid'?: string }
export function BigStep(p: BigStepProps) {
  const { busy, armed, click } = useAsyncClick(p.onClick, p.confirm, !!p.disabled);
  const inner = (
    <>
      <span class="bigstep-ring" aria-hidden="true">{busy ? <span class="spin" /> : p.icon}</span>
      <span class="bigstep-txt">
        <span class="bigstep-label">{armed ? p.confirm : p.label}</span>
        {p.sub && !armed && <span class="bigstep-sub">{p.sub}</span>}
      </span>
    </>
  );
  if (p.href && !p.disabled) return <a class="bigstep" href={p.href} data-tour={p['data-tour']} data-testid={p['data-testid']}>{inner}</a>;
  return <button type="button" class={`bigstep${armed ? ' is-armed' : ''}`} disabled={p.disabled} aria-busy={busy || undefined} onClick={click} data-tour={p['data-tour']} data-testid={p['data-testid']}>{inner}</button>;
}

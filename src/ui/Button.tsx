/* Buttons. An onClick that returns a promise shows a spinner until it is done; the button cannot fire twice (the rules:
   tapGuard.ts). confirm="…": the first tap arms the button and shows that text; a second tap within 4 s does the action,
   but never the second tap of a double tap (the armed button waits a moment, marked aria-disabled meanwhile).
   The guard's pauses are invisible (fluidite-01): aria-disabled tells a test robot to wait, and data-tap-wait keeps the
   faded look of a disabled button away (components.css), so nothing on screen changes, as on live.
   An action that fails without showing its own message is reported and said in a toast: nothing fails in silence. */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { actionFailed } from './actionFailed';
import { createTapGuard, tapPauses, CONFIRM_MS } from './tapGuard';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Clickable = (e: MouseEvent) => unknown;

/* the last time anything was typed in the app: typing between two taps means they are not a double tap */
let lastInputAt = 0;
if (typeof document !== 'undefined') document.addEventListener('input', () => { lastInputAt = Date.now(); }, true);

function useTap(onClick: Clickable | undefined, confirm: string | undefined, blocked: boolean, hold = 0) {
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  // the dead time of an armed button, or of a button that just appeared (`hold`): taps are ignored, the button says so
  const [waiting, setWaiting] = useState(hold > 0);
  const props = useRef({ onClick, confirm, blocked });
  props.current = { onClick, confirm, blocked };
  const [guard] = useState(() => createTapGuard({ confirm: () => !!props.current.confirm, blocked: () => props.current.blocked, lastInputAt: () => lastInputAt }));
  const born = useRef(Date.now());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alive = useRef(true);
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(() => { if (alive.current) fn(); }, ms)); };
  useEffect(() => {
    if (hold > 0) later(() => setWaiting(false), hold);
    return () => { alive.current = false; for (const tm of timers.current) clearTimeout(tm); };
  }, []);
  const click = async (e: MouseEvent) => {
    const now = Date.now();
    if (hold > 0 && now - born.current < hold) { e.preventDefault(); return; }
    const verdict = guard.tap(now);
    if (verdict === 'ignore') { e.preventDefault(); return; }
    if (verdict === 'arm') {
      e.preventDefault();
      const at = guard.armedAt;
      setArmed(true);
      if (tapPauses().armDead > 0) { setWaiting(true); later(() => setWaiting(false), tapPauses().armDead); }
      later(() => { if (guard.armedAt === at) { guard.disarm(); setArmed(false); } }, CONFIRM_MS);
      return;
    }
    if (armed) setArmed(false);
    const fn = props.current.onClick;
    if (!fn) return;
    let r: unknown;
    try { r = fn(e); } catch (err) { failed(err); return; }
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      guard.start();
      setBusy(true);
      try { await r; } catch (err) { failed(err); } finally {
        guard.settle(Date.now());
        // the cool-down is marked aria-disabled + data-tap-wait: nothing changes on screen, a test robot waits for its end
        if (alive.current) { setBusy(false); if (tapPauses().cool > 0) { setWaiting(true); later(() => setWaiting(false), tapPauses().cool); } }
      }
    }
  };
  return { busy, armed, waiting, click };
}
/** a pause of the tap guard: aria-disabled for a test robot (and a screen reader), data-tap-wait so the CSS never fades
    the button meanwhile (a disabled one still fades) */
function waitAttrs(waiting: boolean): { 'aria-disabled'?: true; 'data-tap-wait'?: '' } {
  return waiting ? { 'aria-disabled': true, 'data-tap-wait': '' } : {};
}
/** an action that threw past its own handling: kept in the error log and told in the person's words */
const failed = (err: unknown) => actionFailed(err, 'button');

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
  /** ignore taps for this long after the button appears (the answers of a question that just came) */
  hold?: number;
  children?: ComponentChildren;
  'data-tour'?: string;
  'data-testid'?: string;
}
export function Button(p: ButtonProps) {
  // the busy prop blocks too: it used to draw a spinner while taps still went through
  const { busy, armed, waiting, click } = useTap(p.onClick, p.confirm, !!p.disabled || !!p.busy, p.hold);
  const isBusy = !!p.busy || busy;
  const self = useRef<HTMLElement | null>(null);
  // the armed text must not shrink the button: a neighbour would slide under the finger
  const [keepW, setKeepW] = useState<number | null>(null);
  useEffect(() => { if (!armed) setKeepW(null); }, [armed]);
  const onTap = (e: MouseEvent) => {
    if (p.confirm && !armed && self.current) setKeepW(self.current.getBoundingClientRect().width || null);
    return click(e);
  };
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
    class: cls, title: p.title, id: p.id, 'aria-label': p.label, 'aria-busy': isBusy || undefined, ...waitAttrs(waiting),
    style: armed && keepW ? { minWidth: `${keepW}px` } : undefined,
    'data-tour': p['data-tour'], 'data-testid': p['data-testid'], 'aria-live': (p.confirm ? 'polite' : undefined) as JSX.AriaAttributes['aria-live']
  };
  if (p.href && !p.disabled) {
    return <a ref={(el) => { self.current = el; }} {...common} href={p.href} target={p.target} download={p.download} rel={p.target === '_blank' ? 'noopener' : undefined} onClick={p.onClick || p.confirm ? onTap : undefined}>{inner}</a>;
  }
  return <button ref={(el) => { self.current = el; }} {...common} type={p.type || 'button'} form={p.form} disabled={p.disabled} onClick={onTap}>{inner}</button>;
}

export interface IconButtonProps { icon: ComponentChildren; label: string; onClick?: Clickable; href?: string; class?: string; disabled?: boolean; confirm?: string; pressed?: boolean; 'data-tour'?: string; 'data-testid'?: string }
export function IconButton(p: IconButtonProps) {
  const { busy, armed, waiting, click } = useTap(p.onClick, p.confirm, !!p.disabled);
  const cls = ['iconbtn', armed && 'is-armed', p.class].filter(Boolean).join(' ');
  const label = armed && p.confirm ? p.confirm : p.label;
  if (p.href) return <a class={cls} href={p.href} aria-label={label} title={label} data-tour={p['data-tour']} data-testid={p['data-testid']} onClick={p.onClick ? click : undefined}>{p.icon}</a>;
  return (
    <button type="button" class={cls} aria-label={label} title={label} aria-pressed={p.pressed} disabled={p.disabled} aria-busy={busy || undefined} {...waitAttrs(waiting)}
      data-tour={p['data-tour']} data-testid={p['data-testid']} onClick={click}>
      {busy ? <span class="spin" aria-hidden="true" /> : p.icon}
    </button>
  );
}

/** the one obvious next step of a screen: signal red in a chrome ring, like an engine start button */
export interface BigStepProps { icon: ComponentChildren; label: ComponentChildren; sub?: ComponentChildren; onClick?: Clickable; href?: string; disabled?: boolean; confirm?: string; 'data-tour'?: string; 'data-testid'?: string }
export function BigStep(p: BigStepProps) {
  const { busy, armed, waiting, click } = useTap(p.onClick, p.confirm, !!p.disabled);
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
  return <button type="button" class={`bigstep${armed ? ' is-armed' : ''}`} disabled={p.disabled} aria-busy={busy || undefined} {...waitAttrs(waiting)} onClick={click} data-tour={p['data-tour']} data-testid={p['data-testid']}>{inner}</button>;
}

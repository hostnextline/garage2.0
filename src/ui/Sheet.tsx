/* Sheets: a panel that rises from the bottom on the phone and opens as a window on the computer.
   - The phone's back button (Android) closes the sheet instead of leaving the screen: the sheet owns one history step
     (platform/history). A sheet that only its buttons may close (dismissable={false}: a signature in progress) keeps
     its step when the back button is pressed, and ignores Escape and the dimmed area.
   - The dimmed area closes the sheet only when the press AND the release are on it: closing on the press let the click
     of that same tap land on what was under the finger once the sheet was gone (Android).
   - After a sheet closes, an invisible shield takes taps for a moment (the second tap of a double tap).
   ask() / askText(): ./ask.tsx. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { X } from 'lucide-preact';
import { t } from '../lib/i18n';
import { openLayer } from '../platform/history';
import { onEscape } from '../platform/escape';
import { raiseShield } from './shield';

export { whenHistorySettled } from '../platform/history';

let openCount = 0;
function lockScroll(on: boolean) {
  openCount = Math.max(0, openCount + (on ? 1 : -1));
  document.documentElement.classList.toggle('is-locked', openCount > 0);
}
let seq = 0;

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ComponentChildren;
  sub?: ComponentChildren;
  wide?: boolean;
  footer?: ComponentChildren;
  children?: ComponentChildren;
  /** false: only the buttons close it (a signature in progress…) */
  dismissable?: boolean;
  'data-tour'?: string;
  'data-testid'?: string;
}
export function Sheet(p: SheetProps) {
  if (!p.open) return null;
  return <SheetOpen {...p} />;
}
function SheetOpen(p: SheetProps) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;
  const dismissable = p.dismissable !== false;
  // read live: a signature started after the sheet opened makes it non-dismissable from then on
  const dismissableRef = useRef(dismissable);
  dismissableRef.current = dismissable;
  const pressedOnBack = useRef(false);
  const [id] = useState(() => `sheet${++seq}`);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    lockScroll(true);
    const layer = openLayer((why) => {
      if (why === 'back' && !dismissableRef.current) return false;
      closeRef.current();
    });
    const leaveEscape = onEscape(() => { if (dismissableRef.current) closeRef.current(); });
    const first = box.current?.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), select, textarea, button:not(.sheet-x)');
    (first || box.current)?.focus({ preventScroll: true });
    return () => {
      leaveEscape();
      lockScroll(false);
      layer.release();
      raiseShield();
      before?.focus?.({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div class="sheet-back"
      onPointerDown={(e) => { pressedOnBack.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        const both = pressedOnBack.current && e.target === e.currentTarget;
        pressedOnBack.current = false;
        if (both && dismissableRef.current) p.onClose();
      }}>
      <div ref={box} class={`sheet glass-strong${p.wide ? ' sheet-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabIndex={-1}
        data-tour={p['data-tour']} data-testid={p['data-testid']}>
        <span class="sheet-grip" aria-hidden="true" />
        <div class="sheet-head">
          <div class="grow">
            <h2 id={`${id}-t`}>{p.title}</h2>
            {p.sub && <p class="muted small" style={{ margin: '4px 0 0' }}>{p.sub}</p>}
          </div>
          {dismissable && <button type="button" class="iconbtn sheet-x" aria-label={t('common.close')} onClick={() => p.onClose()}><X /></button>}
        </div>
        <div class="sheet-body">{p.children}</div>
        {p.footer && <div class="sheet-foot">{p.footer}</div>}
      </div>
    </div>,
    document.body
  );
}

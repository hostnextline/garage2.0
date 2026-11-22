/* The « ? » bubble: a short explanation in simple words, next to a label or a title.
   Under the button, or above it when the screen has no room left below (inside a sheet the page cannot scroll to it).
   Escape closes the bubble alone (not the sheet it sits in): platform/escape. */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { t } from '../lib/i18n';
import { onEscape } from '../platform/escape';

/** where the bubble goes: under the button, above it when it would end below the screen (pure: tested) */
export function bubbleTop(o: { btnTop: number; btnBottom: number; popH: number; viewH: number; scrollY: number; gap?: number }): number {
  const gap = o.gap ?? 8;
  const below = o.btnBottom + gap;
  const fitsBelow = below + o.popH <= o.viewH - gap;
  const above = o.btnTop - gap - o.popH;
  return (fitsBelow || above < gap ? below : above) + o.scrollY;
}

export function Help(p: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 300 });
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(320, window.innerWidth - 32);
    const left = Math.max(16, Math.min(window.innerWidth - width - 16, r.left + r.width / 2 - width / 2));
    const popH = pop.current?.getBoundingClientRect().height || 0;
    setPos({ top: bubbleTop({ btnTop: r.top, btnBottom: r.bottom, popH, viewH: window.innerHeight, scrollY: window.scrollY }), left: left + window.scrollX, width });
  };
  // once drawn, its height is known: placed again (above when needed) before the screen shows it
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (pop.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const leaveEscape = onEscape(() => setOpen(false));
    document.addEventListener('pointerdown', close, true);
    window.addEventListener('resize', place);
    return () => { leaveEscape(); document.removeEventListener('pointerdown', close, true); window.removeEventListener('resize', place); };
  }, [open]);
  return (
    <>
      <button ref={btn} type="button" class="help" aria-expanded={open} aria-label={p.label || t('common.help')}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}>?</button>
      {open && createPortal(
        <div ref={pop} class="help-pop glass-strong" role="note" style={{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` }}>
          {p.text.split('\n').map((line, i) => <p key={i} style={{ margin: i ? '6px 0 0' : 0 }}>{line}</p>)}
        </div>,
        document.body
      )}
    </>
  );
}

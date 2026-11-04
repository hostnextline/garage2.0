/* The « ? » bubble: a short explanation in simple words, next to a label or a title. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { t } from '../lib/i18n';

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
    setPos({ top: r.bottom + window.scrollY + 8, left: left + window.scrollX, width });
  };
  useEffect(() => {
    if (!open) return;
    place();
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'pointerdown' && (pop.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close);
    window.addEventListener('resize', place);
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', close); window.removeEventListener('resize', place); };
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

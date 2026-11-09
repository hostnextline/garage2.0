/* The right-click menu of the agenda (and a long press on Android): a few actions next to the mouse. One menu at a
   time, hosted once on the agenda; closes on a choice, a click elsewhere, Escape, a scroll or a resize. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { signal } from '@preact/signals';

export interface MenuAction { key: string; label: string; icon?: ComponentChildren; run: () => void; testid?: string }
interface Open { x: number; y: number; title?: string; actions: MenuAction[] }
const menu = signal<Open | null>(null);

/** opens the menu where the person right-clicked (nothing to offer: the browser's own menu stays) */
export function openMenu(e: MouseEvent, actions: MenuAction[], title?: string) {
  if (!actions.length) return;
  e.preventDefault();
  e.stopPropagation();
  menu.value = { x: e.clientX, y: e.clientY, title, actions };
}
export function closeMenu() { menu.value = null; }

export function ContextMenuHost() {
  const m = menu.value;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!m) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) closeMenu(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    box.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [m]);
  if (!m) return null;
  // stays on the screen: near the right or bottom edge, it opens to the left or upward
  const w = 260, h = 56 * m.actions.length + (m.title ? 40 : 12);
  const left = Math.max(8, Math.min(m.x, window.innerWidth - w - 8));
  const top = Math.max(8, Math.min(m.y, window.innerHeight - h - 8));
  return (
    <div ref={box} class="agenda-menu glass-strong" role="menu" aria-label={m.title} style={{ left: `${left}px`, top: `${top}px` }} data-testid="agenda-menu"
      onContextMenu={(e) => e.preventDefault()}>
      {m.title && <div class="agenda-menu-title">{m.title}</div>}
      {m.actions.map((a) => (
        <button key={a.key} type="button" role="menuitem" class="agenda-menu-item" data-testid={a.testid}
          onClick={() => { closeMenu(); a.run(); }}>
          {a.icon}<span>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

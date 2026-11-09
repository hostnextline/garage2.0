/* The menu of the agenda: a right-click on a computer, a long press (« appui long ») on a phone, iPhone included (Safari
   never sends a right-click: the press is timed here). A few actions next to the finger or the mouse. One menu at a
   time, hosted once on the agenda; closes on a choice, a tap elsewhere, Escape, a scroll or a resize. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { signal } from '@preact/signals';

export interface MenuAction { key: string; label: string; icon?: ComponentChildren; run: () => void; testid?: string; /** a thin line above (a new group) */ sep?: boolean; danger?: boolean }
interface Open { x: number; y: number; title?: string; actions: MenuAction[] }
const menu = signal<Open | null>(null);

/** opens the menu where the person right-clicked (nothing to offer: the browser's own menu stays) */
export function openMenu(e: MouseEvent, actions: MenuAction[], title?: string) {
  if (!actions.length) return;
  e.preventDefault();
  e.stopPropagation();
  // Android also sends a right-click after a long press: the menu is open already
  if (Date.now() - lastPress < 1200) return;
  menu.value = { x: e.clientX, y: e.clientY, title, actions };
}
export function openMenuAt(x: number, y: number, actions: MenuAction[], title?: string) {
  if (actions.length) menu.value = { x, y, title, actions };
}

/* ---------- the long press ---------- */
export const PRESS_MS = 500;
const MOVE_PX = 10;
let timer: ReturnType<typeof setTimeout> | null = null;
let from: { x: number; y: number } | null = null;
let lastPress = 0;
const stop = () => { if (timer) clearTimeout(timer); timer = null; from = null; };
/** touch handlers for an element: held still for half a second, `onPress` gets the point (the innermost element wins:
    a ticket inside a block opens the ticket's menu); the tap that follows the release opens nothing */
export function pressProps(onPress: (x: number, y: number) => boolean | void) {
  return {
    onTouchStart: (e: TouchEvent) => {
      const ev = e as TouchEvent & { __press?: boolean };
      if (ev.__press || e.touches.length !== 1) { if (e.touches.length !== 1) stop(); return; }
      ev.__press = true;
      stop();
      const t = e.touches[0];
      from = { x: t.clientX, y: t.clientY };
      timer = setTimeout(() => {
        const at = from;
        stop();
        if (!at) return;
        if (onPress(at.x, at.y) === false) return;
        lastPress = Date.now();
        try { navigator.vibrate?.(12); } catch { /* no vibration */ }
      }, PRESS_MS);
    },
    onTouchMove: (e: TouchEvent) => {
      const t = e.touches[0];
      if (from && t && Math.hypot(t.clientX - from.x, t.clientY - from.y) > MOVE_PX) stop();
    },
    onTouchEnd: () => { if (timer) stop(); },
    onTouchCancel: () => stop(),
    // the finger lifted after the menu opened: that tap does not open the appointment
    onClickCapture: (e: MouseEvent) => { if (Date.now() - lastPress < 900) { e.preventDefault(); e.stopPropagation(); } }
  };
}
export function closeMenu() { menu.value = null; }

export function ContextMenuHost() {
  const m = menu.value;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!m) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) closeMenu(); };
    // the page may still be moving when the menu opens (the list brought into view, a phone's scroll momentum): a scroll
    // closes the menu only after a short moment
    const opened = Date.now();
    const scrolled = () => { if (Date.now() - opened > 400) closeMenu(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', closeMenu);
    box.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [m]);
  if (!m) return null;
  // stays on the screen: near the right or bottom edge, it opens to the left or upward
  const w = 260, h = Math.min(window.innerHeight - 16, 48 * m.actions.length + (m.title ? 40 : 12));
  const left = Math.max(8, Math.min(m.x, window.innerWidth - w - 8));
  const top = Math.max(8, Math.min(m.y, window.innerHeight - h - 8));
  return (
    <div ref={box} class="agenda-menu glass-strong" role="menu" aria-label={m.title} style={{ left: `${left}px`, top: `${top}px` }} data-testid="agenda-menu"
      onContextMenu={(e) => e.preventDefault()}>
      {m.title && <div class="agenda-menu-title">{m.title}</div>}
      {m.actions.map((a) => (
        <button key={a.key} type="button" role="menuitem" class={`agenda-menu-item${a.sep ? ' is-sep' : ''}${a.danger ? ' is-danger' : ''}`} data-testid={a.testid}
          onClick={() => { closeMenu(); a.run(); }}>
          {a.icon}<span>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

/* The room the map takes on the screen. Stage: the space under the title down to the bottom of the screen (phone: under
   the bottom bar too). PullUp (phone): the list rises from the bottom, by a tap or a drag on its handle. */
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { ChevronUp, ChevronDown } from 'lucide-preact';
import { t } from '../../lib/i18n';

export function Stage(p: { wide: boolean; children: ComponentChildren }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = el.current;
    if (!box) return;
    const set = () => {
      const top = Math.max(0, Math.round(box.getBoundingClientRect().top + (window.scrollY || 0)));
      box.style.setProperty('--stage-top', `${top}px`);
    };
    set();
    window.addEventListener('resize', set);
    // the title and the frame's banners can grow (a long day name, « pas de signal »): the stage follows
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
    const head = box.parentElement?.querySelector('.page-head');
    const banners = document.querySelector('.shell-banners');
    if (ro && head) ro.observe(head);
    if (ro && banners) ro.observe(banners);
    return () => { window.removeEventListener('resize', set); ro?.disconnect(); };
  }, [p.wide]);
  return <div ref={el} class={`map-stage${p.wide ? ' is-wide' : ''}`}>{p.children}</div>;
}

/** a drag of the handle longer than that opens or closes the list; shorter, it is a tap */
const DRAG_PX = 18;

export function PullUp(p: { open: boolean; onOpen: (v: boolean) => void; summary: string; status: string; warn?: boolean; card: ComponentChildren; children: ComponentChildren }) {
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  return (
    <section class={`map-pull glass-strong${p.open ? ' is-open' : ''}`} aria-label={p.summary} data-testid="map-pull">
      {/* closed, the legend is not in the page: the guided tour points at the handle that opens it */}
      <button type="button" class="map-pull-handle" aria-expanded={p.open} data-testid="map-pull-handle" data-tour={p.open ? undefined : 'map-legend'}
        aria-label={p.open ? t('map.pull.close') : t('map.pull.open')}
        onPointerDown={(e) => { drag.current = { y: e.clientY, moved: false }; dragged.current = false; }}
        onPointerMove={(e) => { const d = drag.current; if (d && Math.abs(e.clientY - d.y) > DRAG_PX) d.moved = true; }}
        onPointerUp={(e) => {
          const d = drag.current; drag.current = null;
          if (d && d.moved) { dragged.current = true; const dy = e.clientY - d.y; if (dy < -DRAG_PX) p.onOpen(true); else if (dy > DRAG_PX) p.onOpen(false); }
        }}
        onPointerCancel={() => { drag.current = null; }}
        onClick={() => { if (dragged.current) { dragged.current = false; return; } p.onOpen(!p.open); }}>
        <span class="map-grip" aria-hidden="true" />
        <span class="grow map-pull-sum">
          <b>{p.summary}</b>
          <span class={`small ${p.warn ? 'map-warn' : 'muted'}`}>{p.status}</span>
        </span>
        {p.open ? <ChevronDown size={22} aria-hidden="true" /> : <ChevronUp size={22} aria-hidden="true" />}
      </button>
      {p.card && <div class="map-pull-card">{p.card}</div>}
      {p.open && <div class="map-pull-body stack">{p.children}</div>}
    </section>
  );
}

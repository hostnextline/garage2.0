/* « La fenêtre vitrée »: the usual week of a truck as panes of glass, 30 minutes each, from 6 h to 22 h.
   Paint with a finger or the mouse: the first pane touched decides (light up or put out), the rectangle between it and
   the pointer follows. Computer: the 7 days side by side. Phone: one day, one hour per row (two half-hour panes).
   Keyboard: arrows move, Space or Enter lights a pane. The thick lines are the limits of the blocks. */
import { useRef, useState } from 'preact/hooks';
import { t, lang } from '../../lib/i18n';
import { clock, parseDay, type Range } from '../../lib/dates';
import { blocks } from '../../data/select';
import { UNITS, FROM, TO, STEP, DOWS, isOn, paintRect, togglePane, panesToRanges, type Panes } from './grid';
import { rangesWords } from './words';

export interface HoursGridProps {
  panes: Panes;
  onPanes: (p: Panes) => void;
  /** the truck's colour lights the panes */
  color: string;
  truckName: string;
  editable: boolean;
  /** computer: the whole week; phone: the day `day` (dow) */
  week: boolean;
  day: number;
  /** the days that will not be applied (one day only): shown dimmed */
  dim?: number[];
  /** the days changed and not applied yet */
  changed?: number[];
}

// a Sunday, to name the weekdays
const SUNDAY = '2026-11-01';
export function weekdayName(d: number, l: string, style: 'long' | 'short' = 'long'): string {
  const day = parseDay(SUNDAY); day.setDate(day.getDate() + d);
  return new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: style }).format(day).replace('.', '');
}

export function HoursGrid(p: HoursGridProps) {
  const l = lang.value;
  const cols = p.week ? DOWS : [p.day];
  const grid = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ d: number; u: number; on: boolean; base: Panes } | null>(null);
  const last = useRef<string>('');
  const [focus, setFocus] = useState<{ d: number; u: number }>({ d: cols[0], u: 8 * 60 });
  const fd = cols.includes(focus.d) ? focus.d : cols[0];

  /* ---------- painting ---------- */
  const spotOf = (el: Element | null): { d: number; u: number } | null => {
    const c = el?.closest?.('[data-u]') as HTMLElement | null;
    if (!c || !grid.current?.contains(c)) return null;
    return { d: Number(c.dataset.d), u: Number(c.dataset.u) };
  };
  const down = (e: PointerEvent) => {
    if (!p.editable || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const s = spotOf(e.target as Element);
    if (!s) return;
    e.preventDefault();
    const on = !isOn(p.panes, s.d, s.u);
    anchor.current = { ...s, on, base: p.panes };
    last.current = `${s.d}|${s.u}`;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setFocus(s);
    p.onPanes(paintRect(p.panes, s, s, on, cols));
  };
  const move = (e: PointerEvent) => {
    const a = anchor.current;
    if (!a) return;
    const s = spotOf(document.elementFromPoint(e.clientX, e.clientY));
    if (!s) return;
    const k = `${s.d}|${s.u}`;
    if (k === last.current) return;
    last.current = k;
    p.onPanes(paintRect(a.base, a, s, a.on, cols));
  };
  const up = () => { anchor.current = null; last.current = ''; };

  /* ---------- keyboard ---------- */
  const key = (e: KeyboardEvent) => {
    const s = spotOf(e.target as Element);
    if (!s) return;
    const ci = cols.indexOf(s.d);
    let { d, u } = s;
    const rowStep = p.week ? STEP : 60;
    if (e.key === 'ArrowDown') u = Math.min(TO - STEP, u + rowStep);
    else if (e.key === 'ArrowUp') u = Math.max(FROM, u - rowStep);
    else if (e.key === 'ArrowRight') { if (p.week) d = cols[Math.min(cols.length - 1, ci + 1)]; else u = Math.min(TO - STEP, u + STEP); }
    else if (e.key === 'ArrowLeft') { if (p.week) d = cols[Math.max(0, ci - 1)]; else u = Math.max(FROM, u - STEP); }
    else if (e.key === 'Home') u = FROM;
    else if (e.key === 'End') u = TO - STEP;
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (p.editable) p.onPanes(togglePane(p.panes, d, u)); return; }
    else return;
    e.preventDefault();
    setFocus({ d, u });
    grid.current?.querySelector<HTMLElement>(`[data-d="${d}"][data-u="${u}"]`)?.focus();
  };

  /* ---------- drawing ---------- */
  const bl = blocks.value;
  const edges = new Set(bl.flatMap((b) => [b.start, b.end]));
  const rowMinutes = p.week ? STEP : 60;
  const rows = UNITS.filter((u) => (u - FROM) % rowMinutes === 0);
  const paneLabel = (d: number, u: number, on: boolean) => t('hours.grid.pane', { day: weekdayName(d, l), from: clock(u, l), to: clock(u + STEP, l), state: on ? t('hours.grid.on') : t('hours.grid.off') });
  const cell = (d: number, u: number) => {
    const on = isOn(p.panes, d, u);
    const dim = p.dim?.includes(d);
    return (
      <span key={`${d}-${u}`} role="gridcell" class={`hours-pane${on ? ' is-on' : ''}${dim ? ' is-dim' : ''}${u % 60 === 30 ? ' is-half' : ''}`}
        data-d={d} data-u={u} aria-selected={on} aria-label={paneLabel(d, u, on)} tabIndex={d === fd && u === focus.u ? 0 : -1} />
    );
  };
  return (
    <div ref={grid} class={`hours-grid ${p.week ? 'is-week' : 'is-day'}${p.editable ? ' is-editable' : ''}`} style={{ '--tc': p.color }}
      role="grid" aria-label={t('hours.grid.label', { truck: p.truckName })} aria-multiselectable="true" aria-readonly={!p.editable || undefined}
      aria-describedby="hours-keys" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onKeyDown={key}
      data-tour="hours-grid" data-testid="hours-grid">
      <p id="hours-keys" class="sr-only">{t('hours.grid.keys')}</p>
      {p.week && (
        <div role="row" class="hours-row hours-head">
          <span role="columnheader" class="hours-corner"><span class="sr-only">{t('common.time')}</span></span>
          {cols.map((d) => {
            const rs: Range[] = panesToRanges(p.panes[d] || []);
            const changed = p.changed?.includes(d);
            return (
              <span role="columnheader" key={d} class={`hours-colhd${p.dim?.includes(d) ? ' is-dim' : ''}${changed ? ' is-changed' : ''}`}>
                <b>{weekdayName(d, l, 'short')}</b>
                <span class="hours-colhd-sum" title={rangesWords(rs, l)}>{rangesWords(rs, l, true)}</span>
                {changed && <span class="hours-changed-dot" title={t('hours.grid.changedDay')}><span class="sr-only">{t('hours.grid.changedDay')}</span></span>}
              </span>
            );
          })}
        </div>
      )}
      <div class="hours-body" style={{ '--rows': rows.length }}>
        {rows.map((u) => (
          <div role="row" key={u} class={`hours-row${edges.has(u) ? ' is-edge' : ''}${u % 60 === 0 ? ' is-hour' : ''}`}>
            <span role="rowheader" class="hours-time">{u % 60 === 0 ? clock(u, l) : <span class="sr-only">{clock(u, l)}</span>}</span>
            {p.week ? cols.map((d) => cell(d, u)) : [cell(p.day, u), cell(p.day, u + STEP)]}
          </div>
        ))}
        <div class="hours-edge-last" aria-hidden="true" style={{ display: edges.has(TO) ? undefined : 'none' }} />
        <div class="hours-rail" aria-hidden="true">
          {bl.filter((b) => b.end > FROM && b.start < TO).map((b) => {
            const a = Math.max(b.start, FROM), z = Math.min(b.end, TO);
            return (
              <span key={b.key} class="hours-rail-block" style={{ top: `calc(var(--hrow) * ${(a - FROM) / rowMinutes})`, height: `calc(var(--hrow) * ${(z - a) / rowMinutes})` }}>
                <span>{t(`common.blocks.${b.key}`)}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

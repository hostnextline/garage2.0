/* The time calendar of the booking screen on a computer (« Plages d'arrivée »): the hours on the left, one line per
   15 minutes, one column per day. In each column: the appointments already booked (light blocks at their planned
   arrival), the units where this booking can arrive (green), the others hatched. A unit = an arrival time: resting
   the mouse on it says the window told to the customer, draws it down the column and opens the real map of that day
   with the new stop in a window beside the picker (it stays open, and follows, while the mouse goes from a time to the
   next); a click chooses it. The maths is in units.ts and agenda/grid.ts; WindowPicker builds the days. */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal, memo } from 'preact/compat';
import { ChevronLeft, ChevronRight, Route } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { clock, longDay, nowMinute, parseDay, type Day, type Range } from '../../lib/dates';
import { unitCount, unitIndex, unitMinutes, unitsAt } from '../../domain/moment/grid';
import { moveFocus, type UnitState, type Win } from '../../domain/moment/units';
import { RouteHover, type PreviewAsk } from './RoutePreview';
import { floatPlace, floatStyle, LABEL_H, type FloatAt, type Rect } from './place';
import { useFinePointer, groupBox, HOVER_MS, SWITCH_MS, GRACE_MS } from './hooks';
import type { GridDay } from './windowDays';

export type { GridDay, GridJob, DayKind } from './windowDays';
export { floatPlace };
export interface PickGridProps {
  span: Range; days: GridDay[]; today: Day;
  /** the day whose switch and buttons are under the calendar */
  selDay: Day | null; onDay: (d: Day) => void;
  onUnit: (d: Day, m: number, state: UnitState) => void;
  /** a right-click anywhere on a day (a unit of any state, a booked stop, the day's name): the day and the time under the pointer */
  onDayMenu?: (e: MouseEvent, d: Day, m: number | null) => void;
  /** « Arrivée vers 14 h 15 · dit au client : 13 h 15 à 17 h 15 » */
  labelOf: (m: number) => string;
  unitLabel: (d: Day, m: number, state: UnitState) => string;
  dayLabel: (d: GridDay) => string;
  winOf: (m: number) => Win;
  /** the day's route with the new stop at that time (null: no position, no map) */
  askOf: (d: Day, m: number) => PreviewAsk | null;
  range: string; canPrev: boolean; canNext: boolean; onPrev: () => void; onNext: () => void;
  /** the unit to bring into view: asked for (`n` changes), else when the page's answers are in */
  goto: { m: number; n: number } | null; openAt: number | null; pageKey: string;
  hint: string;
  /** a refused unit may still be clicked (the owner, the office: the day anyway) */
  force: boolean;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** the focus came from the keyboard (not from a click) */
const byKeys = (el: HTMLElement) => { try { return el.matches(':focus-visible'); } catch { return false; } };

/* ---------- a day's column (drawn again only when the day changes, not at each move of the mouse) ---------- */
const Column = memo(function Column(p: { d: GridDay; span: Range; today: Day; tab: number | null; force: boolean; unitLabel: PickGridProps['unitLabel'] }) {
  const l = lang.value;
  const { d, span } = p;
  const now = d.day === p.today ? unitsAt(span, nowMinute()) : null;
  return (
    <div class={`pk-col is-${d.kind}${d.day === p.today ? ' is-today' : ''}${d.stale ? ' is-stale' : ''}${p.force ? ' can-force' : ''}`} data-day={d.day} aria-busy={d.kind === 'loading' || undefined}>
      {unitMinutes(span).map((m, i) => {
        const st = d.states[i];
        const on = d.chosen === m;
        const cls = `pk-u is-${st}${m % 60 === 0 ? ' is-hour' : m % 30 === 0 ? ' is-half' : ''}${on ? ' is-on' : ''}${d.best === m && !on ? ' is-best' : ''}`;
        const testid = `pick-unit-${d.day}-${m}`;
        if (st !== 'open' && st !== 'no') return <span key={m} class={cls} data-testid={testid} data-state={st} />;
        return (
          <button key={m} type="button" class={cls} data-d={d.day} data-m={m} data-state={st} data-time={clock(m, l)} tabIndex={p.tab === m ? 0 : -1}
            aria-pressed={on} aria-disabled={(st === 'no' && !p.force) || undefined} aria-label={p.unitLabel(d.day, m, st)} data-testid={testid} />
        );
      })}
      {d.band && <div class="pk-band is-on" style={{ top: `calc(var(--u) * ${(d.band[0] - span[0]) / 15})`, height: `calc(var(--u) * ${(d.band[1] - d.band[0]) / 15})` }} aria-hidden="true" data-testid={`pick-band-${d.day}`} data-kind="chosen" />}
      {d.jobs.map((j) => (
        <div key={j.id} class="pk-job" style={{ '--tc': j.color, top: `calc(var(--u) * ${j.top})`, height: `calc(var(--u) * ${j.height})`, left: `calc(${(j.col / j.cols) * 76}% + 2px)`, width: `calc(${76 / j.cols}% - 2px)` }}
          title={j.label} data-testid={`pick-job-${j.id}`}><span>{j.name}</span></div>
      ))}
      {d.current && (
        <div class="pk-current" style={{ top: `calc(var(--u) * ${d.current.top})`, height: `calc(var(--u) * ${d.current.height})` }} data-testid="pick-current"><span>{t('booking.win.grid.current')}</span></div>
      )}
      {now != null && <div class="pk-now" style={{ top: `calc(var(--u) * ${now})` }} aria-hidden="true" />}
    </div>
  );
}, (a, b) => a.d === b.d && a.tab === b.tab && a.span === b.span && a.today === b.today && a.force === b.force);

export function PickGrid(p: PickGridProps) {
  const l = lang.value;
  const { span, days } = p;
  const n = unitCount(span);
  const scroll = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);
  const wd = new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'short' });
  /* a touch screen wide enough for the grid (a tablet, a phone held sideways) sends mouse events after each tap: the words
     and the map would open under the finger and stay. Only a mouse that hovers gets them. */
  const mouse = useFinePointer(true);

  /* ---------- the unit under the mouse (or with the keyboard's focus): its words and its window at once, then the map ---------- */
  const [active, setActive] = useState<{ day: Day; m: number; at: FloatAt; by: 'mouse' | 'keys' } | null>(null);
  /* the time whose day the map window shows. It opens once the mouse rested on a time, follows it from a time to the
     next, and stays a moment after the mouse left the times (over a booked stop, between two columns) */
  const [mapAt, setMapAt] = useState<{ day: Day; m: number; item: Rect; group: Rect | null } | null>(null);
  const opener = useRef<number | undefined>(undefined);
  const closer = useRef<number | undefined>(undefined);
  const mapOpen = useRef(false);
  mapOpen.current = !!mapAt;
  const unitOf = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest?.('[data-m]') as HTMLElement | null;
    return el ? { el, day: el.dataset.d as Day, m: Number(el.dataset.m), state: el.dataset.state as UnitState } : null;
  };
  const show = (u: NonNullable<ReturnType<typeof unitOf>>, by: 'mouse' | 'keys') => {
    clearTimeout(closer.current);
    if (active && active.day === u.day && active.m === u.m) return;
    const r = u.el.getBoundingClientRect();
    const c = (u.el.parentElement as HTMLElement).getBoundingClientRect();
    setActive({ day: u.day, m: u.m, by, at: floatPlace(r, c, window.innerWidth, window.innerHeight, LABEL_H) });
    // the map never covers the column of the time pointed at
    const next = { day: u.day, m: u.m, item: { left: c.left, right: c.right, top: r.top, bottom: r.bottom }, group: groupBox(u.el) };
    clearTimeout(opener.current);
    opener.current = window.setTimeout(() => setMapAt(next), mapOpen.current ? SWITCH_MS : HOVER_MS);
  };
  /** no time is pointed at any more: its words go at once, the map a moment later */
  const leave = () => {
    clearTimeout(opener.current);
    setActive(null);
    if (!mapOpen.current) return;
    clearTimeout(closer.current);
    closer.current = window.setTimeout(() => setMapAt(null), GRACE_MS);
  };
  const hide = () => { clearTimeout(opener.current); clearTimeout(closer.current); setActive(null); setMapAt(null); };
  useEffect(() => () => { clearTimeout(opener.current); clearTimeout(closer.current); }, []);
  // the days changed under the pointer (another week, new answers): nothing is pointed at any more
  const stillOpen = (x: { day: Day; m: number } | null) => !x || days.some((d) => d.day === x.day && d.states[unitIndex(span, x.m)] === 'open');
  useEffect(() => { if (!stillOpen(active) || !stillOpen(mapAt)) hide(); }, [days]);
  const ask = mapAt ? p.askOf(mapAt.day, mapAt.m) : null;
  const activeWin = active ? p.winOf(active.m) : null;

  /* ---------- keyboard: one tab stop, the arrows move ---------- */
  const [focus, setFocus] = useState<{ day: Day; m: number } | null>(null);
  const isButton = (d: GridDay | undefined, m: number) => { const s = d?.states[unitIndex(span, m)]; return s === 'open' || s === 'no'; };
  const chosenDay = days.find((d) => d.chosen != null);
  const firstOpen = days.find((d) => d.open.length > 0);
  const tab = focus && isButton(days.find((d) => d.day === focus.day), focus.m) ? focus
    : chosenDay ? { day: chosenDay.day, m: chosenDay.chosen! }
    : firstOpen ? { day: firstOpen.day, m: firstOpen.open[0] } : null;
  const onKey = (e: KeyboardEvent) => {
    const u = unitOf(e.target);
    if (!u) return;
    let at = { col: days.findIndex((d) => d.day === u.day), m: u.m };
    // over the units that take nothing (closed, past), to the next one that can hold the focus
    for (let i = 0; i < n; i++) {
      const next = moveFocus(span, days.length, at, e.key);
      if (!next) return;
      e.preventDefault();
      if (next.col === at.col && next.m === at.m) return;
      at = next;
      if (isButton(days[at.col], at.m)) break;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // that day has nothing at this hour: its nearest unit
        const d = days[at.col];
        const near = unitMinutes(span).filter((m) => isButton(d, m)).sort((a, b) => Math.abs(a - at.m) - Math.abs(b - at.m))[0];
        if (near == null) continue;
        at = { col: at.col, m: near };
        break;
      }
    }
    if (!isButton(days[at.col], at.m)) return;
    setFocus({ day: days[at.col].day, m: at.m });
    const el = cols.current?.querySelector<HTMLElement>(`[data-d="${days[at.col].day}"][data-m="${at.m}"]`);
    el?.focus();
  };

  /* ---------- the hours in view ---------- */
  const toUnit = (m: number) => {
    const el = scroll.current;
    const col = el?.querySelector<HTMLElement>('.pk-col');
    if (!el || !col) return;
    el.scrollTop = Math.max(0, unitIndex(span, m) - 2) * (col.offsetHeight / n);
  };
  const seen = useRef<{ goto: number | null; page: string }>({ goto: null, page: '' });
  useLayoutEffect(() => {
    if (p.goto && seen.current.goto !== p.goto.n) { seen.current = { goto: p.goto.n, page: p.pageKey }; toUnit(p.goto.m); return; }
    if (seen.current.page === p.pageKey || p.openAt == null) return;
    seen.current.page = p.pageKey;
    toUnit(p.openAt);
  });

  return (
    <div class="pk" style={{ '--cols': days.length, '--units': n }} data-testid="pick-grid" data-cols={days.length}>
      <div class="pk-bar">
        <button type="button" class="pk-nav" onClick={p.onPrev} disabled={!p.canPrev} aria-label={t('booking.win.grid.prev')} title={t('booking.win.grid.prev')} data-testid="pick-prev"><ChevronLeft size={20} aria-hidden="true" /></button>
        <span class="pk-range" aria-live="polite">{p.range}</span>
        <button type="button" class="pk-nav" onClick={p.onNext} disabled={!p.canNext} aria-label={t('booking.win.grid.next')} title={t('booking.win.grid.next')} data-testid="pick-next"><ChevronRight size={20} aria-hidden="true" /></button>
      </div>
      <div class="pk-head">
        <span />
        {days.map((d) => (
          <button key={d.day} type="button" class={`pk-dayhd is-${d.kind}${d.day === p.today ? ' is-today' : ''}${p.selDay === d.day ? ' is-sel' : ''}${d.far ? ' is-far' : ''}`} aria-pressed={p.selDay === d.day}
            aria-label={p.dayLabel(d)} title={p.dayLabel(d)} onClick={() => p.onDay(d.day)} onContextMenu={(e) => p.onDayMenu?.(e, d.day, null)} data-testid={`pick-day-${d.day}`}>
            <span class="pk-dayhd-wd">{d.day === p.today ? t('common.today') : wd.format(parseDay(d.day))}</span>
            <span class="pk-dayhd-num">{parseDay(d.day).getDate()}</span>
            {/* « garde-route »: a far day that can still be chosen shows the road mark of the legend (as the phone's chip) */}
            <span class="pk-dayhd-state">{d.kind === 'open' ? (d.far ? <Route size={11} aria-hidden="true" data-testid={`pick-day-far-${d.day}`} /> : ' ') : d.kind === 'loading' ? <span class="pk-spin" aria-hidden="true" /> : t(`booking.win.grid.state.${d.kind}`)}</span>
          </button>
        ))}
      </div>
      <div class="pk-scroll" ref={scroll} onScroll={() => { if (active ? active.by === 'mouse' : !!mapAt) hide(); }}>
        <div class="pk-body">
          <div class="pk-axis" aria-hidden="true">
            {unitMinutes(span).map((m) => <span key={m} class={m % 60 === 0 ? 'is-hour' : ''}>{m % 60 === 0 ? clock(m, l) : `:${String(m % 60).padStart(2, '0')}`}</span>)}
          </div>
          <div class="pk-cols" ref={cols} role="group" aria-label={t('booking.win.grid.title')} aria-describedby="pk-help"
            onContextMenu={(e) => {
              if (!p.onDayMenu) return;
              const col = (e.target as HTMLElement).closest<HTMLElement>('.pk-col[data-day]');
              if (!col) return;
              // the time under the pointer, whatever is drawn there (a closed unit, a booked stop, the band)
              const r = col.getBoundingClientRect();
              const n = Math.round((span[1] - span[0]) / 15);
              const i = Math.max(0, Math.min(n - 1, Math.floor(((e.clientY - r.top) / Math.max(1, r.height)) * n)));
              hide();
              p.onDayMenu(e, col.dataset.day as Day, span[0] + i * 15);
            }}
            onClick={(e) => { const u = unitOf(e.target); if (u) { setFocus({ day: u.day, m: u.m }); p.onUnit(u.day, u.m, u.state); } }}
            onMouseOver={mouse ? (e) => { const u = unitOf(e.target); if (u && u.state === 'open') show(u, 'mouse'); else if (active?.by === 'mouse') leave(); } : undefined}
            onMouseLeave={mouse ? () => { if (active?.by === 'mouse') leave(); } : undefined}
            onFocusCapture={(e) => { const u = unitOf(e.target); if (u && u.state === 'open' && byKeys(u.el)) show(u, 'keys'); }}
            onBlurCapture={() => { if (active?.by === 'keys') leave(); }}
            onKeyDown={onKey}>
            {days.map((d) => <Column key={d.day} d={d} span={span} today={p.today} tab={tab && tab.day === d.day ? tab.m : null} force={p.force} unitLabel={p.unitLabel} />)}
            {/* the unit pointed at: lit, its time in it, its window down the column */}
            {active && activeWin && (() => {
              const i = days.findIndex((d) => d.day === active.day);
              if (i < 0) return null;
              const x = { left: `${(i / days.length) * 100}%`, width: `${100 / days.length}%` };
              const own = days[i].band != null;
              return (
                <>
                  <div class="pk-band is-hover" style={{ ...x, top: `calc(var(--u) * ${(activeWin[0] - span[0]) / 15})`, height: `calc(var(--u) * ${(activeWin[1] - activeWin[0]) / 15})` }} aria-hidden="true"
                    data-testid={own ? 'pick-band-hover' : `pick-band-${active.day}`} data-kind="hover" />
                  <div class="pk-lit" style={{ ...x, top: `calc(var(--u) * ${unitIndex(span, active.m)})` }} aria-hidden="true">{clock(active.m, l)}</div>
                </>
              );
            })()}
          </div>
        </div>
      </div>
      <p id="pk-help" class="sr-only">{t('booking.win.grid.help')}</p>
      <ul class="pk-legend" aria-hidden="true">
        <li><span class="pk-sw is-open" />{t('booking.win.grid.legend.open')}</li>
        <li><span class="pk-sw is-no" />{t('booking.win.grid.legend.no')}</li>
        <li><span class="pk-sw is-job" />{t('booking.win.grid.legend.job')}</li>
        <li><span class="pk-sw is-off" />{t('booking.win.grid.legend.off')}</li>
        {days.some((d) => d.best != null) && <li><span class="pk-star">★</span>{t('booking.win.grid.best')}</li>}
        {days.some((d) => d.far) && <li data-testid="pick-legend-far"><span class="bp-swatch is-far"><Route size={11} /></span>{t('booking.far.legend')}</li>}
      </ul>
      <p class="pk-hint">{p.hint}</p>
      {/* the words of the unit pointed at, beside its column; then the real map of that day, which says them in its title
          (the words would sit on the map: it opens beside the picker, where they are) */}
      {active && !ask && createPortal(<div class="bp-hover-map is-label" style={floatStyle(active.at)} role="tooltip" data-testid="pick-label"><p class="bp-hover-when">{p.labelOf(active.m)}</p></div>, document.body)}
      {ask && mapAt && <RouteHover ask={ask} at={mapAt.item} group={mapAt.group} title={`${cap(longDay(mapAt.day, l))} · ${p.labelOf(mapAt.m)}`} />}
    </div>
  );
}

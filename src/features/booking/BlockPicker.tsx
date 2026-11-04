/* Choose the day and block: the best suggestions near the address first (they need the network), then a two-week
   calendar coloured by the room left (works with the copy on the phone). Shared: booking, moving a job. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CalendarCheck, Check, ChevronLeft, ChevronRight, MapPin, RefreshCw, Sparkles } from 'lucide-preact';
import { today as todayOf, addDays, daysBetween, tinyDay, longDay, duration, clockRange, isValidDay, type BlockKey } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';
import { blocks, blockLoad, settings } from '../../data/select';
import { suggestBlocks } from '../../data/api';
import { net, isNetworkError } from '../../data/sync';
import { Banner, Button, Pill, Skeleton } from '../../ui';
import { cellState, type CellState } from './logic';
import { blockPhrase, blockPhraseWithHours, spanEnds } from './when';
import './booking.css';

export interface BlockChoice { day: string; block: BlockKey; truck_id?: string | null }
export interface BlockPickerProps {
  lat: number | null; lng: number | null;
  /** minutes of work (driving is added by the planner) */
  duration: number;
  /** moving a job: leave it out of the counts */
  excludeJob?: string | null;
  value: BlockChoice | null;
  onPick: (c: BlockChoice) => void;
  /** optional: only this truck counts (a truck chosen by hand, a mechanic booking on his own truck) */
  truckId?: string | null;
}

type Suggestion = Awaited<ReturnType<typeof suggestBlocks>>[number];
type SuggState = { status: 'loading' | 'ok' | 'offline' | 'error'; list: Suggestion[] };
const PAGE = 14;
const keyOf = (day: string, block: string) => `${day}|${block}`;

export function BlockPicker(p: BlockPickerProps) {
  const l = lang.value;
  const today = todayOf();
  const horizon = Math.max(PAGE, Number(settings.value.booking.horizon_days) || 120);
  const lastDay = addDays(today, horizon);
  const bl = blocks.value;
  const drive = Number(settings.value.booking.unknown_min) || 20;
  const dur = Math.max(15, Math.round(p.duration || 60));

  /* ---------- suggestions (server) ---------- */
  const [sugg, setSugg] = useState<SuggState>({ status: 'loading', list: [] });
  const [retry, setRetry] = useState(0);
  const online = net.value.online;
  useEffect(() => {
    if (!online) { setSugg({ status: 'offline', list: [] }); return; }
    let alive = true;
    setSugg((s) => ({ status: 'loading', list: s.list }));
    const tm = setTimeout(async () => {
      try {
        const list = await suggestBlocks(p.lat, p.lng, dur, today, PAGE, p.excludeJob ?? null);
        if (!alive) return;
        const mine = p.truckId ? list.filter((x) => !x.truck || x.truck === p.truckId) : list;
        setSugg({ status: 'ok', list: mine.filter((x) => isValidDay(String(x.day))).slice(0, 6) });
      } catch (e) {
        if (alive) setSugg({ status: isNetworkError(e) ? 'offline' : 'error', list: [] });
      }
    }, 350);
    return () => { alive = false; clearTimeout(tm); };
  }, [p.lat, p.lng, dur, p.excludeJob, p.truckId, online, retry]);

  /* ---------- the calendar (device copy) ---------- */
  const [page, setPage] = useState(0);
  const pageOf = (day: string) => Math.max(0, Math.floor(daysBetween(today, day) / PAGE));
  // a block chosen from outside (address bar, a suggestion far away): show its page
  useEffect(() => { if (p.value && daysBetween(today, p.value.day) >= 0) setPage(pageOf(p.value.day)); }, [p.value?.day]);
  const start = addDays(today, page * PAGE);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < PAGE; i++) { const d = addDays(start, i); if (d > lastDay) break; out.push(d); }
    return out;
  }, [start, lastDay]);
  const cells = days.map((day) => ({
    day,
    blocks: bl.map((b) => {
      const load = blockLoad(day, b.key);
      const c = cellState(load, dur, drive, { truckId: p.truckId, exclude: p.excludeJob, unknownMin: drive });
      return { key: b.key, start: b.start, end: b.end, ...c };
    })
  }));
  const isPicked = (day: string, block: string) => !!p.value && p.value.day === day && p.value.block === block;
  const pickedCell = p.value ? (() => {
    const load = blockLoad(p.value.day, p.value.block);
    return cellState(load, dur, drive, { truckId: p.truckId, exclude: p.excludeJob, unknownMin: drive });
  })() : null;

  /* the selection is said out loud */
  const [said, setSaid] = useState('');
  const blockOf = (k: BlockKey) => bl.find((b) => b.key === k) || bl[0];
  const phrase = (day: string, k: BlockKey) => { const b = blockOf(k); return blockPhraseWithHours(day, k, b.start, b.end, today, l); };
  const pick = (day: string, block: BlockKey) => {
    p.onPick({ day, block });
    setSaid(t('booking.picker.chosen', { when: phrase(day, block) }));
  };

  /* keyboard: one tab stop in the calendar, arrows move */
  const grid = useRef<HTMLTableElement>(null);
  const flat = cells.flatMap((r) => r.blocks.map((c) => ({ day: r.day, block: c.key, state: c.state })));
  const focusable = flat.find((c) => isPicked(c.day, c.block)) || flat.find((c) => c.state !== 'closed' && c.state !== 'started') || flat[0];
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const currentKey = focusKey && flat.some((c) => keyOf(c.day, c.block) === focusKey) ? focusKey : focusable ? keyOf(focusable.day, focusable.block) : null;
  const onKey = (e: KeyboardEvent) => {
    const tgt = e.target as HTMLElement;
    const k = tgt?.dataset?.k;
    if (!k) return;
    const i = flat.findIndex((c) => keyOf(c.day, c.block) === k);
    const nb = bl.length;
    let j = i;
    if (e.key === 'ArrowRight') j = i + 1;
    else if (e.key === 'ArrowLeft') j = i - 1;
    else if (e.key === 'ArrowDown') j = i + nb;
    else if (e.key === 'ArrowUp') j = i - nb;
    else if (e.key === 'Home') j = i - (i % nb);
    else if (e.key === 'End') j = i - (i % nb) + nb - 1;
    else return;
    e.preventDefault();
    j = Math.max(0, Math.min(flat.length - 1, j));
    const nk = keyOf(flat[j].day, flat[j].block);
    setFocusKey(nk);
    grid.current?.querySelector<HTMLElement>(`[data-k="${nk}"]`)?.focus();
  };

  const stateWords = (state: CellState, left: number) => t(`booking.picker.stateLong.${state}`, { d: duration(left, l) });

  return (
    <div class="bp" data-testid="block-picker">
      <p class="sr-only" aria-live="polite">{said}</p>

      {/* what is chosen, said plainly */}
      <div class={`bp-chosen${p.value ? ' is-on' : ''}`} data-testid="bp-chosen">
        <CalendarCheck aria-hidden="true" />
        <span class="bp-chosen-txt">
          <span>{p.value ? t('booking.picker.chosen', { when: phrase(p.value.day, p.value.block) }) : t('booking.picker.nothing')}</span>
          <span class="bp-chosen-sub">{t('booking.picker.duration', { d: duration(dur, l) })}</span>
        </span>
      </div>
      {p.value && pickedCell?.state === 'full' && <Banner kind="warn">{t('booking.picker.fullWarn')}</Banner>}
      {p.value && pickedCell?.state === 'tight' && <Banner kind="info">{t('booking.picker.tightWarn')}</Banner>}

      {/* suggestions */}
      <section class="bp-sugg" aria-labelledby="bp-sugg-title">
        <div class="bp-head">
          <h3 id="bp-sugg-title" class="bp-title"><Sparkles size={18} aria-hidden="true" />{t('booking.picker.title')}</h3>
          {(sugg.status === 'error' || sugg.status === 'offline') && online && (
            <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => setRetry((n) => n + 1)}>{t('booking.picker.retry')}</Button>
          )}
        </div>
        {sugg.status === 'ok' && (p.lat == null || p.lng == null) && <p class="faint small bp-note"><MapPin size={14} aria-hidden="true" /> {t('booking.picker.noPosition')}</p>}
        {sugg.status === 'loading' && !sugg.list.length && <div class="bp-sugg-skel" aria-busy="true"><span class="sr-only">{t('booking.picker.loading')}</span><Skeleton h={52} lines={3} /></div>}
        {sugg.status === 'offline' && <p class="muted small bp-note">{t('booking.picker.offline')}</p>}
        {sugg.status === 'error' && <p class="muted small bp-note">{t('booking.picker.error')}</p>}
        {sugg.status === 'ok' && !sugg.list.length && <p class="muted small bp-note">{t('booking.picker.none', { d: duration(dur, l) })}</p>}
        {sugg.list.length > 0 && sugg.status !== 'offline' && sugg.status !== 'error' && (
          <div class={`bp-sugg-list${sugg.status === 'loading' ? ' is-stale' : ''}`} role="group" aria-label={t('booking.picker.title')}>
            {sugg.list.map((s, i) => {
              const on = isPicked(s.day, s.block);
              const bits = [
                p.lat != null && p.lng != null ? (s.drive_min <= 2 ? t('booking.picker.noDrive') : t('booking.picker.drive', { d: duration(s.drive_min, l) })) : '',
                t('booking.picker.near', { n: s.near }),
                s.left != null && s.left > 0 ? t('booking.picker.free', { d: duration(s.left, l) }) : ''
              ].filter(Boolean);
              if (bits[0]) bits[0] = bits[0].charAt(0).toUpperCase() + bits[0].slice(1);
              return (
                <button key={keyOf(s.day, s.block)} type="button" class={`bp-sugg-row${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => pick(s.day, s.block)} data-testid="bp-sugg">
                  <span class="bp-sugg-main">
                    {i === 0 && <span class="bp-best"><Pill tone="ok" dot={false}>{t('booking.picker.best')}</Pill></span>}
                    <span class="bp-sugg-title">{phrase(s.day, s.block)}</span>
                    <span class="bp-sugg-sub">{bits.join(', ')}</span>
                  </span>
                  <span class="bp-tick" aria-hidden="true">{on && <Check size={22} />}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* calendar */}
      <section class="bp-cal" aria-labelledby="bp-cal-title">
        <div class="bp-head">
          <h3 id="bp-cal-title" class="bp-title">{t('booking.picker.calendar')}</h3>
          <span class="faint small grow">{days.length ? t('booking.picker.range', spanEnds(days[0], days[days.length - 1], l, today)) : ''}</span>
        </div>
        <table class="bp-table" ref={grid} onKeyDown={onKey} aria-label={t('booking.picker.calendar')} aria-describedby="bp-cal-help">
          <thead>
            <tr>
              <th scope="col"><span class="sr-only">{t('common.date')}</span></th>
              {bl.map((b) => <th scope="col" key={b.key}><span class="bp-th">{t(`common.blocks.${b.key}`)}</span><span class="bp-th-hours">{clockRange(b.start, b.end, l)}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {cells.map((r) => {
              const allClosed = r.blocks.every((c) => c.state === 'closed' || c.state === 'started');
              const isToday = r.day === today;
              return (
                <tr key={r.day} class={`${allClosed ? 'is-closed-day' : ''}${isToday ? ' is-today' : ''}`}>
                  <th scope="row" class="bp-day"><span class="bp-day-name">{tinyDay(r.day, l)}</span>{isToday && <span class="bp-day-today">{t('common.today')}</span>}</th>
                  {r.blocks.map((c) => {
                    const k = keyOf(r.day, c.key);
                    const on = isPicked(r.day, c.key);
                    const off = c.state === 'closed' || c.state === 'started';
                    const label = t('booking.picker.cellLabel', { day: longDay(r.day, l), block: t(`common.blocks.${c.key}`).toLowerCase(), state: stateWords(c.state, c.left) });
                    return (
                      <td key={c.key}>
                        <button type="button" class={`bp-cell is-${c.state}${on ? ' is-on' : ''}`} data-k={k} tabIndex={k === currentKey ? 0 : -1}
                          aria-pressed={on} aria-disabled={off || undefined} aria-label={label} title={label}
                          onClick={() => { setFocusKey(k); if (!off) pick(r.day, c.key); }} data-testid={`bp-cell-${r.day}-${c.key}`}>
                          {on && <Check size={16} aria-hidden="true" />}
                          <span>{t(`booking.picker.state.${c.state}`, { d: duration(c.left, l) })}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p id="bp-cal-help" class="sr-only">{t('booking.picker.calendarHelp')}</p>
        <div class="bp-foot">
          <ul class="bp-legend" aria-hidden="true">
            {(['ok', 'tight', 'full', 'closed'] as const).map((s) => <li key={s}><span class={`bp-swatch is-${s}`} />{t(`booking.picker.legend.${s}`)}</li>)}
          </ul>
          <span class="row">
            {page > 0 && <Button size="sm" icon={<ChevronLeft />} onClick={() => setPage(page - 1)} data-testid="bp-earlier">{t('booking.picker.earlier')}</Button>}
            {addDays(start, PAGE) <= lastDay && <Button size="sm" iconEnd={<ChevronRight />} onClick={() => setPage(page + 1)} data-testid="bp-later">{t('booking.picker.later')}</Button>}
          </span>
        </div>
      </section>
    </div>
  );
}

/** « Demain matin, 8 h à 12 h » for a choice (used by the summary of the screens that show a choice) */
export function choiceWords(c: BlockChoice | null, l = lang.value): string {
  if (!c) return '';
  const b = blocks.value.find((x) => x.key === c.block);
  return b ? blockPhraseWithHours(c.day, c.block, b.start, b.end, todayOf(), l) : blockPhrase(c.day, c.block, todayOf(), l);
}

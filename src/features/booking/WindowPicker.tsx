/* (On live since 2026-11-15, SWITCHED ON by the owner the same day for a trial week, 15-minute steps. The switch « Plages d'arrivée
   de 4 heures » is in Réglages → Réservations: off = the blocks as before, nothing lost.)
    « Plages d'arrivée » (Part 25): choose the day and the ARRIVAL TIME of an appointment on a time calendar.
   On top, the best moments near the address (one per day, from the server). Then the calendar, 15 minutes per unit:
   - a computer (≥ 760 px): a time grid, one column per day, with the appointments already booked that day and the
     units where this booking can arrive (PickGrid);
   - a phone: a row of days, then the arrival times of the day chosen (PickList).
   A unit = an estimated arrival T; the customer is told the window `windowOf(T)` (an hour before, three after); the
   unit is possible when the server (`suggest_windows`, asked for each day shown) lists that window. Under the
   calendar, for the day chosen: « Flexible », and the day alone when it has no window to offer.
   Same props as the block picker: the booking screen and « Déplacer » use it through BlockPicker. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CalendarCheck, Check, MapPin, RefreshCw, Sparkles, Map as MapIcon, Car, Truck } from 'lucide-preact';
import { today as todayOf, addDays, longDay, duration, isValidDay, nowMinute, clock } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';
import { settings, job as jobRow, jobsOn, activeTrucks, daySpan, windowOf, blocks, truckRanges, truckColor } from '../../data/select';
import { suggestBlocks, type Suggestion } from '../../data/api';
import { net, isNetworkError } from '../../data/sync';
import { isOwner, hasRole } from '../../data/auth';
import { Banner, Button, Pill, Skeleton, Seg, Switch, ask, toast } from '../../ui';
import { suggWindow } from '../../domain/moment/logic';
import { openMenu, openMenuAt, pressProps } from '../../ui/ContextMenu';
import { jobBox, jobMinute, overlapColumns, workedUnits, unitCount, unitMinutes, unitIndex, unitMinute } from '../../domain/moment/grid';
import { jobPerson } from '../../domain/jobs/words';
import { roomy } from '../../platform/media';
import { RoutePreview, type PreviewAsk } from './RoutePreview';
import { DayRoute } from './DayRoute';
import { stopRank } from './preview';
import { fromDevice } from '../map/device';
import { spanEnds } from '../../domain/moment/words';
import { choiceWords, winLen, type BlockChoice, type BlockPickerProps } from '../../domain/moment/choice';
import { possibleUnits, rowsByStart, unitOfWindow, unitStates, pageDays, pageOf, lastPage, type Win } from '../../domain/moment/units';
import { useDayWindows } from './useDayWindows';
import { PickGrid, type GridDay, type DayKind } from './PickGrid';
import { PickList } from './PickList';
import './booking.css';

type Row = Suggestion & { win: Win };
type Status = 'loading' | 'ok' | 'offline' | 'error';
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** how many days fit side by side in the calendar's own width */
const colsFor = (w: number) => (w >= 560 ? 7 : w >= 420 ? 5 : 4);

export function WindowPicker(p: BlockPickerProps) {
  const l = lang.value;
  const today = todayOf();
  const horizon = Math.max(7, Number(settings.value.booking.horizon_days) || 120);
  const lastDay = addDays(today, horizon);
  const dur = Math.max(15, Math.round(p.duration || 60));
  const len = winLen();
  const span = daySpan.value;
  const online = net.value.online;
  const hasPos = p.lat != null && p.lng != null;
  const kindAsked = p.need ? null : p.kind ?? null;
  const ofTruck = <T extends { truck: string | null }>(list: T[]) => (p.truckId ? list.filter((x) => !x.truck || x.truck === p.truckId) : list);
  const list = (p.layout ?? (roomy.value ? 'grid' : 'list')) === 'list';

  /* ---------- the best moments: one per day, with its best window (server) ---------- */
  const [sugg, setSugg] = useState<{ status: Status; list: Row[] }>({ status: 'loading', list: [] });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!online) { setSugg({ status: 'offline', list: [] }); return; }
    let alive = true;
    setSugg((s) => ({ status: 'loading', list: s.list }));
    const tm = setTimeout(async () => {
      try {
        const got = await suggestBlocks(p.lat, p.lng, dur, today, 14, p.excludeJob ?? null, !!p.need, kindAsked);
        if (!alive) return;
        const rows: Row[] = [];
        for (const x of ofTruck(got)) {
          const win = isValidDay(String(x.day)) ? suggWindow(x, windowOf, len) : null;
          if (win) rows.push({ ...x, block: 'day', win });
        }
        setSugg({ status: 'ok', list: rows.slice(0, 3) });
      } catch (e) {
        if (alive) setSugg({ status: isNetworkError(e) ? 'offline' : 'error', list: [] });
      }
    }, 350);
    return () => { alive = false; clearTimeout(tm); };
  }, [p.lat, p.lng, dur, p.excludeJob, p.truckId, p.need, p.kind, online, retry, p.reload]);

  const kindOf = (truckId: string): 'car' | 'truck' => (activeTrucks.value.find((x) => x.id === truckId)?.tire_machine === false ? 'car' : 'truck');
  const bothKinds = activeTrucks.value.some((x) => x.tire_machine === false) && activeTrucks.value.some((x) => x.tire_machine !== false);

  /* ---------- the days shown ---------- */
  const root = useRef<HTMLDivElement>(null);
  const [n, setN] = useState(7);
  useLayoutEffect(() => {
    const el = root.current;
    if (list || !el || typeof ResizeObserver !== 'function') return;
    const fit = () => { const w = el.clientWidth; if (w > 0) setN(colsFor(w)); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [list]);
  const per = list ? 7 : n;
  /** the day whose « Flexible » switch and buttons are shown (on a phone: whose times are listed) */
  const [day, setDay] = useState<string | null>(() => p.value?.day ?? (p.openDay && p.openDay >= today ? p.openDay : null));
  const [first, setFirst] = useState<string>(() => (day && day >= today ? day : today));
  const page = pageOf(today, first, per);
  const days = useMemo(() => pageDays(today, lastDay, page, per), [today, lastDay, page, per]);
  const goTo = (d: string) => { if (d >= today && d <= lastDay) setFirst(d); };
  useEffect(() => { if (p.value) { setDay(p.value.day); goTo(p.value.day); } }, [p.value?.day]);

  /* ---------- what the server says of each day shown ---------- */
  const [bump, setBump] = useState(0);
  const winsOf = useDayWindows(days, { lat: p.lat, lng: p.lng, duration: dur, kind: kindAsked, need: !!p.need, exclude: p.excludeJob ?? null }, online, bump + (p.reload || 0));
  const again = () => { setRetry((x) => x + 1); setBump((x) => x + 1); };

  /* ---------- the days as the calendar draws them ---------- */
  const moving = p.excludeJob ? jobRow(p.excludeJob) : undefined;
  const trucks = activeTrucks.value.filter((tr) => (p.truckId ? tr.id === p.truckId : p.need || p.kind === 'truck' ? tr.tire_machine !== false : p.kind === 'car' ? tr.tire_machine === false : true));
  const now = nowMinute();
  const picked = p.value && p.value.block === 'day' && !p.value.win_flex && p.value.win_start != null ? p.value : null;
  const model = (d: string): GridDay & { possible: Map<number, Suggestion> } => {
    const w = winsOf(d);
    const known = w.status === 'ok' || (w.status === 'loading' && w.rows.length > 0);
    const possible = possibleUnits(span, ofTruck(w.rows), windowOf);
    const worked = trucks.map((tr) => workedUnits(truckRanges(tr.id, d), span)).reduce<boolean[]>((a, x) => a.map((v, k) => v || x[k]), Array(unitCount(span)).fill(false));
    const states = unitStates(span, { day: d, today, now, worked, possible: known ? possible : null });
    const open = unitMinutes(span).filter((_m, i) => states[i] === 'open');
    const kind: DayKind = states.every((s) => s === 'past') ? 'past' : !states.some((s) => s !== 'off' && s !== 'past') ? 'closed'
      : w.status === 'offline' || w.status === 'error' ? 'failed' : !known ? 'loading' : open.length ? 'open' : 'full';
    // the appointments already booked that day, at their planned arrival (the one being moved is left out)
    const placed = jobsOn(d).filter((j) => j.status !== 'cancelled' && j.status !== 'no_show' && j.id !== p.excludeJob)
      .map((j) => ({ j, at: jobMinute(j, blocks.value) })).filter((x): x is { j: typeof x.j; at: number } => x.at != null)
      .map((x) => ({ ...x, box: jobBox(span, x.at, x.j.duration_min, 1) }));
    const slots = overlapColumns(placed.map((x) => ({ id: x.j.id, start: x.box.top, end: x.box.top + x.box.height })));
    const jobs = placed.map((x) => {
      const name = jobPerson(x.j) || `#${x.j.number}`;
      const s = slots.get(x.j.id) || { col: 0, cols: 1 };
      return { id: x.j.id, top: x.box.top, height: x.box.height, col: s.col, cols: s.cols, color: truckColor(x.j.truck_id), name, label: t('booking.win.grid.job', { name, time: clock(x.at, l) }) };
    });
    const mine = picked && picked.day === d ? picked : null;
    const nowAt = moving && moving.day === d && moving.block === 'day' ? moving.eta_min ?? (moving.win_start != null ? unitOfWindow(span, moving.win_start, null, windowOf) : null) : null;
    const best = sugg.list.find((s) => s.day === d);
    return {
      day: d, status: w.status, stale: w.status === 'loading' && known, kind, states, open, windows: new Set(open.map((m) => windowOf(m)[0])).size, jobs, possible,
      current: nowAt != null ? jobBox(span, nowAt, moving!.duration_min, 1) : null, currentM: nowAt != null ? unitMinute(span, unitIndex(span, nowAt)) : null,
      chosen: mine ? unitOfWindow(span, mine.win_start!, mine.eta, windowOf) : null,
      band: mine ? [mine.win_start!, mine.win_end != null && mine.win_end > mine.win_start! ? mine.win_end : mine.win_start! + len] : null,
      best: best ? unitOfWindow(span, best.win[0], best.eta, windowOf) : null
    };
  };
  // drawn again only when something of the days changes (not while « Choisi » is announced, a map opens…)
  const sig = days.map((d) => { const w = winsOf(d); return `${d}:${w.status}:${w.rows.length}`; }).join('|');
  const models = useMemo(() => days.map(model), [sig, span[0], span[1], p.value, p.truckId, p.kind, p.need, p.excludeJob, sugg.list, l,
    Math.floor(now / 15), moving?.day, moving?.eta_min, moving?.win_start, days.map((d) => jobsOn(d).map((j) => `${j.id}${j.eta_min}${j.status}${j.truck_id}`).join()).join('|'), trucks.map((x) => x.id).join()]);
  const modelOf = (d: string | null) => models.find((x) => x.day === d) || null;

  /* ---------- choosing ---------- */
  const [said, setSaid] = useState('');
  const pick = (c: BlockChoice) => {
    p.onPick(c);
    setDay(c.day);
    setSaid(t('booking.picker.chosen', { when: choiceWords(c, l) }));
  };
  const labelOf = (m: number) => { const w = windowOf(m); return t('booking.win.grid.label', { time: clock(m, l), from: clock(w[0], l), to: clock(w[1], l) }); };
  /** an arrival time of the calendar: its window is the one told to the customer */
  const unitChoice = (d: string, m: number): BlockChoice => {
    const w = windowOf(m);
    return { day: d, block: 'day', win_start: w[0], win_end: w[1], eta: m, truck: modelOf(d)?.possible.get(m)?.truck ?? null };
  };
  const mayForce = isOwner() || hasRole('office');
  /** a time the server refuses: the owner and the office may take the day anyway (the app gives the window) */
  const refused = async (d: string, m: number) => {
    const time = clock(m, l);
    if (!mayForce) { toast(t('booking.win.grid.no', { time })); return; }
    const yes = await ask({ title: t('booking.win.grid.noTitle', { time }), text: t('booking.win.grid.noText'), ok: t('booking.win.grid.noOk'), cancel: t('booking.win.force.cancel') });
    if (yes) pick({ day: d, block: 'day' });
  };
  const [goto, setGoto] = useState<{ m: number; n: number } | null>(null);
  const suggChoice = (s: Row): BlockChoice => ({ day: s.day, block: 'day', win_start: s.win[0], win_end: s.win[1], eta: s.eta ?? null, truck: s.truck });
  const pickSugg = (s: Row) => {
    setHover(null);
    pick(suggChoice(s));
    goTo(s.day);
    const m = unitOfWindow(span, s.win[0], s.eta, windowOf);
    if (m != null) setGoto((g) => ({ m, n: (g?.n || 0) + 1 }));
  };
  const isPicked = (c: BlockChoice) => !!picked && picked.day === c.day && picked.win_start === c.win_start;
  // the window to go back to when « Flexible » is switched off
  const lastWin = useRef<BlockChoice | null>(null);
  if (picked) lastWin.current = picked;
  /* a phone lists one day's times: the day chosen, else the first day that has some */
  const shown = list ? (modelOf(day) ? day : (models.find((x) => x.open.length > 0) || models[0])?.day ?? null) : day;
  const sel = modelOf(shown);
  const here = !!p.value && p.value.day === shown && p.value.block === 'day';
  const flex = here && !!p.value!.win_flex;
  const auto = !!p.value && p.value.block === 'day' && !p.value.win_flex && p.value.win_start == null;
  const setFlex = (on: boolean) => {
    if (!shown) return;
    if (on) { pick({ day: shown, block: 'day', win_flex: true }); return; }
    const back = lastWin.current && lastWin.current.day === shown ? lastWin.current : null;
    if (back) pick(back);
    else if (p.onClear) { p.onClear(); setSaid(t('booking.win.picker.nothing')); }
    else pick({ day: shown, block: 'day' });
  };
  // a window chosen elsewhere (the agenda's grid, a paste) that the server no longer lists for this address
  const pickedDay = picked ? modelOf(picked.day) : null;
  const gone = !!picked && !!pickedDay && pickedDay.status === 'ok' && !rowsByStart(ofTruck(winsOf(picked.day).rows), windowOf).has(picked.win_start!);

  // it is taken off (the screen has nothing chosen again), and said until another time is chosen
  const [lost, setLost] = useState(false);
  useEffect(() => { if (gone) { setLost(true); p.onClear?.(); } }, [gone]);
  useEffect(() => { if (p.value) setLost(false); }, [p.value]);

  /* « Voir sur la carte »: the button under the moment chosen, a right-click or a long press on a moment */
  const [preview, setPreview] = useState<{ ask: PreviewAsk; choice: BlockChoice } | null>(null);
  const askOf = (c: BlockChoice, when = choiceWords(c, l)): PreviewAsk => ({ day: c.day, block: 'day', truckId: p.truckId || c.truck || null, lat: p.lat!, lng: p.lng!, name: '', address: p.address || '',
    when, exclude: p.excludeJob ?? null, eta: c.eta ?? null });
  const see = (c: BlockChoice) => setPreview({ choice: c, ask: askOf(c) });
  const actions = (c: BlockChoice) => [
    { key: 'pick', label: t('booking.preview.pick'), icon: <Check size={18} />, run: () => pick(c), testid: 'menu-pick' },
    ...(hasPos ? [{ key: 'map', label: t('booking.preview.see'), icon: <MapIcon size={18} />, run: () => see(c), testid: 'menu-see-map' }] : [])
  ];
  /* a right-click anywhere on a day of the calendar: « Voir sur la carte » (with the new stop at that time when the address
     is known and a time is under the pointer, else the day's routes as they are); « Choisir ce moment » on a possible time */
  const [dayMap, setDayMap] = useState<string | null>(null);
  const dayMenu = (e: MouseEvent, d: string, m: number | null) => {
    const open = m != null && !!modelOf(d)?.possible.has(m);
    const c = m != null ? unitChoice(d, m) : null;
    const day = longDay(d, l);
    const title = `${day.charAt(0).toUpperCase()}${day.slice(1)}${m != null ? `, ${clock(m, l)}` : ''}`;
    openMenu(e, [
      ...(open && c ? [{ key: 'pick', label: t('booking.preview.pick'), icon: <Check size={18} />, run: () => pick(c), testid: 'menu-pick' }] : []),
      { key: 'map', label: t('booking.preview.see'), icon: <MapIcon size={18} />, testid: 'menu-see-map',
        run: () => { if (hasPos && c) setPreview({ choice: c, ask: askOf(c, t('booking.win.grid.around', { time: clock(m!, l) })) }); else setDayMap(d); } }
    ], title);
  };
  const menuProps = (c: BlockChoice) => ({
    onContextMenu: (e: MouseEvent) => openMenu(e, actions(c), choiceWords(c, l)),
    ...pressProps((x, y) => { openMenuAt(x, y, actions(c), choiceWords(c, l)); })
  });
  /* the same map in a small window while the mouse rests on one of the best moments */
  const [hover, setHover] = useState<{ ask: PreviewAsk; left: number; top: number } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const hoverProps = (c: BlockChoice) => (!hasPos || typeof matchMedia !== 'function' || !matchMedia('(hover: hover) and (pointer: fine)').matches ? {} : {
    onMouseEnter: (e: MouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => {
        const w = 360, h = 330;
        // beside the row: on its left when there is room, else on its right; kept inside the window
        const left = r.left - w - 12 >= 8 ? r.left - w - 12 : Math.min(window.innerWidth - w - 8, r.right + 12);
        const top = Math.max(8, Math.min(window.innerHeight - h - 8, r.top - 40));
        setHover({ left, top, ask: askOf(c) });
      }, 350);
    },
    onMouseLeave: () => { clearTimeout(hoverTimer.current); setHover(null); }
  });
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  /* which stop of its route the appointment would be at each of the best moments (the phone's copy of the day) */
  const ranks = useMemo(() => sugg.list.map((s) => {
    if (p.lat == null || p.lng == null) return null;
    const d = fromDevice(s.day);
    const base = p.excludeJob ? { ...d, jobs: d.jobs.filter((j) => j.id !== p.excludeJob) } : d;
    return stopRank(base, { day: s.day, block: 'day', truckId: p.truckId || s.truck, lat: p.lat, lng: p.lng, name: '', address: '', eta: s.eta ?? null });
  }), [sugg.list, p.lat, p.lng, p.excludeJob, p.truckId]);

  /* ---------- words ---------- */
  const stateWord = (d: GridDay) => (d.kind === 'open' ? t('booking.win.grid.count', { n: d.windows }) : t(`booking.win.grid.state.${d.kind}`));
  const dayLabel = (d: GridDay) => t('booking.win.grid.day', { day: longDay(d.day, l), state: stateWord(d) });
  const unitLabel = (d: string, m: number, st: string = 'open') => {
    const w = windowOf(m);
    return st === 'no' ? t('booking.win.grid.unitNo', { day: longDay(d, l), time: clock(m, l) }) : t('booking.win.grid.unit', { day: longDay(d, l), time: clock(m, l), from: clock(w[0], l), to: clock(w[1], l) });
  };
  const canPrev = page > 0;
  const canNext = page < lastPage(today, lastDay, per);
  const nav = { canPrev, canNext, onPrev: () => goTo(addDays(today, (page - 1) * per)), onNext: () => goTo(addDays(today, (page + 1) * per)) };
  const range = days.length ? t('booking.picker.range', spanEnds(days[0], days[days.length - 1], l, today)) : '';
  // the hours brought into view when a page opens: the time chosen, else the first one possible
  const chosenAt = models.find((x) => x.chosen != null)?.chosen ?? null;
  const firstOpen = models.reduce<number | null>((a, x) => (x.open.length && (a == null || x.open[0] < a) ? x.open[0] : a), null);
  const settled = models.some((x) => x.status !== 'loading' || x.stale);
  const selClosed = !!sel && (sel.kind === 'closed' || sel.kind === 'past');

  return (
    <div class={`bp${list ? '' : ' bp-wide'}`} ref={root} data-testid="block-picker" data-mode="windows" data-layout={list ? 'list' : 'grid'}>
      <p class="sr-only" aria-live="polite">{said}</p>

      {/* what is chosen, said plainly */}
      <div class={`bp-chosen${p.value ? ' is-on' : ''}`} data-testid="bp-chosen">
        <CalendarCheck aria-hidden="true" />
        <span class="bp-chosen-txt">
          <span>{p.value ? t('booking.picker.chosen', { when: choiceWords(p.value, l) }) : t('booking.win.picker.nothing')}</span>
          <span class="bp-chosen-sub">{[picked?.eta != null ? cap(t('booking.win.grid.around', { time: clock(unitOfWindow(span, picked.win_start!, picked.eta, windowOf) ?? picked.eta, l) })) : '', t('booking.picker.duration', { d: duration(dur, l) })].filter(Boolean).join(' · ')}</span>
        </span>
        {p.value && hasPos && <Button size="sm" variant="ghost" icon={<MapIcon />} onClick={() => see(p.value!)} data-testid="bp-see-map">{t('booking.preview.see')}</Button>}
      </div>
      {preview && <RoutePreview ask={preview.ask} onClose={() => setPreview(null)} onPick={() => pick(preview.choice)} />}
      {dayMap && <DayRoute day={dayMap} exclude={p.excludeJob ?? null} onClose={() => setDayMap(null)} />}
      {hover && !preview && <RoutePreview ask={hover.ask} float={{ left: hover.left, top: hover.top }} onClose={() => setHover(null)} />}
      {(gone || (lost && !p.value)) && <Banner kind="warn" data-testid="win-gone">{t('booking.win.grid.gone')}</Banner>}
      {auto && modelOf(p.value!.day)?.kind === 'full' && <Banner kind="warn">{t('booking.win.picker.fullWarn')}</Banner>}
      {auto && modelOf(p.value!.day)?.kind !== 'full' && <Banner kind="info" data-testid="win-auto">{t('booking.win.autoNote')}</Banner>}

      {/* the best moments: a click chooses one and brings the calendar to it */}
      <section class="bp-sugg" aria-labelledby="bp-sugg-title">
        <div class="bp-head bp-head-wrap">
          <h3 id="bp-sugg-title" class="bp-title"><Sparkles size={18} aria-hidden="true" />{t('booking.win.picker.title')}</h3>
          {/* the car or the truck: only when the garage has both; work for the tire machine locks it on the truck */}
          {bothKinds && p.onKind && (
            <div class="bp-kind" data-testid="bp-kind">
              {p.need
                ? <p class="small bp-note" data-testid="bp-kind-need">{t('booking.kind.need')}</p>
                : <Seg<'any' | 'car' | 'truck'> value={p.kind || 'any'} onValue={(v) => p.onKind!(v === 'any' ? null : v)} label={t('booking.kind.label')}
                    options={[{ value: 'any', label: t('booking.kind.any') }, { value: 'car', label: t('booking.kind.car') }, { value: 'truck', label: t('booking.kind.truck') }]} />}
            </div>
          )}
          {(sugg.status === 'error' || sugg.status === 'offline') && online && (
            <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={again}>{t('booking.picker.retry')}</Button>
          )}
        </div>
        {sugg.status === 'ok' && !hasPos && <p class="faint small bp-note"><MapPin size={14} aria-hidden="true" /> {t('booking.picker.noPosition')}</p>}
        {sugg.status === 'loading' && !sugg.list.length && <div class="bp-sugg-skel" aria-busy="true"><span class="sr-only">{t('booking.win.picker.loading')}</span><Skeleton h={44} lines={1} /></div>}
        {sugg.status === 'offline' && <p class="muted small bp-note">{t('booking.win.picker.offline')}</p>}
        {sugg.status === 'error' && <p class="muted small bp-note">{t('booking.win.picker.error')}</p>}
        {sugg.status === 'ok' && !sugg.list.length && <p class="muted small bp-note" data-testid="win-sugg-none">{t('booking.win.picker.none', { d: duration(dur, l) })}</p>}
        {sugg.list.length > 0 && sugg.status !== 'offline' && sugg.status !== 'error' && (
          <div class={`bp-best-list${sugg.status === 'loading' ? ' is-stale' : ''}`} role="group" aria-label={t('booking.win.picker.title')} data-testid="win-suggs">
            {sugg.list.map((s, i) => {
              const c = suggChoice(s);
              const on = isPicked(c);
              const rank = ranks[i];
              const bits = [
                hasPos ? cap(s.drive_min <= 2 ? t('booking.picker.noDrive') : t('booking.picker.drive', { d: duration(s.drive_min, l) })) : '',
                rank ? (rank.total === 1 ? t('booking.picker.orderOnly') : t('booking.picker.order', { n: rank.n, total: rank.total })) : ''
              ].filter(Boolean);
              const current = !!moving && moving.day === s.day && moving.block === 'day' && moving.win_start != null && moving.win_start === s.win[0];
              return (
                <button key={`${s.day}|${s.win[0]}`} type="button" class={`bp-best-row${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => pickSugg(s)} {...menuProps(c)} {...hoverProps(c)}
                  data-testid={`win-sugg-${i}`} data-day={s.day} data-win={s.win[0]}>
                  <span class="bp-sugg-title">
                    {current ? <Pill tone="muted" dot={false}>{t('booking.win.picker.current')}</Pill> : i === 0 && <span class="bp-best-star" title={t('booking.picker.best')}>★<span class="sr-only">{t('booking.picker.best')} : </span></span>}
                    {choiceWords(c, l)}
                    {on && <Check size={18} class="bp-best-tick" aria-hidden="true" />}
                  </span>
                  <span class="bp-sugg-sub" title={bits.join(' · ')}>
                    {/* said clearly: this moment is the car's, or the truck's (never a vehicle's or a mechanic's name) */}
                    {bothKinds && s.truck && <span class={`bp-kind-tag is-${kindOf(s.truck)}`} data-testid="bp-sugg-kind">{kindOf(s.truck) === 'car' ? <Car size={14} aria-hidden="true" /> : <Truck size={14} aria-hidden="true" />}{t(`booking.kind.with.${kindOf(s.truck)}`)}</span>}
                    {bits[0] && <span>{bits[0]}</span>}
                    {rank && <span class="sr-only" data-testid="bp-sugg-order">{bits[bits.length - 1]}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* the calendar */}
      <section class="bp-cal" aria-labelledby="bp-cal-title">
        <h3 id="bp-cal-title" class="sr-only">{t('booking.win.grid.title')}</h3>
        {models.some((x) => x.kind === 'failed') && online && (
          <div class="bp-head"><span class="muted small">{t('booking.win.grid.state.failed')}</span><Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={again} data-testid="pick-retry">{t('booking.picker.retry')}</Button></div>
        )}
        {list && <p class="faint small bp-note">{t('booking.win.grid.hintPhone')}</p>}
        {list
          ? <PickList days={models} today={today} selDay={shown} onDay={setDay} onTime={(d, m) => pick(unitChoice(d, m))} unitLabel={unitLabel} dayLabel={dayLabel}
              menuOf={(d, m) => menuProps(unitChoice(d, m))} currentM={sel?.currentM ?? null} {...nav} />
          : <PickGrid span={span} days={models} today={today} selDay={shown} onDay={setDay} labelOf={labelOf} unitLabel={unitLabel} dayLabel={dayLabel} winOf={(m) => windowOf(m) as Win}
              onDayMenu={dayMenu}
              onUnit={(d, m, st) => { if (st === 'open') pick(unitChoice(d, m)); else if (st === 'no') void refused(d, m); }}
              askOf={(d, m) => (hasPos ? askOf(unitChoice(d, m), t('booking.win.grid.around', { time: clock(m, l) })) : null)}
              range={range} {...nav} goto={goto} openAt={chosenAt ?? (settled ? firstOpen ?? (days.includes(today) ? Math.max(span[0], now - 30) : span[0]) : null)} pageKey={`${days[0] || ''}|${per}`} hint={t('booking.win.grid.hint')} force={mayForce} />}
        {list && sel && sel.chosen != null && picked && (
          <p class="pl-says" data-testid="pick-says"><Check size={18} aria-hidden="true" />{labelOf(sel.chosen)}</p>
        )}

        {/* the day chosen: flexible, or the day alone when it has no time to offer */}
        {sel && (
          <div class="bp-dayp" data-testid="win-day-panel" data-day={sel.day}>
            <div class="bp-head">
              <h4 class="bp-title">{cap(longDay(sel.day, l))}</h4>
            </div>
            {!selClosed && <Switch checked={flex} onChange={setFlex} label={t('booking.win.flex')} hint={t('booking.win.flexHint')} data-testid="book-flex" />}
            {sel.status === 'offline' && <p class="muted small bp-note">{t('booking.win.offlineDay')}</p>}
            {sel.status === 'error' && <p class="muted small bp-note">{t('booking.win.errorDay')}</p>}
            {sel.kind === 'full' && <p class="muted small bp-note" data-testid="win-none">{t('booking.win.noneDay', { d: duration(dur, l) })}</p>}
            {/* no time to offer: the day alone (the app gives the window). A full day: « Réserver quand même » */}
            {(sel.kind === 'failed' || (sel.kind === 'full' && mayForce)) && (
              <div class="bp-dayp-more">
                <Button size="sm" variant={auto && here ? 'primary' : undefined} icon={auto && here ? <Check /> : undefined} onClick={() => pick({ day: sel.day, block: 'day' })} data-testid="win-force">
                  {sel.kind === 'full' ? t('booking.force.ok') : t('booking.win.dayOnly')}
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

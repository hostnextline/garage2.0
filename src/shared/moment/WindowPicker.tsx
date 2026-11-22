/* (On live since 2026-11-15, SWITCHED ON by the owner the same day for a trial week, 15-minute steps. The switch « Plages d'arrivée
   de 4 heures » is in Réglages → Réservations: off = the blocks as before, nothing lost.)
    « Plages d'arrivée » (Part 25): choose the day and the ARRIVAL TIME of an appointment on a time calendar.
   On top, the best moments near the address (one per day, from the server, never a far one). Then the calendar, 15
   minutes per unit:
   - a computer (≥ 760 px): a time grid, one column per day, with the appointments already booked that day and the
     units where this booking can arrive (PickGrid);
   - a phone: a row of days, then the arrival times of the day chosen (PickList).
   A unit = an estimated arrival T; the customer is told the window `windowOf(T)` (an hour before, three after); the
   unit is possible when the server (`suggest_windows`, asked for each day shown) lists that window. Under the
   calendar, for the day chosen: « Flexible », and the day alone when it has no window to offer (WindowDayPanel).
   « Garde-route » as in blocks mode: a far day is marked, never offered, warned with « Plutôt … », and `onFar` lets the
   screen ask before booking or moving.
   Same props as the block picker: the booking screen and « Déplacer » use it through BlockPicker.
   « Vraies routes » ON: « Arrêt n sur N » only from the server's row (window mode: exact), never the phone's estimate;
   « Voir sur la carte » gets the row of the window shown (its place, its order, what it adds); a banner while the
   address is measured, or when it could not be, with « Réessayer »; the days are asked again when a measure lands. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Check, RefreshCw } from 'lucide-preact';
import { addDays, daysBetween, longDay, duration, clock } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';
import { settings, job as jobRow, activeTrucks, daySpan, windowOf, roadsOn, truckRanges } from '../../data/select';
import { placeRoads, retryRoads } from '../../data/roads';
import { net } from '../../data/sync';
import { isOwner, hasRole } from '../../data/auth';
import { Banner, Button, ask, toast } from '../../ui';
import { openMenu, openMenuAt, pressProps } from '../../ui/ContextMenu';
import { farLimits, isFar, momentsByKey, sameMoment, unmeasured } from '../../domain/moment/logic';
import { serverRank } from '../../domain/moment/serverPlace';
import { exactAtOf } from '../../domain/moment/exactAt';
import { roomy } from '../../platform/media';
import type { Suggestion } from '../../data/api';
import { spanEnds } from '../../domain/moment/words';
import { choiceWords, winLen, type BlockChoice, type BlockPickerProps } from '../../domain/moment/choice';
import { rowsByStart, unitOfWindow, pageDays, pageOf, lastPage, type Win } from '../../domain/moment/units';
import { RoutePreview, RouteHover, type PreviewAsk } from './RoutePreview';
import { DayRoute } from './DayRoute';
import { stopRank } from './preview';
import { dayOf } from './deviceDay';
import { useDayWindows } from './useDayWindows';
import { dayStamp, useWindowModels } from './useWindowModels';
import { listDay, openingMinute, windowGone, type GridDay } from './windowDays';
import { useSuggestions, useLaterScores, useClock, useHover, useFinePointer, hasAnswer, answers, HOVER_MS } from './hooks';
import { askedKind, bothKinds, fitsJob, kindOf } from './vehicles';
import { bestWindows, betterThan, betterWindowText, dayRows, dayScores, rowChoice, windowFar, type DayRow } from './moments';
import { ChosenBar, FarBanner, RoadsBanner, momentActions } from './parts';
import { WindowSuggestions } from './WindowSuggestions';
import { WindowDayPanel } from './WindowDayPanel';
import { PickGrid } from './PickGrid';
import { PickList } from './PickList';
import './booking.css';

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** how many days fit side by side in the calendar's own width */
const colsFor = (w: number) => (w >= 560 ? 7 : w >= 420 ? 5 : 4);
/** the best moments look this far ahead (the scores of later days are asked with the page shown) */
const SUGG_DAYS = 14;

export function WindowPicker(p: BlockPickerProps) {
  const l = lang.value;
  const { today, now } = useClock();
  const horizon = Math.max(7, Number(settings.value.booking.horizon_days) || 120);
  const lastDay = addDays(today, horizon);
  const dur = Math.max(15, Math.round(p.duration || 60));
  const len = winLen();
  const span = daySpan.value;
  const online = net.value.online;
  const hasPos = p.lat != null && p.lng != null;
  const trucks = activeTrucks.value;
  const kinds = bothKinds(trucks);
  const kind = askedKind(p, trucks);
  const list = (p.layout ?? (roomy.value ? 'grid' : 'list')) === 'list';

  /* ---------- the best moments: one per day, with its best window (server) ---------- */
  const [retry, setRetry] = useState(0);
  const [bump, setBump] = useState(0);
  const base = { lat: p.lat, lng: p.lng, duration: dur, exclude: p.excludeJob ?? null, need: !!p.need, kind, truckId: p.truckId };
  const q = { ...base, from: today, days: SUGG_DAYS };
  const sugg = useSuggestions(q, online, retry + (p.reload || 0));
  const usable = hasAnswer(sugg);
  // the list answers the question of now (not the last one, kept dimmed while a new answer is awaited)
  const fresh = answers(sugg, q);
  const rows = useMemo(() => dayRows(sugg.list, windowOf, len), [sugg.list, len]);
  const best = useMemo(() => bestWindows(rows), [rows]);
  const again = () => { setRetry((x) => x + 1); setBump((x) => x + 1); };

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
  const winsOf = useDayWindows(days, { lat: p.lat, lng: p.lng, duration: dur, kind, need: !!p.need, exclude: p.excludeJob ?? null }, online, bump + (p.reload || 0), dayStamp);

  /* ---------- « garde-route »: the day's score (suggest_blocks), for the two weeks of the best moments and any later day shown ---------- */
  const lateAt = days.findIndex((d) => daysBetween(today, d) >= SUGG_DAYS);
  const later = useLaterScores(base, lateAt >= 0 ? days[lateAt] : null, lateAt >= 0 ? days.length - lateAt : 0, online, retry + (p.reload || 0));
  const scores = useMemo(() => momentsByKey(dayScores(usable ? [...sugg.list, ...later] : later)), [sugg.list, later, usable]);
  const scoreOf = (d: string) => scores.get(`${d}|day`);
  /* the warning and the question before booking only from the answer to the question of now (booking-b-26) */
  const freshScores = useMemo(() => (fresh ? scores : momentsByKey(dayScores(later))), [fresh, scores, later]);

  /* ---------- the days as the calendar draws them ---------- */
  const moving = p.excludeJob ? jobRow(p.excludeJob) : undefined;
  const picked = p.value && p.value.block === 'day' && !p.value.win_flex && p.value.win_start != null ? p.value : null;
  const models = useWindowModels({
    days, today, now, span, len, windowOf, l, winsOf, trucks: trucks.filter((tr) => fitsJob(tr, p)), truckId: p.truckId ?? null,
    picked, moving, exclude: p.excludeJob ?? null, bestOf: (d) => best.find((s) => s.day === d && !unmeasured(s)), farOf: (d) => isFar(scoreOf(d))
  });
  const modelOf = (d: string | null) => models.find((x) => x.day === d) || null;

  /* the day's real map in a window beside the picker while the mouse rests on a moment (a computer): a best moment, or
     a time of the list (the time grid opens the same window itself). `when`: the words above the map */
  const canHover = useFinePointer();
  const hov = useHover<{ c: BlockChoice; when?: string }>(HOVER_MS, canHover && hasPos);

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
  const pickSugg = (s: DayRow) => {
    hov.off();
    pick(rowChoice(s));
    goTo(s.day);
    const m = unitOfWindow(span, s.win[0], s.eta, windowOf);
    if (m != null) setGoto((g) => ({ m, n: (g?.n || 0) + 1 }));
  };
  const isPicked = (c: BlockChoice) => !!picked && picked.day === c.day && picked.win_start === c.win_start;
  // the window to go back to when « Flexible » is switched off
  const lastWin = useRef<BlockChoice | null>(null);
  if (picked) lastWin.current = picked;
  /* a phone lists one day's times: the day chosen, else the first day that has some (never another day's under the thumb) */
  const held = useRef<{ page: string; day: string | null }>({ page: '', day: null });
  const pageKey = `${days[0] || ''}|${per}`;
  if (held.current.page !== pageKey) held.current = { page: pageKey, day: null };
  const shown = list ? listDay(models, modelOf(day) ? day : null, held.current.day) : day;
  // once a day's times are drawn on the phone, that day stays under the thumb until a tap (booking-b-04)
  if (list && shown && modelOf(shown)?.open.length) held.current.day = shown;
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
  const gone = windowGone(picked, picked ? modelOf(picked.day) : null, picked ? winsOf(picked.day).rows : [], p.truckId, windowOf);
  // it is taken off (the screen has nothing chosen again), and said until another time is chosen
  const [lost, setLost] = useState(false);
  useEffect(() => { if (gone) { setLost(true); p.onClear?.(); } }, [gone]);
  useEffect(() => { if (p.value) setLost(false); }, [p.value]);

  /* ---------- « garde-route » of the moment chosen ---------- */
  const pickedScore = p.value ? freshScores.get(`${p.value.day}|day`) : undefined;
  const pickedWins = picked ? winsOf(picked.day) : null;
  const winScore = picked && pickedWins && pickedWins.status === 'ok' ? rowsByStart(pickedWins.rows, windowOf).get(picked.win_start!) : undefined;
  const far = windowFar(p.value, pickedScore, winScore, farLimits(settings.value.booking), l);
  const isCurrent = (s: DayRow) => !!moving && sameMoment(rowChoice(s), moving);
  const better = far && pickedScore ? betterThan(pickedScore, rows, moving, rowChoice) : [];
  useEffect(() => { p.onFar?.(far); }, [far?.day, far?.block, far?.text]);

  /* ---------- « Voir sur la carte »: the button under the moment chosen, a right-click or a long press on a moment ---------- */
  // `choice` null: a time that cannot be chosen (refused, closed, past) is only seen, never chosen from the map
  const [preview, setPreview] = useState<{ ask: PreviewAsk; choice: BlockChoice | null } | null>(null);
  /* the server's row of a window shown (switch on: its vehicle, its place and the day's order, what it adds; review-moments
     M1): a time of the calendar → the row behind that time; a best moment → its row; else the row of that window that
     day. « Flexible » and the day alone have none (their place is decided later). */
  const rowOf = (c: BlockChoice): Suggestion | null => {
    if (c.block !== 'day' || c.win_start == null) return null;
    const unit = c.eta != null ? modelOf(c.day)?.possible.get(c.eta) : undefined;
    if (unit && windowOf(c.eta!)[0] === c.win_start) return unit;
    const b = best.find((s) => s.day === c.day && s.win[0] === c.win_start);
    if (b) return b;
    const w = winsOf(c.day);
    return (w.status === 'ok' ? rowsByStart(w.rows, windowOf).get(c.win_start) : undefined) ?? null;
  };
  /* « Déplacer » (exact move, review M-1): a time chosen is where the appointment lands, on its own truck when that truck
     works that day (else the vehicle offered there, the one the move then takes): its map says that, never the planner's
     other vehicle nor its place in a route */
  const exactJob = p.exactMove ? moving : undefined;
  const exactTruck = (d: string, offered: string | null): string | null => {
    const own = exactJob?.truck_id ?? null;
    return own && trucks.some((tr) => tr.id === own) && truckRanges(own, d).length > 0 ? own : offered;
  };
  const askOf = (c: BlockChoice, when = choiceWords(c, l)): PreviewAsk => {
    const at = exactJob ? exactAtOf(c, span, windowOf) : null;
    if (at != null) {
      return { day: c.day, block: 'day', truckId: p.truckId || exactTruck(c.day, c.truck ?? null), lat: p.lat!, lng: p.lng!, name: '', address: p.address || '',
        when, exclude: p.excludeJob ?? null, eta: at, row: null, exact: true };
    }
    return { day: c.day, block: 'day', truckId: p.truckId || c.truck || null, lat: p.lat!, lng: p.lng!, name: '', address: p.address || '',
      when, exclude: p.excludeJob ?? null, eta: c.eta ?? null, row: rowOf(c) };
  };
  const see = (c: BlockChoice) => setPreview({ choice: c, ask: askOf(c) });
  /* a right-click anywhere on a day of the calendar: « Voir sur la carte » (with the new stop at that time when the address
     is known and a time is under the pointer, else the day's routes as they are); « Choisir ce moment » on a possible time */
  const [dayMap, setDayMap] = useState<string | null>(null);
  const dayMenu = (e: MouseEvent, d: string, m: number | null) => {
    const open = m != null && !!modelOf(d)?.possible.has(m);
    const c = m != null ? unitChoice(d, m) : null;
    const name = longDay(d, l);
    const title = `${cap(name)}${m != null ? `, ${clock(m, l)}` : ''}`;
    hov.off();
    openMenu(e, momentActions(open && c ? () => pick(c) : null,
      () => { if (hasPos && c) setPreview({ choice: open ? c : null, ask: askOf(c, t('booking.win.grid.around', { time: clock(m!, l) })) }); else setDayMap(d); }), title);
  };
  const menuProps = (c: BlockChoice) => {
    const actions = () => momentActions(() => pick(c), hasPos ? () => see(c) : null);
    // the map window of the moment closes as the menu opens (booking-b-31: it could stay over the menu)
    return { onContextMenu: (e: MouseEvent) => { hov.off(); openMenu(e, actions(), choiceWords(c, l)); }, ...pressProps((x, y) => { hov.off(); openMenuAt(x, y, actions(), choiceWords(c, l)); }) };
  };

  /* which stop of its route the appointment would be at each of the best moments: off, the phone's copy of the day; on,
     only the server's row (rank, exact in window mode), never the phone's estimate. « Déplacer » to a time (exact move):
     none, the row's place is the planner's, not where the move puts it (review M-1) */
  const onRoads = roadsOn.value;
  const ranks = useMemo(() => best.map((s) => (!hasPos || exactJob ? null : onRoads ? serverRank(s, p.truckId || s.truck)
    : stopRank(dayOf(s.day, p.excludeJob), { day: s.day, block: 'day', truckId: p.truckId || s.truck, lat: p.lat!, lng: p.lng!, name: '', address: '', eta: s.eta ?? null }))),
  [best, p.lat, p.lng, p.excludeJob, p.truckId, onRoads, !!exactJob]);
  /* « Vraies routes »: the address being measured, or it could not be (« Réessayer » measures again, then asks again) */
  const roads = hasPos ? placeRoads({ lat: p.lat!, lng: p.lng! }) : null;
  const roadsAgain = () => { void retryRoads({ lat: p.lat!, lng: p.lng! }); again(); };

  /* ---------- words ---------- */
  const stateWord = (d: GridDay) => (d.kind === 'open' ? t('booking.win.grid.count', { n: d.windows }) : t(`booking.win.grid.state.${d.kind}`));
  const dayLabel = (d: GridDay) => t('booking.win.grid.day', { day: longDay(d.day, l), state: stateWord(d) }) + (d.far && d.kind === 'open' ? `, ${t('booking.far.cell')}` : '');
  const unitLabel = (d: string, m: number, st: string = 'open') => {
    const w = windowOf(m);
    return st === 'no' ? t('booking.win.grid.unitNo', { day: longDay(d, l), time: clock(m, l) }) : t('booking.win.grid.unit', { day: longDay(d, l), time: clock(m, l), from: clock(w[0], l), to: clock(w[1], l) });
  };
  const nav = { canPrev: page > 0, canNext: page < lastPage(today, lastDay, per), onPrev: () => goTo(addDays(today, (page - 1) * per)), onNext: () => goTo(addDays(today, (page + 1) * per)) };
  const range = days.length ? t('booking.picker.range', spanEnds(days[0], days[days.length - 1], l, today)) : '';
  const chosenSub = [picked?.eta != null ? cap(t('booking.win.grid.around', { time: clock(unitOfWindow(span, picked.win_start!, picked.eta, windowOf) ?? picked.eta, l) })) : '', t('booking.picker.duration', { d: duration(dur, l) })];

  return (
    <div class={`bp${list ? '' : ' bp-wide'}`} ref={root} data-pop-group data-testid="block-picker" data-mode="windows" data-layout={list ? 'list' : 'grid'}>
      <p class="sr-only" aria-live="polite">{said}</p>
      <ChosenBar on={!!p.value} text={p.value ? t('booking.picker.chosen', { when: choiceWords(p.value, l) }) : t('booking.win.picker.nothing')}
        sub={chosenSub.filter(Boolean).join(' · ')} onSee={p.value && hasPos ? () => see(p.value!) : null} />
      {preview && <RoutePreview ask={preview.ask} onClose={() => setPreview(null)} onPick={preview.choice ? () => pick(preview.choice!) : undefined} />}
      {dayMap && <DayRoute day={dayMap} exclude={p.excludeJob ?? null} onClose={() => setDayMap(null)} />}
      {hov.hover && !preview && <RouteHover ask={askOf(hov.hover.item.c)} at={hov.hover.at} group={hov.hover.group} title={hov.hover.item.when} />}
      {(gone || (lost && !p.value)) && <Banner kind="warn" data-testid="win-gone">{t('booking.win.grid.gone')}</Banner>}
      {auto && modelOf(p.value!.day)?.kind === 'full' && <Banner kind="warn">{t('booking.win.picker.fullWarn')}</Banner>}
      {auto && modelOf(p.value!.day)?.kind !== 'full' && <Banner kind="info" data-testid="win-auto">{t('booking.win.autoNote')}</Banner>}
      {far && <FarBanner text={far.text} better={better.map((b) => ({ key: `${b.moment.day}|${b.moment.win[0]}`, text: betterWindowText(b, today, l), onPick: () => pickSugg(b.moment) }))} />}
      <RoadsBanner roads={roads} online={online} onRetry={roadsAgain} />

      <WindowSuggestions sugg={sugg} rows={best} dur={dur} hasPos={hasPos} online={online} kinds={kinds} kindOf={(id) => kindOf(trucks, id)}
        need={p.need} kind={p.kind} onKind={p.onKind} isPicked={isPicked} isCurrent={isCurrent} ranks={ranks} onPick={pickSugg} onRetry={again}
        rowProps={(c) => ({ ...menuProps(c), ...hov.props(`${c.day}|${c.win_start}`, { c }) })} />
      {/* said once, in plain words: nobody finds a map that only opens under a mouse at rest */}
      {canHover && hasPos && <p class="faint small bp-note" data-testid="win-hint-hover">{t('booking.win.picker.hintHover')}</p>}

      {/* the calendar */}
      <section class="bp-cal" aria-labelledby="bp-cal-title">
        <h3 id="bp-cal-title" class="sr-only">{t('booking.win.grid.title')}</h3>
        {models.some((x) => x.kind === 'failed') && online && (
          <div class="bp-head"><span class="muted small">{t('booking.win.grid.state.failed')}</span><Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={again} data-testid="pick-retry">{t('booking.picker.retry')}</Button></div>
        )}
        {list && <p class="faint small bp-note">{t('booking.win.grid.hintPhone')}</p>}
        {list
          ? <PickList days={models} today={today} selDay={shown} onDay={setDay} onTime={(d, m) => pick(unitChoice(d, m))} unitLabel={unitLabel} dayLabel={dayLabel}
              menuOf={(d, m) => ({ ...menuProps(unitChoice(d, m)), ...hov.props(`${d}|t${m}`, { c: unitChoice(d, m), when: `${cap(longDay(d, l))} · ${labelOf(m)}` }) })} currentM={sel?.currentM ?? null} {...nav} />
          : <PickGrid span={span} days={models} today={today} selDay={shown} onDay={setDay} labelOf={labelOf} unitLabel={unitLabel} dayLabel={dayLabel} winOf={(m) => windowOf(m) as Win}
              onDayMenu={dayMenu}
              onUnit={(d, m, st) => { if (st === 'open') pick(unitChoice(d, m)); else if (st === 'no') void refused(d, m); }}
              askOf={(d, m) => (hasPos ? askOf(unitChoice(d, m), t('booking.win.grid.around', { time: clock(m, l) })) : null)}
              range={range} {...nav} goto={goto} openAt={openingMinute(models, { today, now, span })} pageKey={pageKey} hint={t('booking.win.grid.hint')} force={mayForce} />}
        {list && sel && sel.chosen != null && picked && (
          <p class="pl-says" data-testid="pick-says"><Check size={18} aria-hidden="true" />{labelOf(sel.chosen)}</p>
        )}
        {sel && <WindowDayPanel day={sel} dur={dur} flex={flex} onFlex={setFlex} dayAlone={auto && here} onDayAlone={() => pick({ day: sel.day, block: 'day' })} mayForce={mayForce} />}
      </section>
    </div>
  );
}

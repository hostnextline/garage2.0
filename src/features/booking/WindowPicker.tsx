/* « Plages d'arrivée » (Part 25): choose the day and its 4-hour arrival window. The best moments near the address first
   (one per day, from the server), then the day opened: « Flexible », the other hours possible that day, and the days
   to choose by hand (coloured by the room left, from the copy on the phone). Same props as the block picker: the
   booking screen and « Déplacer » use it through BlockPicker when the garage books by windows. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CalendarCheck, Check, ChevronLeft, ChevronRight, Clock, MapPin, RefreshCw, Sparkles, Map as MapIcon, Car, Truck, ListOrdered } from 'lucide-preact';
import { today as todayOf, addDays, daysBetween, tinyDay, longDay, duration, isValidDay, nowMinute } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';
import { blockLoad, settings, job as jobRow, activeTrucks, daySpan, windowOf } from '../../data/select';
import { suggestBlocks, suggestWindows, type Suggestion } from '../../data/api';
import { net, isNetworkError } from '../../data/sync';
import { isOwner, hasRole } from '../../data/auth';
import { Banner, Button, Pill, Skeleton, Seg, Switch } from '../../ui';
import { cellState, dayLoad, distinctWindows, suggWindow, type CellState } from './logic';
import { openMenu, openMenuAt, pressProps } from '../agenda/ContextMenu';
import { RoutePreview, type PreviewAsk } from './RoutePreview';
import { stopRank } from './preview';
import { fromDevice } from '../map/device';
import { spanEnds, windowWords } from './when';
import { choiceWords, winLen, type BlockChoice, type BlockPickerProps } from './choice';
import './booking.css';

type Row = Suggestion & { win: [number, number] };
type Status = 'loading' | 'ok' | 'offline' | 'error';
const PAGE = 14;
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function WindowPicker(p: BlockPickerProps) {
  const l = lang.value;
  const today = todayOf();
  const horizon = Math.max(PAGE, Number(settings.value.booking.horizon_days) || 120);
  const lastDay = addDays(today, horizon);
  const drive = Number(settings.value.booking.unknown_min) || 20;
  const dur = Math.max(15, Math.round(p.duration || 60));
  const len = winLen();
  const span = daySpan.value;
  const online = net.value.online;
  const hasPos = p.lat != null && p.lng != null;
  const kindAsked = p.need ? null : p.kind ?? null;
  const ofTruck = <T extends { truck: string | null }>(list: T[]) => (p.truckId ? list.filter((x) => !x.truck || x.truck === p.truckId) : list);

  /* ---------- the best moments: one per day, with its best window (server) ---------- */
  const [sugg, setSugg] = useState<{ status: Status; list: Row[] }>({ status: 'loading', list: [] });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!online) { setSugg({ status: 'offline', list: [] }); return; }
    let alive = true;
    setSugg((s) => ({ status: 'loading', list: s.list }));
    const tm = setTimeout(async () => {
      try {
        const list = await suggestBlocks(p.lat, p.lng, dur, today, PAGE, p.excludeJob ?? null, !!p.need, kindAsked);
        if (!alive) return;
        const rows: Row[] = [];
        for (const x of ofTruck(list)) {
          const win = isValidDay(String(x.day)) ? suggWindow(x, windowOf, len) : null;
          if (win) rows.push({ ...x, block: 'day', win });
        }
        setSugg({ status: 'ok', list: rows.slice(0, 6) });
      } catch (e) {
        if (alive) setSugg({ status: isNetworkError(e) ? 'offline' : 'error', list: [] });
      }
    }, 350);
    return () => { alive = false; clearTimeout(tm); };
  }, [p.lat, p.lng, dur, p.excludeJob, p.truckId, p.need, p.kind, online, retry, p.reload]);

  const kindOf = (truckId: string): 'car' | 'truck' => (activeTrucks.value.find((x) => x.id === truckId)?.tire_machine === false ? 'car' : 'truck');
  const bothKinds = activeTrucks.value.some((x) => x.tire_machine === false) && activeTrucks.value.some((x) => x.tire_machine !== false);

  /* ---------- the day opened: « Flexible », and its windows (server) ---------- */
  const [day, setDay] = useState<string | null>(() => p.value?.day ?? (p.openDay && p.openDay >= today ? p.openDay : null));
  // « Autres heures ce jour-là »: the list is asked for (it also shows by itself while the day has no window chosen)
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => { if (p.value) setDay(p.value.day); }, [p.value?.day]);
  // a window the server refused: the hours of that day again
  const firstLoad = useRef(true);
  useEffect(() => { if (firstLoad.current) { firstLoad.current = false; return; } setListOpen(true); }, [p.reload]);
  const here = !!p.value && p.value.day === day && p.value.block === 'day';
  const flex = here && !!p.value!.win_flex;
  const showList = !!day && !flex && (listOpen || !(here && p.value!.win_start != null));
  const [wins, setWins] = useState<{ status: Status; day: string | null; list: Row[] }>({ status: 'loading', day: null, list: [] });
  useEffect(() => {
    if (!day || !showList) return;
    if (!online) { setWins({ status: 'offline', day, list: [] }); return; }
    let alive = true;
    setWins((s) => ({ status: 'loading', day, list: s.day === day ? s.list : [] }));
    const tm = setTimeout(async () => {
      try {
        const list = await suggestWindows(p.lat, p.lng, dur, day, p.excludeJob ?? null, !!p.need, kindAsked);
        if (alive) setWins({ status: 'ok', day, list: distinctWindows(ofTruck(list).map((x) => ({ ...x, day, block: 'day' as const })), windowOf, len) });
      } catch (e) {
        if (alive) setWins({ status: isNetworkError(e) ? 'offline' : 'error', day, list: [] });
      }
    }, 250);
    return () => { alive = false; clearTimeout(tm); };
  }, [day, showList, p.lat, p.lng, dur, p.excludeJob, p.truckId, p.need, p.kind, online, retry, p.reload]);
  const dayWins = wins.day === day ? wins : { status: 'loading' as Status, day, list: [] as Row[] };

  /* which stop of its route the appointment would be at each moment (the phone's copy of the day, the same estimate as
     « Voir sur la carte »: the stop goes where its estimated arrival says) */
  const rankOf = (s: Row) => {
    if (p.lat == null || p.lng == null) return null;
    const d = fromDevice(s.day);
    const base = p.excludeJob ? { ...d, jobs: d.jobs.filter((j) => j.id !== p.excludeJob) } : d;
    return stopRank(base, { day: s.day, block: 'day', truckId: p.truckId || s.truck, lat: p.lat, lng: p.lng, name: '', address: '', eta: s.eta ?? null });
  };
  const suggRanks = useMemo(() => sugg.list.map(rankOf), [sugg.list, p.lat, p.lng, p.excludeJob, p.truckId]);
  const winRanks = useMemo(() => dayWins.list.map(rankOf), [dayWins.list, p.lat, p.lng, p.excludeJob, p.truckId]);

  /* ---------- choosing ---------- */
  const [said, setSaid] = useState('');
  const choiceOf = (s: Row): BlockChoice => ({ day: s.day, block: 'day', win_start: s.win[0], win_end: s.win[1], eta: s.eta ?? null });
  const isPicked = (c: BlockChoice) => !!p.value && p.value.day === c.day && p.value.block === 'day' && !p.value.win_flex && p.value.win_start != null && p.value.win_start === c.win_start;
  const pick = (c: BlockChoice) => {
    p.onPick(c);
    setDay(c.day);
    setSaid(t('booking.picker.chosen', { when: choiceWords(c, l) }));
  };
  // the window to go back to when « Flexible » is switched off
  const lastWin = useRef<BlockChoice | null>(null);
  if (p.value && p.value.block === 'day' && p.value.win_start != null && !p.value.win_flex) lastWin.current = p.value;
  const setFlex = (on: boolean) => {
    if (!day) return;
    if (on) { pick({ day, block: 'day', win_flex: true }); return; }
    const back = lastWin.current && lastWin.current.day === day ? lastWin.current : null;
    if (back) pick(back);
    else if (p.onClear) { p.onClear(); setSaid(t('booking.win.picker.nothing')); }
    else pick({ day, block: 'day' });
  };
  const openDay = (d: string) => { setDay(d); setListOpen(true); };
  // moving a job: where it is now
  const moving = p.excludeJob ? jobRow(p.excludeJob) : undefined;
  const isCurrent = (c: BlockChoice) => !!moving && moving.day === c.day && moving.block === 'day' && moving.win_start != null && moving.win_start === c.win_start;
  // without a window to offer (a full day, no network), the day alone may be taken: the app gives the window when it
  // books. A full day: only those who may « Réserver quand même ».
  const mayForce = isOwner() || hasRole('office');

  /* « Voir sur la carte »: a right-click or a long press on a moment (or the button under the moment chosen) */
  const [preview, setPreview] = useState<{ ask: PreviewAsk; choice: BlockChoice } | null>(null);
  const truckOf = (c: BlockChoice) => p.truckId || [...sugg.list, ...dayWins.list].find((s) => s.day === c.day && s.win[0] === c.win_start)?.truck || null;
  const see = (c: BlockChoice) => setPreview({ choice: c, ask: { day: c.day, block: 'day', truckId: truckOf(c), lat: p.lat!, lng: p.lng!, name: '', address: p.address || '',
    when: choiceWords(c, l), exclude: p.excludeJob ?? null, eta: c.eta ?? null } });
  const actions = (c: BlockChoice) => [
    { key: 'pick', label: t('booking.preview.pick'), icon: <Check size={18} />, run: () => pick(c), testid: 'menu-pick' },
    { key: 'others', label: t('booking.win.others'), icon: <Clock size={18} />, run: () => openDay(c.day), testid: 'menu-win-others' },
    ...(hasPos ? [{ key: 'map', label: t('booking.preview.see'), icon: <MapIcon size={18} />, run: () => see(c), testid: 'menu-see-map' }] : [])
  ];
  const menuProps = (c: BlockChoice) => ({
    onContextMenu: (e: MouseEvent) => openMenu(e, actions(c), choiceWords(c, l)),
    ...pressProps((x, y) => { openMenuAt(x, y, actions(c), choiceWords(c, l)); })
  });

  /* ---------- the days to choose by hand (device copy) ---------- */
  const [page, setPage] = useState(0);
  const pageOf = (d: string) => Math.max(0, Math.floor(daysBetween(today, d) / PAGE));
  useEffect(() => { if (day && daysBetween(today, day) >= 0) setPage(pageOf(day)); }, [day]);
  const start = addDays(today, page * PAGE);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < PAGE; i++) { const d = addDays(start, i); if (d > lastDay) break; out.push(d); }
    return out;
  }, [start, lastDay]);
  const minBlock = Math.min(Number(settings.value.booking.min_block_min) || 45, span[1] - span[0]);
  const stateOf = (d: string) => {
    const load = dayLoad(blockLoad(d, 'day'), { past: d < today, isToday: d === today, now: nowMinute(), dayEnd: span[1], minBlock });
    return cellState(load, dur, drive, { truckId: p.truckId, exclude: p.excludeJob, unknownMin: drive });
  };
  const cells = days.map((d) => ({ day: d, ...stateOf(d) }));
  const pickedCell = p.value ? stateOf(p.value.day) : null;
  const stateWords = (state: CellState, left: number) => t(`booking.picker.stateLong.${state}`, { d: duration(left, l) });
  const auto = !!p.value && p.value.block === 'day' && !p.value.win_flex && p.value.win_start == null;

  /* one moment offered: a suggestion (its day and window) or an hour of the day opened (its window) */
  const row = (s: Row, o: { title: string; testid: string; best: boolean; rank: ReturnType<typeof rankOf>; sugg?: boolean }) => {
    const c = choiceOf(s);
    const on = isPicked(c);
    const bits = [
      hasPos ? (s.drive_min <= 2 ? t('booking.picker.noDrive') : t('booking.picker.drive', { d: duration(s.drive_min, l) })) : '',
      s.near != null ? t('booking.picker.near', { n: s.near }) : ''
    ].filter(Boolean);
    if (bits[0]) bits[0] = cap(bits[0]);
    return (
      <button key={`${s.day}|${s.win[0]}`} type="button" class={`bp-sugg-row${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => { if (o.sugg) setListOpen(false); pick(c); }} {...menuProps(c)}
        data-testid={o.testid} data-day={s.day} data-win={s.win[0]}>
        <span class="bp-sugg-main">
          {isCurrent(c) ? <span class="bp-best"><Pill tone="muted" dot={false}>{t('booking.win.picker.current')}</Pill></span>
            : o.best && <span class="bp-best"><Pill tone="ok" dot={false}>{t('booking.picker.best')}</Pill></span>}
          <span class="bp-sugg-title">{o.title}</span>
          {/* said clearly: this moment is the car's, or the truck's (never a vehicle's or a mechanic's name) */}
          {bothKinds && s.truck && <span class={`bp-kind-tag is-${kindOf(s.truck)}`} data-testid="bp-sugg-kind">{kindOf(s.truck) === 'car' ? <Car size={16} aria-hidden="true" /> : <Truck size={16} aria-hidden="true" />}{t(`booking.kind.with.${kindOf(s.truck)}`)}</span>}
          {o.rank && <span class="bp-order-tag" data-testid="bp-sugg-order"><ListOrdered size={16} aria-hidden="true" />{o.rank.total === 1 ? t('booking.picker.orderOnly') : t('booking.picker.order', { n: o.rank.n, total: o.rank.total })}</span>}
          {bits.length > 0 && <span class="bp-sugg-sub">{bits.join(', ')}</span>}
        </span>
        <span class="bp-tick" aria-hidden="true">{on && <Check size={22} />}</span>
      </button>
    );
  };
  const noWindows = dayWins.status !== 'loading' && !dayWins.list.length;
  const dayClosed = !!day && ['closed', 'started'].includes(stateOf(day).state);

  return (
    <div class="bp" data-testid="block-picker" data-mode="windows">
      <p class="sr-only" aria-live="polite">{said}</p>

      {/* what is chosen, said plainly */}
      <div class={`bp-chosen${p.value ? ' is-on' : ''}`} data-testid="bp-chosen">
        <CalendarCheck aria-hidden="true" />
        <span class="bp-chosen-txt">
          <span>{p.value ? t('booking.picker.chosen', { when: choiceWords(p.value, l) }) : t('booking.win.picker.nothing')}</span>
          <span class="bp-chosen-sub">{t('booking.picker.duration', { d: duration(dur, l) })}</span>
        </span>
        {p.value && hasPos && <Button size="sm" variant="ghost" icon={<MapIcon />} onClick={() => see(p.value!)} data-testid="bp-see-map">{t('booking.preview.see')}</Button>}
      </div>
      {preview && <RoutePreview ask={preview.ask} onClose={() => setPreview(null)} onPick={() => pick(preview.choice)} />}
      {auto && pickedCell?.state === 'full' && <Banner kind="warn">{t('booking.win.picker.fullWarn')}</Banner>}
      {auto && pickedCell?.state !== 'full' && <Banner kind="info" data-testid="win-auto">{t('booking.win.autoNote')}</Banner>}

      {/* the day opened: flexible, or one of its windows */}
      {day && (
        <section class="bp-dayp" aria-labelledby="bp-dayp-title" data-testid="win-day-panel" data-day={day}>
          <div class="bp-head">
            <h3 id="bp-dayp-title" class="bp-title"><Clock size={18} aria-hidden="true" />{cap(longDay(day, l))}</h3>
            {showList && dayWins.status === 'error' && online && <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => setRetry((n) => n + 1)}>{t('booking.picker.retry')}</Button>}
          </div>
          {!dayClosed && <Switch checked={flex} onChange={setFlex} label={t('booking.win.flex')} hint={t('booking.win.flexHint')} data-testid="book-flex" />}
          {!flex && !showList && <div class="bp-dayp-more"><Button size="sm" icon={<Clock />} onClick={() => setListOpen(true)} data-testid="win-others">{t('booking.win.others')}</Button></div>}
          {showList && (
            <div class="bp-dayp-list" data-testid="win-options">
              <p class="bp-dayp-sub">{t('booking.win.hours')}</p>
              {dayWins.status === 'loading' && !dayWins.list.length && <div aria-busy="true"><span class="sr-only">{t('booking.win.loadingDay')}</span><Skeleton h={52} lines={2} /></div>}
              {dayWins.status === 'offline' && <p class="muted small bp-note">{t('booking.win.offlineDay')}</p>}
              {dayWins.status === 'error' && <p class="muted small bp-note">{t('booking.win.errorDay')}</p>}
              {dayWins.status === 'ok' && noWindows && <p class="muted small bp-note" data-testid="win-none">{t('booking.win.noneDay', { d: duration(dur, l) })}</p>}
              {dayWins.list.length > 0 && (
                <div class={`bp-sugg-list${dayWins.status === 'loading' ? ' is-stale' : ''}`} role="group" aria-label={t('booking.win.hours')}>
                  {dayWins.list.map((s, i) => row(s, { title: cap(windowWords(s.win, l)), testid: `win-option-${s.win[0]}`, best: i === 0 && dayWins.list.length > 1, rank: winRanks[i] }))}
                </div>
              )}
              {/* no window to offer: the day alone (the app gives the window). A full day: « Réserver quand même » */}
              {noWindows && !dayClosed && (dayWins.status === 'ok' ? mayForce : true) && (
                <div class="bp-dayp-more">
                  <Button size="sm" variant={auto && here ? 'primary' : undefined} icon={auto && here ? <Check /> : undefined} onClick={() => pick({ day, block: 'day' })} data-testid="win-force">
                    {dayWins.status === 'ok' ? t('booking.force.ok') : t('booking.win.dayOnly')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* suggestions */}
      <section class="bp-sugg" aria-labelledby="bp-sugg-title">
        <div class="bp-head">
          <h3 id="bp-sugg-title" class="bp-title"><Sparkles size={18} aria-hidden="true" />{t('booking.win.picker.title')}</h3>
          {(sugg.status === 'error' || sugg.status === 'offline') && online && (
            <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => setRetry((n) => n + 1)}>{t('booking.picker.retry')}</Button>
          )}
        </div>
        {/* the car or the truck: only when the garage has both; work for the tire machine locks it on the truck */}
        {bothKinds && p.onKind && (
          <div class="bp-kind" data-testid="bp-kind">
            {p.need
              ? <p class="small bp-note" data-testid="bp-kind-need">{t('booking.kind.need')}</p>
              : <Seg<'any' | 'car' | 'truck'> value={p.kind || 'any'} onValue={(v) => p.onKind!(v === 'any' ? null : v)} label={t('booking.kind.label')}
                  options={[{ value: 'any', label: t('booking.kind.any') }, { value: 'car', label: t('booking.kind.car') }, { value: 'truck', label: t('booking.kind.truck') }]} />}
          </div>
        )}
        {sugg.status === 'ok' && !hasPos && <p class="faint small bp-note"><MapPin size={14} aria-hidden="true" /> {t('booking.picker.noPosition')}</p>}
        {sugg.status === 'loading' && !sugg.list.length && <div class="bp-sugg-skel" aria-busy="true"><span class="sr-only">{t('booking.win.picker.loading')}</span><Skeleton h={52} lines={3} /></div>}
        {sugg.status === 'offline' && <p class="muted small bp-note">{t('booking.win.picker.offline')}</p>}
        {sugg.status === 'error' && <p class="muted small bp-note">{t('booking.win.picker.error')}</p>}
        {sugg.status === 'ok' && !sugg.list.length && <p class="muted small bp-note" data-testid="win-sugg-none">{t('booking.win.picker.none', { d: duration(dur, l) })}</p>}
        {sugg.list.length > 0 && sugg.status !== 'offline' && sugg.status !== 'error' && (
          <div class={`bp-sugg-list${sugg.status === 'loading' ? ' is-stale' : ''}`} role="group" aria-label={t('booking.win.picker.title')} data-testid="win-suggs">
            {sugg.list.map((s, i) => row(s, { title: choiceWords(choiceOf(s), l), testid: `win-sugg-${i}`, best: i === 0, rank: suggRanks[i], sugg: true }))}
          </div>
        )}
      </section>

      {/* the days */}
      <section class="bp-cal" aria-labelledby="bp-days-title">
        <div class="bp-head">
          <h3 id="bp-days-title" class="bp-title">{t('booking.win.picker.days')}</h3>
          <span class="faint small grow">{days.length ? t('booking.picker.range', spanEnds(days[0], days[days.length - 1], l, today)) : ''}</span>
        </div>
        <div class="bp-days" role="group" aria-label={t('booking.win.picker.days')} aria-describedby="bp-days-help">
          {cells.map((c) => {
            const off = c.state === 'closed' || c.state === 'started';
            const on = day === c.day;
            const label = t('booking.win.picker.dayLabel', { day: longDay(c.day, l), state: stateWords(c.state, c.left) });
            return (
              <button key={c.day} type="button" class={`bp-cell bp-daycell is-${c.state}${on ? ' is-on' : ''}${moving?.day === c.day && !on ? ' is-current' : ''}`}
                aria-pressed={on} aria-disabled={off || undefined} aria-label={label} title={label}
                onClick={() => { if (!off) openDay(c.day); }} data-testid={`win-day-${c.day}`}>
                <span class="bp-daycell-name">{c.day === today ? t('common.today') : tinyDay(c.day, l)}</span>
                <span class="bp-daycell-state">{t(`booking.picker.state.${c.state}`, { d: duration(c.left, l) })}</span>
              </button>
            );
          })}
        </div>
        <p id="bp-days-help" class="sr-only">{t('booking.win.picker.dayHelp')}</p>
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

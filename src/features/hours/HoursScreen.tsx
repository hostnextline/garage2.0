/* Horaires des camions — #/hours/:truck?
   Pick the truck, paint its usual week on the glass window, then say for when it counts: one day, a few weeks, or
   from now on (« Appliquer »). The dates that differ from the usual week are listed, each with « Revenir à l'horaire
   habituel ». The owner (or the « settings » right, when it may also write the trucks) also manages the trucks here.
   The screen composes: the drawing (useHoursDraft), the window (HoursGridPanel), « Appliquer » (ApplyPanel), the changed
   days, the start, the trucks; and the closing of a vehicle that holds appointments (CloseDaySheet, closeFlow.ts). */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Truck as TruckIcon } from 'lucide-preact';
import { navigate, type ScreenProps } from '../../platform/router';
import { wide } from '../../platform/media';
import { t, lang } from '../../lib/i18n';
import { addDays, dow, longDay, today as todayOf, type Day, type BlockKey } from '../../lib/dates';
import { trucks, activeTrucks, truck as truckRow, truckLabel, truckColor, weekOf, truckRanges, settings, allJobs, blockOfKey, blockLoad, windowsOn } from '../../data/select';
import { rowsOf } from '../../data/store';
import { applyHours, moveJob, errorMessage } from '../../data/api';
import { pull, net } from '../../data/sync';
import { can, isOwner, myTrucks, preview } from '../../data/auth';
import type { TruckDay } from '../../data/types';
import { Page, Panel, Banner, Chips, Empty, Skeleton, ask, run, toast } from '../../ui';
import { keepWindow } from '../../shared/jobs/select';
import { TruckStartPanel } from '../../shared/places/TruckStartPanel';
import { closedJobs, otherKind, movesFor, mayMoveBetween, holdsJobsOf, type Move } from '../../shared/map/closing';
import { focusAfterNav, restoreFocus } from '../../platform/focus';
import { CloseDaySheet } from './CloseDaySheet';
import { TrucksPanel } from './TrucksPanel';
import { HoursGridPanel } from './HoursGridPanel';
import { ApplyPanel } from './ApplyPanel';
import { ChangedDays } from './ChangedDays';
import { useHoursDraft } from './useHoursDraft';
import { moveAll } from './closeFlow';
import { applyPlan, type Mode, type Week } from './grid';
import './hours.css';

/** the next date (from today) that falls on that weekday */
function nextDow(from: Day, d: number): Day { const n = (d - dow(from) + 7) % 7; return addDays(from, n); }

export default function HoursScreen({ params }: ScreenProps) {
  const l = lang.value;
  const today = todayOf();
  const isWide = wide.value;
  const mine = myTrucks();
  // whoever may change every truck's hours sees them all; a mechanic sees only the truck he drives (his own hours and start)
  const all = isOwner() || can('hours');
  const list = all ? trucks.value : trucks.value.filter((x) => mine.includes(x.id));
  const truckId = (params.truck && list.some((x) => x.id === params.truck) && !truckRow(params.truck)?.deleted_at ? params.truck : null)
    || mine.find((id) => list.some((x) => x.id === id)) || (all ? activeTrucks.value[0]?.id || list[0]?.id : null) || null;
  const tr = truckRow(truckId);
  const canEdit = !!truckId && (isOwner() || can('hours') || mine.includes(truckId)) && !preview.value;
  // the trucks are written by the owner or « hours » (the server's rule): « settings » alone would see « enregistré », then a refusal
  const manage = (isOwner() || can('settings')) && (isOwner() || can('hours'));
  const horizon = Number(settings.value.booking.horizon_days) || 120;
  const lastDay = addDays(today, horizon);

  /* ---------- for when ---------- */
  const [mode, setMode] = useState<Mode>('always');
  const [weeks, setWeeks] = useState(2);
  const [chosen, setChosen] = useState<Day>(today);
  // left open past midnight, the chosen day may be gone: it is today then (the server would write nothing for it)
  const from = chosen < today ? today : chosen;
  useEffect(() => { if (chosen < today) setChosen(today); }, [chosen, today]);
  const [phoneDay, setPhoneDay] = useState<number>(() => dow(today));
  const shownDay = mode === 'day' ? dow(from) : phoneDay;

  /* ---------- the drawing: what the truck has; « one day »: that date's real hours in its column ---------- */
  const usual = truckId ? weekOf(truckId) : {};
  const actual = truckId ? truckRanges(truckId, from) : [];
  const week: Week = mode === 'day' ? { ...usual, [dow(from)]: actual } : usual;
  const d = useHoursDraft(truckId, week);

  const usualKey = JSON.stringify(usual), actualKey = JSON.stringify(actual);
  const plan = useMemo(() => applyPlan(mode, d.draft, usual, { from, weeks, today, until: lastDay, actual }), [mode, d.draft, usualKey, actualKey, from, weeks, today, lastDay]);
  const jobs = allJobs.value;
  const jobsHit = useMemo(() => {
    if (!truckId || plan.empty) return 0;
    const dates = new Set(plan.dates);
    return jobs.filter((j) => j.truck_id === truckId && j.status === 'booked' && j.day >= today && dates.has(j.day)).length;
  }, [truckId, plan, jobs, today]);
  const exceptions = rowsOf<TruckDay>('truck_days').filter((x) => x.truck_id === truckId && !x.deleted_at && x.day >= today);
  const alwaysReplaces = mode === 'always' && exceptions.some((x) => plan.dows.includes(dow(x.day)));
  const blind = !!truckId && !holdsJobsOf(truckId, { owner: isOwner(), agenda: can('agenda'), mine });

  const pickTruck = async (id: string) => {
    if (id === truckId) return;
    if (d.dirtyDays.length && !(await ask({ title: t('hours.grid.dirtyTruck'), text: t('hours.grid.dirtyTruckText', { truck: truckLabel(truckId) }), ok: t('hours.grid.dirtyOk'), danger: true }))) return;
    focusAfterNav('.hours-trucks .chip[aria-pressed="true"]');
    navigate(`/hours/${id}`, { replace: true });
  };
  useEffect(restoreFocus, []);
  const pickPhoneDay = (x: number) => { setPhoneDay(x); if (mode === 'day') setChosen(nextDow(today, x)); };
  const pickMode = (m: Mode) => { setMode(m); if (m === 'day') setPhoneDay(dow(from)); };
  const pickFrom = (v: Day) => { setChosen(v); if (mode === 'day') setPhoneDay(dow(v)); };

  /* ---------- « Appliquer » ---------- */
  /* the new hours close a day (or a block; arrival windows: the hours of a window told to a customer) that has appointments,
     and the garage has the other kind of vehicle: ask first */
  const [closing, setClosing] = useState<Move[] | null>(null);
  const [moving, setMoving] = useState(false);
  /** the appointments the new hours leave out, and where each can go (null: nothing to ask) */
  const movesNow = (): Move[] | null => {
    if (!truckId) return null;
    const hit = closedJobs(allJobs.value, truckId, plan.week, plan.dates, blockOfKey);
    const targets = otherKind(activeTrucks.value, truckId);
    if (!hit.length || !targets.length) return null;
    return movesFor(hit, targets, truckRanges, blockOfKey, {
      mayMove: (to) => mayMoveBetween(truckId, to, { book: can('book'), mine }),
      roomOf: (to, job) => {
        const b = blockLoad(job.day, job.block, { exclude: job.id });
        const x = b.trucks.find((y) => y.truck.id === to);
        return x ? { left: x.left, started: b.started } : null;
      },
      travelMin: Number(settings.value.booking.unknown_min) || 0
    });
  };
  /** sends the hours; true when the server took them (or kept on the phone) */
  const apply = async (asked = false): Promise<boolean> => {
    if (!truckId || plan.empty) return false;
    if (!asked) { const m = movesNow(); if (m) { setClosing(m); return false; } }
    let r: Awaited<ReturnType<typeof applyHours>>;
    // not run(): a change kept on the phone has its own words here (« Horaire gardé sur le téléphone »)
    try { r = await applyHours(truckId, mode, plan.week, mode === 'always' ? today : from, weeks); }
    catch (e) { toast(errorMessage(e), { kind: 'bad' }); return false; }
    if (r.queued) { toast(t('hours.apply.queued')); return true; }
    if ((r.data as { changed?: number } | undefined)?.changed === 0) toast(t('hours.apply.nothingChanged'));
    else toast(mode === 'day' ? t('hours.apply.doneDay', { day: longDay(from, l) }) : mode === 'weeks' ? t('hours.apply.doneWeeks', { weeks: t('hours.apply.weeksN', { n: weeks }) }) : t('hours.apply.doneAlways'), { kind: 'ok' });
    // the server re-planned the blocks touched: bring the hours and the jobs now
    await run(() => Promise.all([pull('truck_week'), pull('truck_days'), pull('jobs')]), { quiet: true });
    // one day or a few weeks: the usual week did not change, the window shows it again
    if (mode !== 'always') d.reset();
    return true;
  };
  /** « Déplacer vers … »: every appointment first (while its vehicle is still open), then the hours; a refusal stops before
      the hours, and the sheet stays open with what is left (map-hours-01, -07). « Fermer sans déplacer »: the hours only. */
  const closeWith = async (move: boolean) => {
    const list = closing || [];
    setMoving(true);
    try {
      if (move) {
        const r = await moveAll(list, (m) => moveJob(m.job.id, m.job.day, m.job.block as BlockKey, m.target, keepWindow(m.job)));
        if (r.kind !== 'done') {
          toast(r.kind === 'waiting' ? t('hours.closing.waiting') : t('hours.closing.refused', { n: r.moved.length, reason: errorMessage(r.error) }), { kind: 'bad', ms: 9000 });
          setClosing(movesNow());
          return;
        }
      }
      if (!(await apply(true))) return;
      setClosing(null);
      if (move) {
        const moved = list.filter((m) => m.target);
        const left = list.length - moved.length;
        const to = t(`hours.closing.to.${truckRow(moved[0]?.target)?.tire_machine === false ? 'car' : 'truck'}`);
        toast(left ? t('hours.closing.donePart', { n: moved.length, total: list.length, to }) : t('hours.closing.done', { n: moved.length, to }), { kind: left ? 'info' : 'ok', ms: 9000 });
      }
    } finally { setMoving(false); }
  };

  /* ---------- the screen ---------- */
  const help = t(windowsOn.value ? 'hours.win.help' : 'hours.help');
  if (!list.length && !net.value.ready) {
    return (
      <Page title={t('hours.title')} sub={t('hours.sub')} help={help}>
        <Panel><div aria-busy="true"><span class="sr-only">{t('common.loading')}</span><Skeleton h={48} w="60%" /><div style={{ height: '16px' }} /><Skeleton h={20} lines={8} /></div></Panel>
      </Page>
    );
  }
  if (!list.length) {
    return (
      <Page title={t('hours.title')} sub={t('hours.sub')} help={help}>
        <Panel><Empty icon={<TruckIcon />} title={t('hours.noTruck')} text={manage ? t('hours.noTruckText') : t('hours.noTruckOther')} /></Panel>
        {manage && <TrucksPanel onAdded={(id) => navigate(`/hours/${id}`, { replace: true })} />}
      </Page>
    );
  }
  return (
    <Page title={t('hours.title')} sub={t('hours.sub')} help={help} wide={isWide} data-testid="hours-screen">
      <div class="hours-trucks" data-tour="hours-truck">
        <Chips label={t('hours.trucks')} value={truckId ? [truckId] : []} onValue={(v) => { if (v[0]) void pickTruck(v[0]); }} data-testid="hours-trucks"
          options={list.map((x) => ({
            value: x.id,
            label: <span class="hours-chip"><span class="hours-dot" style={{ background: truckColor(x.id) }} aria-hidden="true" />{truckLabel(x.id)}{!x.active && <span class="hours-chip-off">{t('hours.inactive')}</span>}</span>
          }))} />
      </div>
      {!canEdit && truckId && <Banner kind="info">{t('hours.readOnly')}</Banner>}
      <div class={`hours-layout${isWide ? ' is-wide' : ''}`}>
        {truckId && tr && (
          <HoursGridPanel truckId={truckId} wide={isWide} editable={canEdit} draft={d.draft} dirtyDays={d.dirtyDays} onPanes={d.setDraft} onReset={d.reset}
            week={week} shownDay={shownDay} onShownDay={pickPhoneDay} oneDay={mode === 'day' ? from : null} />
        )}
        <div class="hours-side">
          {truckId && (
            <ApplyPanel mode={mode} onMode={pickMode} weeks={weeks} onWeeks={setWeeks} from={from} onFrom={pickFrom} today={today} lastDay={lastDay}
              plan={plan} jobsHit={jobsHit} alwaysReplaces={alwaysReplaces} blind={blind} canEdit={canEdit} onApply={() => apply()} />
          )}
          {truckId && <ChangedDays truckId={truckId} usual={usual} today={today} canEdit={canEdit} />}
          {truckId && <TruckStartPanel truckId={truckId} canEdit={canEdit} />}
        </div>
      </div>
      {manage && <TrucksPanel onAdded={(id) => navigate(`/hours/${id}`, { replace: true })} />}
      {closing && truckId && <CloseDaySheet truckId={truckId} moves={closing} busy={moving} onMove={() => closeWith(true)} onJustClose={() => closeWith(false)} onClose={() => { if (!moving) setClosing(null); }} />}
    </Page>
  );
}

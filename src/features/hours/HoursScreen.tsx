/* Horaires des camions — #/hours/:truck?
   Pick the truck, paint its usual week on the glass window, then say for when it counts: one day, a few weeks, or
   from now on (« Appliquer »). The dates that differ from the usual week are listed, each with « Revenir à l'horaire
   habituel ». The owner (or the « settings » right) also manages the trucks here. */
import { useEffect, useState } from 'preact/hooks';
import { RotateCcw, Truck as TruckIcon } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { navigate } from '../../app/router';
import { wide } from '../../app/media';
import { t, lang } from '../../lib/i18n';
import { addDays, dow, longDay, parseDay, duration, today as todayOf, isValidDay, type Day } from '../../lib/dates';
import { trucks, activeTrucks, truck as truckRow, truckLabel, truckColor, weekOf, truckRanges, settings, allJobs } from '../../data/select';
import { rowsOf } from '../../data/store';
import { applyHours } from '../../data/api';
import { deleteRow, pull, net } from '../../data/sync';
import { can, isOwner, myTrucks, preview } from '../../data/auth';
import type { TruckDay } from '../../data/types';
import { Page, Panel, Banner, Button, IconButton, Chips, Seg, Field, Stepper, DateInput, Empty, Skeleton, ask, attempt, toast } from '../../ui';
import { errorMessage } from '../../data/api';
import { HoursGrid, weekdayName } from './HoursGrid';
import { TrucksPanel } from './TrucksPanel';
import { TruckStartPanel } from './TruckStartPanel';
import { weekToPanes, changedDays, applyPlan, paneMinutes, FROM, TO, type Panes, type Mode } from './grid';
import { rangesWords, weekdaysWords } from './words';
import { spanEnds } from '../booking/when';
import { focusAfterNav, restoreFocus } from '../agenda/focus';
import './hours.css';

/** the next date (from today) that falls on that weekday */
function nextDow(from: Day, d: number): Day { const n = (d - dow(from) + 7) % 7; return addDays(from, n); }

export default function HoursScreen({ params }: ScreenProps) {
  const l = lang.value;
  const today = todayOf();
  const isWide = wide.value;
  const list = trucks.value;
  const mine = myTrucks();
  const truckId = (params.truck && truckRow(params.truck) && !truckRow(params.truck)?.deleted_at ? params.truck : null)
    || mine.find((id) => list.some((x) => x.id === id)) || activeTrucks.value[0]?.id || list[0]?.id || null;
  const tr = truckRow(truckId);
  const canEdit = !!truckId && (isOwner() || can('hours') || mine.includes(truckId)) && !preview.value;
  const manage = isOwner() || can('settings');
  const horizon = Number(settings.value.booking.horizon_days) || 120;

  /* ---------- the drawing: starts from the usual week; follows it while nothing is drawn ---------- */
  const usual = truckId ? weekOf(truckId) : {};
  const usualKey = JSON.stringify(usual);
  const [st, setSt] = useState(() => { const b = weekToPanes(usual); return { truck: truckId, key: usualKey, from: b, draft: b }; });
  useEffect(() => {
    const b = weekToPanes(usual);
    if (st.truck !== truckId) { setSt({ truck: truckId, key: usualKey, from: b, draft: b }); return; }
    if (st.key !== usualKey) {
      const dirty = changedDays(st.draft, st.from).length > 0;
      setSt(dirty ? { ...st, key: usualKey, from: b } : { truck: truckId, key: usualKey, from: b, draft: b });
    }
  }, [truckId, usualKey]);
  const draft = st.truck === truckId ? st.draft : weekToPanes(usual);
  const base = st.truck === truckId ? st.from : weekToPanes(usual);
  const setDraft = (p: Panes) => setSt((s) => ({ ...s, draft: p }));
  const dirtyDays = changedDays(draft, base);

  /* ---------- for when ---------- */
  const [mode, setMode] = useState<Mode>('always');
  const [weeks, setWeeks] = useState(2);
  const [from, setFrom] = useState<Day>(today);
  const [phoneDay, setPhoneDay] = useState<number>(() => dow(today));
  const shownDay = mode === 'day' ? dow(from) : phoneDay;
  const lastDay = addDays(today, horizon);
  const plan = applyPlan(mode, draft, usual, { from, weeks, today, until: lastDay, actual: truckId ? truckRanges(truckId, from) : [] });
  const jobsHit = truckId ? allJobs.value.filter((j) => j.truck_id === truckId && j.status === 'booked' && j.day >= today && plan.dates.includes(j.day)).length : 0;
  const exceptions = rowsOf<TruckDay>('truck_days').filter((x) => x.truck_id === truckId && !x.deleted_at && x.day >= today).sort((a, b) => a.day.localeCompare(b.day));
  const alwaysReplaces = mode === 'always' && exceptions.some((x) => plan.dows.includes(dow(x.day)));
  const outsideHours = Object.values(usual).some((rs) => rs.some(([a, b]) => a < FROM || b > TO));

  const pickTruck = async (id: string) => {
    if (id === truckId) return;
    if (dirtyDays.length && !(await ask({ title: t('hours.grid.dirtyTruck'), text: t('hours.grid.dirtyTruckText', { truck: truckLabel(truckId) }), ok: t('hours.grid.dirtyOk'), danger: true }))) return;
    focusAfterNav('.hours-trucks .chip[aria-pressed="true"]');
    navigate(`/hours/${id}`, { replace: true });
  };
  useEffect(restoreFocus, []);
  const pickPhoneDay = (d: number) => { setPhoneDay(d); if (mode === 'day') setFrom(nextDow(today, d)); };

  /* ---------- « Appliquer » ---------- */
  const apply = async () => {
    if (!truckId || plan.empty) return;
    try {
      const r = await applyHours(truckId, mode, plan.week, mode === 'always' ? today : from, weeks);
      if (r.queued) { toast(t('hours.apply.queued')); return; }
      toast(mode === 'day' ? t('hours.apply.doneDay', { day: longDay(from, l) }) : mode === 'weeks' ? t('hours.apply.doneWeeks', { weeks: t('hours.apply.weeksN', { n: weeks }) }) : t('hours.apply.doneAlways'), { kind: 'ok' });
      // the server re-planned the blocks touched: bring the hours and the jobs now
      await Promise.all([pull('truck_week'), pull('truck_days'), pull('jobs')]).catch(() => undefined);
      // one day or a few weeks: the usual week did not change, the window shows it again
      if (mode !== 'always') setSt((s) => ({ ...s, draft: s.from }));
    } catch (e) {
      toast(errorMessage(e), { kind: 'bad' });
    }
  };
  const revert = (x: TruckDay) => attempt(() => deleteRow('truck_days', x.id, { label: t('log.hours') }), { ok: t('hours.exceptions.reverted', { day: longDay(x.day, l) }) });

  /* ---------- words ---------- */
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const effect = plan.empty ? '' : mode === 'day'
    ? t('hours.apply.effectDay', { day: longDay(from, l), hours: lower(rangesWords(plan.week[dow(from)] || [], l)) })
    : mode === 'weeks'
      ? t('hours.apply.effectWeeks', { days: weekdaysWords(plan.dows, l), weeks: t('hours.apply.weeksN', { n: weeks }), ...spanEnds(from, addDays(from, weeks * 7 - 1), l, today) })
      : t('hours.apply.effectAlways', { days: weekdaysWords(plan.dows, l) });
  const dayLabel = from === today ? t('hours.apply.today') : t('hours.apply.oneDay', { day: new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'short', day: 'numeric', month: 'short' }).format(parseDay(from)) });

  /* ---------- the screen ---------- */
  if (!list.length && !net.value.ready) {
    return (
      <Page title={t('hours.title')} sub={t('hours.sub')} help={t('hours.help')}>
        <Panel><div aria-busy="true"><span class="sr-only">{t('common.loading')}</span><Skeleton h={48} w="60%" /><div style={{ height: '16px' }} /><Skeleton h={20} lines={8} /></div></Panel>
      </Page>
    );
  }
  if (!list.length) {
    return (
      <Page title={t('hours.title')} sub={t('hours.sub')} help={t('hours.help')}>
        <Panel><Empty icon={<TruckIcon />} title={t('hours.noTruck')} text={manage ? t('hours.noTruckText') : t('hours.noTruckOther')} /></Panel>
        {manage && <TrucksPanel onAdded={(id) => navigate(`/hours/${id}`, { replace: true })} />}
      </Page>
    );
  }
  const truckChips = (
    <div class="hours-trucks" data-tour="hours-truck">
      <Chips label={t('hours.trucks')} value={truckId ? [truckId] : []} onValue={(v) => { if (v[0]) void pickTruck(v[0]); }} data-testid="hours-trucks"
        options={list.map((x) => ({
          value: x.id,
          label: <span class="hours-chip"><span class="hours-dot" style={{ background: truckColor(x.id) }} aria-hidden="true" />{truckLabel(x.id)}{!x.active && <span class="hours-chip-off">{t('hours.inactive')}</span>}</span>
        }))} />
    </div>
  );
  const gridPanel = truckId && tr && (
    <Panel class="hours-gridpanel" title={t('hours.grid.usual')}
      sub={<span class={dirtyDays.length ? 'hours-dirty' : ''}>{dirtyDays.length ? t('hours.grid.changed', { n: dirtyDays.length })
        : isWide ? t('hours.grid.total', { d: duration(Object.values(draft).reduce((n, ps) => n + paneMinutes(ps), 0), l) })
        : `${weekdayName(shownDay, l)} : ${lower(rangesWords(usual[shownDay] || [], l))}`}</span>}
      action={
        // always there (hidden when nothing changed): the window must not move under the finger when painting starts
        <span class={`hours-reset${dirtyDays.length ? '' : ' is-hidden'}`} aria-hidden={dirtyDays.length ? undefined : 'true'}>
          {isWide
            ? <Button size="sm" variant="ghost" icon={<RotateCcw />} disabled={!dirtyDays.length} onClick={() => setSt((s) => ({ ...s, draft: s.from }))} data-testid="hours-reset">{t('hours.grid.reset')}</Button>
            : <IconButton icon={<RotateCcw />} label={t('hours.grid.reset')} disabled={!dirtyDays.length} onClick={() => setSt((s) => ({ ...s, draft: s.from }))} data-testid="hours-reset" />}
        </span>
      }>
      {!isWide && (
        <div class="hours-days" role="group" aria-label={t('hours.grid.days')}>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => {
            const lit = (draft[d] || []).length > 0;
            return (
              <button key={d} type="button" class={`hours-daychip${d === shownDay ? ' is-on' : ''}${dirtyDays.includes(d) ? ' is-changed' : ''}`} aria-pressed={d === shownDay}
                onClick={() => pickPhoneDay(d)} data-testid={`hours-day-${d}`}>
                <span>{weekdayName(d, l, 'short')}</span>
                <span class={`hours-daychip-dot${lit ? ' is-lit' : ''}`} aria-hidden="true" />
                {dirtyDays.includes(d) && <span class="sr-only">{t('hours.grid.changedDay')}</span>}
              </button>
            );
          })}
        </div>
      )}
      <HoursGrid panes={draft} onPanes={setDraft} color={truckColor(truckId)} truckName={truckLabel(truckId)} editable={canEdit} week={isWide} day={shownDay}
        dim={mode === 'day' ? [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== dow(from)) : undefined} changed={dirtyDays} />
      {outsideHours && <p class="faint small hours-note">{t('hours.grid.outside')}</p>}
    </Panel>
  );
  const applyPanel = truckId && (
    <Panel class="hours-apply" title={t('hours.apply.title')} data-tour="hours-apply" data-testid="hours-apply">
      <div class="stack">
        <Field label={t('hours.apply.mode')} group>
          <Seg value={mode} onValue={(m) => { setMode(m); if (m === 'day') setPhoneDay(dow(from)); }} label={t('hours.apply.mode')} class="hours-modes" data-testid="hours-mode"
            options={[{ value: 'day', label: dayLabel }, { value: 'weeks', label: t('hours.apply.weeks', { weeks: t('hours.apply.weeksN', { n: weeks }) }) }, { value: 'always', label: t('hours.apply.always') }]} />
        </Field>
        {mode === 'weeks' && (
          <Field label={t('hours.apply.weeksLabel')} group>
            <Stepper value={weeks} min={1} max={12} label={t('hours.apply.weeksLabel')} format={(n) => t('hours.apply.weeksN', { n })} onValue={setWeeks} />
          </Field>
        )}
        {mode !== 'always' && (
          <Field label={mode === 'day' ? t('hours.apply.on') : t('hours.apply.from')}>
            <DateInput value={from} min={today} max={lastDay} onValue={(v) => { if (isValidDay(v) && v >= today) { setFrom(v); if (mode === 'day') setPhoneDay(dow(v)); } }} />
          </Field>
        )}
        <div class="hours-effect" aria-live="polite" data-testid="hours-effect">
          {plan.empty ? <p class="muted">{mode === 'day' ? t('hours.apply.nothingDay') : t('hours.apply.nothing')}</p> : (
            <>
              <p class="hours-effect-what">{effect}</p>
              {alwaysReplaces && <p>{t('hours.apply.effectAlwaysDays')}</p>}
              <p>{t('hours.apply.tail')}</p>
              {jobsHit > 0 && <p class="hours-effect-jobs">{t('hours.apply.jobs', { n: jobsHit })}</p>}
            </>
          )}
        </div>
        <Button variant="primary" block disabled={plan.empty || !canEdit} onClick={apply} data-testid="hours-apply-btn">{t('hours.apply.button')}</Button>
      </div>
    </Panel>
  );
  const exceptionsPanel = truckId && (
    <Panel title={t('hours.exceptions.title')} sub={t('hours.exceptions.sub')} data-testid="hours-exceptions">
      {!exceptions.length ? <p class="muted small" style={{ margin: 0 }}>{t('hours.exceptions.none')}</p> : (
        <ul class="hours-exc">
          {exceptions.map((x) => (
            <li key={x.id}>
              <span class="hours-exc-main">
                <b>{longDay(x.day, l)}</b>
                <span class={(x.ranges || []).length ? '' : 'hours-exc-closed'}>{rangesWords(x.ranges || [], l)}</span>
                <span class="faint small">{t('hours.exceptions.usual', { hours: lower(rangesWords(usual[dow(x.day)] || [], l)) })}</span>
              </span>
              {canEdit && <Button size="sm" onClick={() => revert(x)} data-testid={`hours-revert-${x.day}`}>{t('hours.exceptions.revert')}</Button>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
  return (
    <Page title={t('hours.title')} sub={t('hours.sub')} help={t('hours.help')} wide={isWide} data-testid="hours-screen">
      {truckChips}
      {!canEdit && truckId && <Banner kind="info">{t('hours.readOnly')}</Banner>}
      <div class={`hours-layout${isWide ? ' is-wide' : ''}`}>
        {gridPanel}
        <div class="hours-side">
          {applyPanel}
          {exceptionsPanel}
          {truckId && <TruckStartPanel truckId={truckId} canEdit={canEdit} />}
        </div>
      </div>
      {manage && <TrucksPanel onAdded={(id) => navigate(`/hours/${id}`, { replace: true })} />}
    </Page>
  );
}

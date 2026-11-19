/* « Heures travaillées » (#/timesheet, Part 26): the days of work from « Commencer / Terminer ma journée », a week at a time
   (Monday to Sunday). A mechanic sees only his own week (« Mes heures »). The owners and the treasurer see the team
   (#/timesheet: each person's week), open a person (#/timesheet/STAFF), and correct a day (ShiftSheet): a day closed by
   the night because « Terminer ma journée » was forgotten is « À vérifier ». Rules in logic.ts. */
import { useEffect, useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, Pencil, Plus } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { may } from '../../app/routes';
import { t, lang } from '../../lib/i18n';
import { addDays, clock, isValidDay, longDay, monthName, today, type Day } from '../../lib/dates';
import { me } from '../../data/auth';
import { rowsOf } from '../../data/store';
import { staff as staffRow, staffList } from '../../data/select';
import type { Shift } from '../../data/types';
import { Page, Panel, Rows, RowItem, Button, IconButton, Banner, Empty, Pill, Avatar } from '../../ui';
import { ShiftSheet } from './ShiftSheet';
import { dayOfIso, decimalHours, hoursText, minuteOfIso, monthOf, mondayOf, periodMinutes, teamWeek, toCheck, weekHours, weekLabel, type DayHours } from './logic';
import './timesheet.css';

export default function TimesheetScreen({ params, query }: ScreenProps) {
  const all = may.timesheetAll();
  const mine = me.value?.id || null;
  const now = useTick(30_000);
  const [anchor, setAnchor] = useState<Day>(() => { const w = query.get('week'); return isValidDay(w) ? w : today(); });
  const monday = mondayOf(anchor);
  // a mechanic only ever sees his own days, whatever the address says
  const person = all ? (params.staff || null) : mine;
  const row = person ? staffRow(person) : undefined;
  const title = !all ? t('timesheet.mine') : person ? (row?.full_name || t('timesheet.title')) : t('timesheet.title');
  return (
    <Page title={title} help={t(all ? 'timesheet.helpAll' : 'timesheet.help')}
      back={all && person ? `/timesheet?week=${monday}` : undefined} data-testid="ts-screen">
      <WeekNav monday={monday} onDay={setAnchor} />
      {!person && all && <TeamWeek monday={monday} now={now} />}
      {person && (row && !row.deleted_at
        ? <PersonWeek staffId={person} monday={monday} now={now} all={all} />
        : <Panel><Empty title={t('timesheet.nobody')} text={t('timesheet.nobodyText')} /></Panel>)}
    </Page>
  );
}

function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

function WeekNav(p: { monday: Day; onDay: (d: Day) => void }) {
  const cur = mondayOf(today());
  return (
    <div class="ts-weeknav" data-testid="ts-weeknav">
      <IconButton icon={<ChevronLeft />} label={t('timesheet.week.prev')} onClick={() => p.onDay(addWeek(p.monday, -1))} data-testid="ts-prev" />
      <b class="ts-weeklabel num" data-testid="ts-week">{weekLabel(p.monday, lang.value)}</b>
      <IconButton icon={<ChevronRight />} label={t('timesheet.week.next')} disabled={p.monday >= cur} onClick={() => p.onDay(addWeek(p.monday, 1))} data-testid="ts-next" />
      {p.monday !== cur && <Button size="sm" variant="ghost" onClick={() => p.onDay(today())} data-testid="ts-now">{t('timesheet.week.now')}</Button>}
    </div>
  );
}
const addWeek = (monday: Day, n: number): Day => addDays(monday, 7 * n);

/* ---------- the owners and the treasurer: the team's week ---------- */
function TeamWeek(p: { monday: Day; now: number }) {
  const l = lang.value;
  const rows = teamWeek(rowsOf<Shift>('shifts'), staffList.value, p.monday, p.now);
  const total = rows.reduce((n, r) => n + r.week.minutes, 0);
  return (
    <Panel title={t('timesheet.team')} sub={t('timesheet.teamSub')} flush data-testid="ts-team" id="ts-team-rows">
      {!rows.length ? <Empty title={t('timesheet.nobody')} text={t('timesheet.nobodyText')} /> : (
        <Rows>
          {rows.map((r) => {
            const open = r.week.days.flatMap((d) => d.shifts).find((s) => !s.ended_at);
            const sub = <>{t('timesheet.days', { n: r.week.daysWorked })}{open && <span class="ts-live ts-onshift">{t('timesheet.onShift', { time: clock(minuteOfIso(open.started_at), l).replace(/ /g, '\u00a0') })}</span>}</>;
            return (
              <RowItem key={r.staff.id} href={`#/timesheet/${r.staff.id}?week=${p.monday}`} chevron data-testid={`ts-person-${r.staff.id}`}
                start={<Avatar name={r.staff.full_name} color={r.staff.color} />}
                title={r.staff.full_name} sub={sub}
                end={<span class="ts-end">
                  <b class="num" data-testid={`ts-person-total-${r.staff.id}`}>{hoursText(r.week.minutes, l)}</b>
                  {r.week.check > 0 && <Pill tone="warn" data-testid={`ts-person-check-${r.staff.id}`}>{t('timesheet.checkCount', { n: r.week.check })}</Pill>}
                </span>} />
            );
          })}
          <div class="row-item ts-team-total" role="listitem">
            <span class="row-main"><span class="row-title">{t('timesheet.teamTotal')}</span><span class="row-sub">{decimalHours(total, l)}</span></span>
            <span class="row-end"><b class="num" data-testid="ts-team-total">{hoursText(total, l)}</b></span>
          </div>
        </Rows>
      )}
    </Panel>
  );
}

/* ---------- one person's week ---------- */
function PersonWeek(p: { staffId: string; monday: Day; now: number; all: boolean }) {
  const l = lang.value;
  const shifts = rowsOf<Shift>('shifts');
  const w = weekHours(shifts, p.staffId, p.monday, p.now);
  const month = monthOf(p.monday);
  const monthMin = periodMinutes(shifts, p.staffId, month.from, month.to, p.now);
  const [edit, setEdit] = useState<{ shift?: Shift; day?: Day } | null>(null);
  const day0 = today();
  const firstEmpty = w.days.find((d) => !d.shifts.length && d.day <= day0)?.day || (w.days[0].day <= day0 ? w.days[0].day : day0);
  return (
    <>
      <Panel data-testid="ts-totals">
        <div class="ts-totals">
          <div class="ts-total">
            <span class="muted small">{t('timesheet.total')}</span>
            <b class="num ts-big" data-testid="ts-week-total">{hoursText(w.minutes, l)}</b>
            <span class="muted small">{decimalHours(w.minutes, l)} · {t('timesheet.days', { n: w.daysWorked })}</span>
          </div>
          <div class="ts-total">
            <span class="muted small">{t('timesheet.month', { month: monthName(month.from, l) })}</span>
            <b class="num" data-testid="ts-month-total">{hoursText(monthMin, l)}</b>
            <span class="muted small">{decimalHours(monthMin, l)}</span>
          </div>
        </div>
      </Panel>
      {w.check > 0 && <Banner kind="warn" data-testid="ts-check-banner">{t(p.all ? 'timesheet.checkAll' : 'timesheet.checkMine', { n: w.check })}</Banner>}
      <Panel title={t('timesheet.list')} flush data-testid="ts-days"
        action={p.all ? <Button size="sm" icon={<Plus />} onClick={() => setEdit({ day: firstEmpty })} data-testid="ts-add">{t('timesheet.add')}</Button> : undefined}>
        <Rows>
          {w.days.map((d) => <DayRow key={d.day} d={d} all={p.all} now={p.now} onEdit={(shift) => setEdit({ shift })} onAdd={() => setEdit({ day: d.day })} />)}
        </Rows>
      </Panel>
      {p.all && <ShiftSheet open={!!edit} onClose={() => setEdit(null)} staffId={p.staffId} shift={edit?.shift} day={edit?.day} />}
    </>
  );
}

function DayRow(p: { d: DayHours<Shift>; all: boolean; now: number; onEdit: (s: Shift) => void; onAdd: () => void }) {
  const l = lang.value;
  const { d } = p;
  const isToday = d.day === today();
  const name = longDay(d.day, l);
  return (
    <div class={`row-item ts-day${d.shifts.length ? '' : ' is-off'}${isToday ? ' is-today' : ''}`} role="listitem" data-testid={`ts-day-${d.day}`}>
      <span class="row-main">
        <span class="row-title">{name.charAt(0).toUpperCase() + name.slice(1)}</span>
        {!d.shifts.length && <span class="row-sub">{t('timesheet.off')}</span>}
        {d.shifts.map((s) => <ShiftLine key={s.id} s={s} all={p.all} onEdit={() => p.onEdit(s)} />)}
      </span>
      <span class="row-end">
        {d.shifts.length
          ? <b class="num" data-testid={`ts-day-total-${d.day}`}>{hoursText(d.minutes, l)}</b>
          : p.all && d.day <= today() && <Button size="sm" variant="ghost" icon={<Plus />} onClick={p.onAdd} data-testid={`ts-add-${d.day}`}>{t('timesheet.addHere')}</Button>}
      </span>
    </div>
  );
}

function ShiftLine(p: { s: Shift; all: boolean; onEdit: () => void }) {
  const l = lang.value;
  const { s } = p;
  const from = clock(minuteOfIso(s.started_at), l);
  const check = toCheck(s);
  const inner = (
    <>
      {s.ended_at
        ? <span class="num">{from} → {clock(minuteOfIso(s.ended_at), l)}{dayOfIso(s.ended_at) !== dayOfIso(s.started_at) && <span class="muted"> ({t('timesheet.nextDay')})</span>}</span>
        : <span class="ts-live">{t('timesheet.open', { time: from })}</span>}
      {check && <Pill tone="warn">{t('timesheet.check')}</Pill>}
      {!check && s.fixed_at && <span class="faint small">{t('timesheet.fixedShort')}</span>}
      {p.all && <Pencil class="ts-pen" size={14} aria-hidden="true" />}
    </>
  );
  return p.all
    ? <button type="button" class={`ts-shift is-btn${check ? ' is-check' : ''}`} onClick={p.onEdit} data-testid={`ts-shift-${s.id}`}>{inner}</button>
    : <span class={`ts-shift${check ? ' is-check' : ''}`} data-testid={`ts-shift-${s.id}`}>{inner}</span>;
}

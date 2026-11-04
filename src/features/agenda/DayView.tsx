/* One day: the day in words, the week strip, then the three blocks with each truck as a lane (how full it is, its
   jobs in stop order), the jobs « À placer », and the cancelled / no-show jobs apart. */
import { useRef } from 'preact/hooks';
import { ChevronLeft, ChevronRight, CalendarSearch, Plus, TriangleAlert, Clock } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { addDays, longDay, clockRange, isValidDay, parseDay, today as todayOf, type Day } from '../../lib/dates';
import { blocks, truckLabel, truckColor } from '../../data/select';
import { may } from '../../app/routes';
import { href, navigate } from '../../app/router';
import { Panel, Button, IconButton, Empty } from '../../ui';
import { JobTicket } from '../jobs/JobTicket';
import { relativeDay } from '../booking/when';
import { fillOf, freeWords, fillWords, weekOfDay } from './layout';
import { blockView, dayJobs, isOff, type BlockView } from './select';
import type { TruckBlock } from '../../data/select';
import { focusAfterNav } from './focus';

/* ---------- the day in words, with the days around ---------- */
export function DayHead(p: { day: Day; onDay: (d: Day) => void }) {
  const l = lang.value;
  const todayDay = todayOf();
  const rel = relativeDay(p.day, todayDay, l);
  return (
    <div class="agenda-dayhead" data-tour="agenda-day">
      <IconButton icon={<ChevronLeft />} label={t('agenda.day.prev')} onClick={() => { focusAfterNav('[data-testid="agenda-prev"]'); p.onDay(addDays(p.day, -1)); }} data-testid="agenda-prev" />
      <div class="agenda-dayhead-mid" aria-live="polite" aria-atomic="true">
        <span class={`agenda-rel${p.day === todayDay ? ' is-today' : ''}`}>{rel || ' '}</span>
        <span class="agenda-date" data-testid="agenda-date" tabIndex={-1}>{longDay(p.day, l)}</span>
      </div>
      <IconButton icon={<ChevronRight />} label={t('agenda.day.next')} onClick={() => { focusAfterNav('[data-testid="agenda-next"]'); p.onDay(addDays(p.day, 1)); }} data-testid="agenda-next" />
    </div>
  );
}

/** a calendar button that opens the phone's own date picker */
export function DatePick(p: { value: Day; onPick: (d: Day) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const open = () => {
    const el = input.current;
    if (!el) return;
    try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { el.focus(); el.click(); }
  };
  return (
    <span class="agenda-datepick">
      <IconButton icon={<CalendarSearch />} label={t('agenda.day.pick')} onClick={open} data-testid="agenda-pick" />
      <input ref={input} type="date" class="agenda-datepick-input" tabIndex={-1} aria-hidden="true" value={p.value}
        onChange={(e) => { const v = (e.currentTarget as HTMLInputElement).value; if (isValidDay(v)) { focusAfterNav('[data-testid="agenda-pick"]'); p.onPick(v); } }} />
    </span>
  );
}

/* ---------- the week, as a strip of days (tap one) ---------- */
export function WeekStrip(p: { day: Day; onDay: (d: Day) => void }) {
  const l = lang.value;
  const todayDay = todayOf();
  const wd = new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'short' });
  return (
    <nav class="agenda-strip" aria-label={t('agenda.day.strip')}>
      {weekOfDay(p.day).map((d) => {
        const n = dayJobs(d).filter((j) => !isOff(j)).length;
        return (
          <a key={d} href={href(`/agenda/${d}`)} class={`agenda-strip-day${d === todayDay ? ' is-today' : ''}`} aria-current={d === p.day ? 'date' : undefined}
            aria-label={`${longDay(d, l)}, ${t('agenda.day.count', { n })}`} onClick={(e) => { e.preventDefault(); focusAfterNav(`[data-testid="strip-${d}"]`); p.onDay(d); }} data-testid={`strip-${d}`}>
            <span class="agenda-strip-wd">{wd.format(parseDay(d)).replace('.', '')}</span>
            <span class="agenda-strip-num">{parseDay(d).getDate()}</span>
            <span class="agenda-strip-count" aria-hidden="true">{n > 0 ? n : ''}</span>
          </a>
        );
      })}
    </nav>
  );
}

/* ---------- a truck in a block ---------- */
export function Meter(p: { used: number; cap: number; label: string; small?: boolean }) {
  const f = fillOf(p.used, p.cap);
  return (
    <span class={`agenda-meter${p.small ? ' is-small' : ''}${f.over ? ' is-over' : ''}`} role="meter" aria-label={p.label}
      aria-valuemin={0} aria-valuemax={Math.max(1, p.cap)} aria-valuenow={Math.min(Math.max(0, p.used), Math.max(1, p.cap))} aria-valuetext={fillWords(p.used, p.cap, lang.value)}>
      <span class="agenda-meter-fill" style={{ width: `${Math.round(f.pct * 100)}%` }} />
    </span>
  );
}
function Lane(p: { lane: TruckBlock; started: boolean }) {
  const l = lang.value;
  const { truck, cap, used, jobs } = p.lane;
  const name = truckLabel(truck.id);
  return (
    <div class="agenda-lane" style={{ '--tc': truckColor(truck.id) }} data-testid={`lane-${truck.id}`}>
      <div class="agenda-lane-head">
        <span class="agenda-dot" aria-hidden="true" />
        <span class="agenda-lane-name">{name}</span>
      </div>
      {!p.started && (
        <div class="agenda-lane-fill">
          {cap > 0 && <Meter used={used} cap={cap} label={name} />}
          <span class={`agenda-free${cap - used <= 0 ? ' is-full' : ''}`}>{freeWords(used, cap, l)}</span>
        </div>
      )}
      {jobs.length > 0 && <div class="agenda-tickets">{jobs.map((j) => <JobTicket key={j.id} job={j} />)}</div>}
    </div>
  );
}

/* ---------- a block of the day ---------- */
function BlockPanel(p: { day: Day; v: BlockView; first: boolean }) {
  const l = lang.value;
  const { v } = p;
  const closed = !v.open && !v.started;
  const full = v.open && !v.room;
  const status = v.past ? t('agenda.block.past') : v.started ? t('agenda.block.started') : closed ? t('agenda.block.closed') : full ? t('agenda.lane.full') : '';
  const canBook = may.book() && v.open && v.room;
  return (
    <Panel class={`agenda-block${v.started ? ' is-started' : ''}${closed ? ' is-closed' : ''}`} data-tour={p.first ? 'agenda-block' : undefined} data-testid={`block-${v.key}`}
      title={t('agenda.block.title', { block: t(`common.blocks.${v.key}`), hours: clockRange(v.start, v.end, l) })}
      action={status ? <span class={`agenda-status${closed ? ' is-closed' : ''}${full && !v.started ? ' is-full' : ''}`}>{v.started && <Clock size={14} aria-hidden="true" />}{status}</span> : undefined}>
      <div class="agenda-lanes">
        {closed && !v.lanes.length && !v.unplaced.length && <p class="muted small agenda-closed-text">{t('agenda.block.closedText')}</p>}
        {v.lanes.map((lane) => <Lane key={lane.truck.id} lane={lane} started={v.started} />)}
        {v.unplaced.length > 0 && (
          <div class="agenda-lane is-unplaced" data-testid="lane-unplaced">
            <div class="agenda-lane-head">
              <TriangleAlert size={18} aria-hidden="true" class="agenda-warn-icon" />
              <span class="agenda-lane-name">{t('agenda.lane.unplaced')}</span>
            </div>
            <p class="agenda-unplaced-text">{t('agenda.lane.unplacedText')}</p>
            <div class="agenda-tickets">{v.unplaced.map((j) => <JobTicket key={j.id} job={j} />)}</div>
          </div>
        )}
        {!closed && v.jobs === 0 && <p class="faint small agenda-empty-block">{t('agenda.block.empty')}</p>}
      </div>
      {canBook && (
        <div class="agenda-block-foot">
          <Button size="sm" variant="secondary" icon={<Plus />} href={href('/book', { day: p.day, block: v.key })} data-testid={`book-${v.key}`}>{t('agenda.block.book')}</Button>
        </div>
      )}
    </Panel>
  );
}

/* ---------- the day ---------- */
export function DayView(p: { day: Day; onDay: (d: Day) => void }) {
  const todayDay = todayOf();
  const views = blocks.value.map((b) => blockView(p.day, b, todayDay));
  const all = dayJobs(p.day);
  const off = all.filter(isOff);
  const active = all.length - off.length;
  const nobody = active === 0 && views.every((v) => !v.open && !v.started);
  return (
    <div class="agenda-day" data-testid="agenda-day">
      <DayHead day={p.day} onDay={p.onDay} />
      <WeekStrip day={p.day} onDay={p.onDay} />
      {nobody ? (
        <Panel>
          <Empty icon={<CalendarSearch />} title={t('agenda.day.nobody')} text={t('agenda.day.nobodyText')}
            action={may.hours() ? <Button href="#/hours" variant="secondary">{t('agenda.day.hours')}</Button> : undefined} />
        </Panel>
      ) : (
        <div class="agenda-blocks">
          {views.map((v, i) => <BlockPanel key={v.key} day={p.day} v={v} first={i === 0} />)}
        </div>
      )}
      {off.length > 0 && (
        <details class="agenda-off glass panel" data-testid="agenda-off">
          <summary><span class="panel-title">{t('agenda.off', { n: off.length })}</span></summary>
          <div class="agenda-tickets agenda-off-list">{off.map((j) => <JobTicket key={j.id} job={j} />)}</div>
        </details>
      )}
    </div>
  );
}

/** the address of a day (keeps the view chosen on the computer) */
export function dayHref(d: Day, view?: string | null): string { return href(`/agenda/${d}`, { view: view || null }); }
export function goDay(d: Day, view?: string | null) { navigate(dayHref(d, view).slice(1), { replace: true }); }

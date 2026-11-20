/* « Corriger la journée » / « Ajouter des heures » (owners and the treasurer only): the day, the start and the end of one
   day of work. A day still open keeps no end (it ends with « Terminer ma journée »). The rules are the server's
   (shift_save, Part 26), checked here first so the person sees the problem before sending (planDraft). */
import { useState } from 'preact/hooks';
import { Trash2 } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { addDays, clock, duration, hm, longDay, parseHm, stamp, today, type Day } from '../../lib/dates';
import { rowsOf } from '../../data/store';
import { staffName } from '../../data/select';
import { shiftSave, shiftRemove } from '../../data/api';
import type { Shift } from '../../data/types';
import { Sheet, Button, Field, DateInput, Banner, run } from '../../ui';
import { dayOfIso, minuteOfIso, planDraft, shiftsOfStaff, toCheck } from './logic';

export interface ShiftSheetProps { open: boolean; onClose: () => void; staffId: string; shift?: Shift | null; day?: Day }

export function ShiftSheet(p: ShiftSheetProps) {
  if (!p.open) return null;
  return <ShiftOpen {...p} key={p.shift?.id || `new-${p.day || ''}`} />;
}

function ShiftOpen(p: ShiftSheetProps) {
  const l = lang.value;
  const s = p.shift || null;
  const open = !!s && !s.ended_at;
  const forgot = !!s && toCheck(s);
  const [day, setDay] = useState<Day>(() => (s ? dayOfIso(s.started_at) : p.day || today()));
  const [start, setStart] = useState<number | null>(() => (s ? minuteOfIso(s.started_at) : null));
  // a day closed by the night: the end is left empty, to be written (the 3 h 17 is not a real end)
  const [end, setEnd] = useState<number | null>(() => (s && s.ended_at && !forgot ? minuteOfIso(s.ended_at) : null));
  const [tried, setTried] = useState(false);
  const others = shiftsOfStaff(rowsOf<Shift>('shifts'), p.staffId);
  const r = planDraft({ day, start, end }, { open, others, selfId: s?.id });
  const who = staffName(p.staffId);

  const save = async () => {
    setTried(true);
    if (!r.plan) return;
    const plan = r.plan;
    const ok = await run(() => shiftSave(s?.id || null, p.staffId, plan.startIso, plan.endIso), { ok: t('timesheet.sheet.saved') });
    if (ok) p.onClose();
  };
  const remove = async () => {
    if (!s) return;
    const ok = await run(() => shiftRemove(s.id), { ok: t('timesheet.sheet.removed') });
    if (ok) p.onClose();
  };
  const showErr = r.error && (tried || (start != null && (open || end != null)));
  return (
    <Sheet open onClose={p.onClose} title={t(s ? 'timesheet.sheet.edit' : 'timesheet.sheet.add')} sub={who} data-testid="ts-sheet"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={save} data-testid="ts-save">{t('timesheet.sheet.save')}</Button>
      </>}>
      <div class="stack">
        {forgot && s?.ended_at && <Banner kind="warn" data-testid="ts-forgot">{t('timesheet.sheet.forgot', { time: clock(minuteOfIso(s.ended_at), l) })}</Banner>}
        <Field label={t('timesheet.sheet.day')}>
          <DateInput value={day} max={today()} onValue={(v) => v && setDay(v)} aria-label={t('timesheet.sheet.day')} />
        </Field>
        <div class="ts-times">
          <Field label={t('timesheet.sheet.start')}>
            <TimeField value={start} onValue={setStart} label={t('timesheet.sheet.start')} testid="ts-start" invalid={!!showErr && (r.error === 'no_start')} />
          </Field>
          <Field label={t('timesheet.sheet.end')}>
            {open
              ? <p class="small muted ts-open-end" data-testid="ts-open-end">{t('timesheet.sheet.openEnd', { name: who })}</p>
              : <TimeField value={end} onValue={setEnd} label={t('timesheet.sheet.end')} testid="ts-end" invalid={!!showErr && r.error === 'no_end'} />}
          </Field>
        </div>
        {r.plan && (
          <p class="ts-length" data-testid="ts-length">
            <b class="num">{t('timesheet.sheet.total', { time: duration(r.plan.minutes, l) })}</b>
            {r.plan.nextDay && <span class="muted small"> {t('timesheet.sheet.nextDay', { day: longDay(addDays(day, 1), l) })}</span>}
          </p>
        )}
        {showErr && <Banner kind="warn" data-testid="ts-error">{t(`timesheet.sheet.errors.${r.error}`)}</Banner>}
        {s?.fixed_at && <p class="small muted" style={{ margin: 0 }}>{t('timesheet.fixed', { who: staffName(s.fixed_by), when: stamp(s.fixed_at, l) })}</p>}
        <p class="small faint" style={{ margin: 0 }}>{t('timesheet.sheet.kept')}</p>
        {s && !open && <div><Button variant="ghost" size="sm" icon={<Trash2 />} confirm={t('timesheet.sheet.removeConfirm')} onClick={remove} data-testid="ts-remove">{t('timesheet.sheet.remove')}</Button></div>}
      </div>
    </Sheet>
  );
}

/** a time of day to the minute; empty until typed */
function TimeField(p: { value: number | null; onValue: (v: number | null) => void; label: string; testid: string; invalid?: boolean }) {
  return (
    <input class="input ts-time" type="time" step={60} aria-label={p.label} aria-invalid={p.invalid || undefined} data-testid={p.testid}
      value={p.value == null ? '' : hm(p.value)}
      onInput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; p.onValue(v ? parseHm(v) : null); }} />
  );
}

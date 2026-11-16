/* The shift: start, end, time worked, and the position shared with the office while it is open. */
import { useRef } from 'preact/hooks';
import { Power, LocateOff } from 'lucide-preact';
import { Button, Help, toast } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { duration } from '../../lib/dates';
import { me } from '../../data/auth';
import { openShift, positionOf } from '../../data/select';
import { shiftStart, shiftEnd, errorMessage } from '../../data/api';
import { isNetworkError } from '../../data/sync';
import { clockOf, jobFirstName } from '../../shared/jobs/select';
import { sharing, retryPosition, agoText } from '../../services/position';
import { myJobsOn, shiftsOf } from './select';
import { workedMinutes } from './rules';
import { useTick, useToday } from './hooks';

/** calm: another red button leads the screen (the next stop): the shift's own button stays quiet */
export function ShiftCard(p: { compact?: boolean; calm?: boolean }) {
  const a = me.value;
  const now = useTick(30_000);
  const day = useToday();
  // one tap at a time: a second tap while the server answers would start (or end) the shift twice
  const busy = useRef(false);
  if (!a) return null;
  const open = openShift(a.id);
  const shifts = shiftsOf(a.id, day);
  const worked = workedMinutes(shifts, now);
  const l = lang.value;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy.current) return;
    busy.current = true;
    try { await fn(); toast(ok, { kind: 'ok' }); }
    catch (e) { toast(isNetworkError(e) ? t('today.shift.offline') : errorMessage(e), { kind: 'bad' }); }
    finally { busy.current = false; }
  };
  const last = shifts[shifts.length - 1];
  // ending the day stops the customer's live tracking of a stop on the way: the second tap says whose
  const onWay = open ? myJobsOn(day).find((j) => j.status === 'en_route') : undefined;
  const endConfirm = onWay ? t('today.shift.endConfirmTrip', { name: jobFirstName(onWay) }) : t('today.shift.endConfirm');
  return (
    <section class={`panel glass today-shift${open ? ' is-on' : ''}`} data-tour="today-shift" data-testid="today-shift">
      <div class="today-shift-row">
        <span class="today-shift-icon" aria-hidden="true"><Power /></span>
        <div class="grow">
          {open ? <>
            <h2 class="today-shift-title">{t('today.shift.started', { time: clockOf(open.started_at) })}</h2>
            <p class="today-shift-sub">{t('today.shift.worked', { time: duration(worked, l) })}</p>
          </> : last ? <>
            <h2 class="today-shift-title">{t('today.shift.ended', { time: clockOf(last.ended_at) })}</h2>
            <p class="today-shift-sub">{t('today.shift.endedSub', { time: duration(worked, l) })}</p>
          </> : <>
            <h2 class="today-shift-title">{t('today.shift.notStarted')}</h2>
            <p class="today-shift-sub">{t('today.shift.notStartedSub')} <Help text={t('today.shift.help')} /></p>
          </>}
        </div>
        {open
          ? <Button size={p.compact ? 'sm' : 'md'} confirm={endConfirm} onClick={() => act(shiftEnd, t('today.shift.endedToast'))} data-testid="shift-end">{t('today.shift.end')}</Button>
          : <Button variant={p.calm ? 'secondary' : 'primary'} onClick={() => act(shiftStart, t('today.shift.startedToast'))} data-testid="shift-start">{last ? t('today.shift.resume') : t('today.shift.start')}</Button>}
      </div>
      {open && <PositionLine now={now} />}
    </section>
  );
}

/** « Position partagée avec le bureau, il y a 1 min », or what is wrong in plain words */
function PositionLine(p: { now: number }) {
  const a = me.value;
  const s = sharing.value;
  const server = a ? positionOf(a.id)?.at : null;
  const at = Math.max(s.sentAt || 0, server ? Date.parse(server) : 0) || null;
  if (s.status === 'denied') {
    return (
      <div class="today-pos-off" role="status" data-testid="position-denied">
        <b><LocateOff aria-hidden="true" />{t('today.position.deniedTitle')}</b>
        <p>{t('today.position.denied')}</p>
        <p>{t('today.position.deniedHow')}</p>
        <Button size="sm" onClick={retryPosition}>{t('today.position.retry')}</Button>
      </div>
    );
  }
  if (s.status === 'unsupported') return <p class="today-pos is-off"><LocateOff aria-hidden="true" />{t('today.position.unsupported')}</p>;
  if (s.status === 'unavailable' && !at) return <p class="today-pos is-warn"><LocateOff aria-hidden="true" />{t('today.position.unavailable')}</p>;
  if (!at) return <p class="today-pos"><span class="today-pos-dot is-wait" aria-hidden="true" />{t('today.position.starting')}</p>;
  return (
    <p class="today-pos" data-testid="position-shared">
      <span class="today-pos-dot" aria-hidden="true" /><span>{t('today.position.shared', { ago: agoText(at, p.now) })}
        {s.status === 'unavailable' && <span class="faint"> {t('today.position.unavailable')}</span>}</span>
      <Help text={t('today.shift.help')} />
    </p>
  );
}

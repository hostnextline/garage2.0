/* « Plages d'arrivée »: a booked job dropped on a day (the week grid). The sheet asks the server which 4-hour windows
   are still possible that day (the best first), and offers « Flexible » (no window yet: fixed the evening before).
   One tap on a window is the move; the customer gets the usual text when the garage sends one for a change. A row that
   says « Arrivée vers 13 h 07 » moves the appointment to arrive at 13 h 07 exactly (« exact move », move.ts).
   It reads the job's live row (another phone may have moved it meanwhile) and closes when the agenda goes away. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Clock, CalendarRange, RefreshCw } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { today as todayOf, clock, type Day } from '../../lib/dates';
import { errorMessage, type Suggestion } from '../../data/api';
import { job as jobRow, daySpan, windowOf } from '../../data/select';
import type { Job } from '../../data/types';
import { Sheet, Button, Spinner } from '../../ui';
import { wantsText } from '../../shared/moment/notify';
import { moveDayTitle, windowChoices } from './layout';
import { windowMove, windowsFor, moveToWindow, farCheckDay, type FarAsk } from './move';
import { jobPerson } from '../../domain/jobs/words';

export function MoveWindowHost() {
  // the agenda leaves (a banner « Ouvrir », the back button): the move waiting for its window is dropped, so coming
  // back later does not reopen the sheet for an old job
  useEffect(() => () => { windowMove.value = null; }, []);
  const m = windowMove.value;
  const j = m ? jobRow(m.jobId) : undefined;
  // gone from this phone, or no longer booked (on the way, cancelled): nothing to move any more
  if (!m || !j || j.status !== 'booked') return null;
  return <MoveWindowSheet key={`${m.jobId}|${m.day}`} job={j} day={m.day} farDone={!!m.farDone} onClose={() => { windowMove.value = null; }} />;
}

function MoveWindowSheet(p: { job: Job; day: Day; farDone: boolean; onClose: () => void }) {
  const { job: j, day } = p;
  const l = lang.value;
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  // a tap is taken while the last one is still being answered (state alone would let a fast second tap through)
  const picking = useRef(false);
  // « garde-route »: asked once, while the windows load (not again when the drop on the grid already asked it)
  const far = useRef<Promise<FarAsk> | null | undefined>(undefined);
  if (far.current === undefined) far.current = p.farDone ? null : farCheckDay(j, day);
  useEffect(() => {
    let live = true;
    setList(null); setError(null);
    windowsFor(j, day).then((r) => { if (live) setList(r); }).catch((e) => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [turn]);
  const name = jobPerson(j);
  const sms = wantsText('moved', j.id);
  // « exact move »: each row prints the minute it sends, whose window IS the row's (review F1)
  const choices = list ? windowChoices(list, j, day, l, { span: daySpan.value, windowOf }) : [];
  // already flexible that day (its window maybe fixed since by the evening lock): « Flexible » would change nothing
  const flexAlready = j.day === day && j.win_flex === true;
  const flexNow = flexAlready && j.win_start == null;
  // « exact move » (A1): a row that showed its arrival (« Arrivée vers … ») moves there exactly; unsure or « Flexible »: as before.
  // Its own window that day stays a choice when its arrival is another one (a new quarter hour is a move, as on the grid: L4)
  const pick = async (key: string, win: { start: number; at?: number | null; truck?: string | null } | { flex: true }) => {
    if (picking.current) return;
    picking.current = true;
    setBusy(key);
    try {
      if (await moveToWindow(j, day, win, far.current)) p.onClose();
    } finally { picking.current = false; setBusy(null); }
  };
  return (
    <Sheet open onClose={p.onClose} title={moveDayTitle(name, j.day, day, todayOf(), l)} data-testid="move-window-sheet"
      sub={[t('agenda.move.winLead'), sms ? t('agenda.move.textSms', { name: name || t('agenda.move.someone') }) : ''].filter(Boolean).join(' ')}
      footer={<Button onClick={p.onClose} data-testid="move-window-cancel">{t('common.cancel')}</Button>}>
      <div class="agenda-winlist" aria-busy={!list && !error}>
        {!list && !error && <p class="muted agenda-winwait"><Spinner /> {t('agenda.move.winLoading')}</p>}
        {error && (
          <div class="agenda-winerror" role="alert" data-testid="move-window-error">
            <p class="muted">{t('agenda.move.winError', { msg: error })}</p>
            <Button size="sm" icon={<RefreshCw />} onClick={() => setTurn((n) => n + 1)} data-testid="move-window-retry">{t('agenda.move.winRetry')}</Button>
          </div>
        )}
        {list && choices.length === 0 && <p class="muted" data-testid="move-window-none">{t('agenda.move.winNone')}</p>}
        {choices.map((c) => (
          <button key={c.start} type="button" class={`agenda-winpick${c.best ? ' is-best' : ''}`} disabled={(c.current && (c.at == null || c.at === j.eta_min)) || !!busy} onClick={() => pick(`w${c.start}`, { start: c.start, at: c.at ?? null, truck: c.truck ?? null })} data-testid={`move-window-${c.start}`}>
            <Clock size={20} aria-hidden="true" />
            <span class="agenda-winpick-main">
              <span class="agenda-winpick-words">{c.words}</span>
              {(c.at ?? c.eta) != null ? <span class="agenda-winpick-sub">{t('agenda.move.winEta', { time: clock((c.at ?? c.eta)!, l) })}</span>
                : c.unsure ? <span class="agenda-winpick-sub" data-testid={`move-window-unsure-${c.start}`}>{t('jobs.order.etaUnmeasured')}</span> : null}
            </span>
            {c.current ? <span class="agenda-winpick-tag is-current">{t('agenda.move.winCurrent')}</span> : c.best ? <span class="agenda-winpick-tag">{t('agenda.move.winBest')}</span> : null}
            {busy === `w${c.start}` && <Spinner />}
          </button>
        ))}
        <button type="button" class="agenda-winpick is-flex" disabled={flexAlready || !!busy} onClick={() => pick('flex', { flex: true })} data-testid="move-window-flex">
          <CalendarRange size={20} aria-hidden="true" />
          <span class="agenda-winpick-main">
            <span class="agenda-winpick-words">{t('agenda.win.flex')}</span>
            <span class="agenda-winpick-sub">{t('agenda.move.winFlexText')}</span>
          </span>
          {flexNow && <span class="agenda-winpick-tag is-current">{t('agenda.move.winCurrent')}</span>}
          {busy === 'flex' && <Spinner />}
        </button>
      </div>
    </Sheet>
  );
}

/* « Plages d'arrivée »: a booked job dropped on a day (the week grid). The sheet asks the server which 4-hour windows
   are still possible that day (the best first), and offers « Flexible » (no window yet: fixed the evening before).
   One tap on a window is the move; the customer gets the usual text when the garage sends one for a change. */
import { useEffect, useState } from 'preact/hooks';
import { Clock, CalendarRange, RefreshCw } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { today as todayOf, clock, type Day } from '../../lib/dates';
import { errorMessage, type Suggestion } from '../../data/api';
import type { Job } from '../../data/types';
import { Sheet, Button, Spinner } from '../../ui';
import { wantsText } from '../booking/notify';
import { moveDayTitle, windowChoices } from './layout';
import { windowMove, windowsFor, moveToWindow } from './move';
import { jobPerson } from '../../domain/jobs/words';

export function MoveWindowHost() {
  const m = windowMove.value;
  if (!m) return null;
  return <MoveWindowSheet key={`${m.job.id}|${m.day}`} job={m.job} day={m.day} onClose={() => { windowMove.value = null; }} />;
}

function MoveWindowSheet(p: { job: Job; day: Day; onClose: () => void }) {
  const { job: j, day } = p;
  const l = lang.value;
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    let live = true;
    setList(null); setError(null);
    windowsFor(j, day).then((r) => { if (live) setList(r); }).catch((e) => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [turn]);
  const name = jobPerson(j);
  const sms = wantsText('moved', j.id);
  const choices = list ? windowChoices(list, j, day, l) : [];
  const flexNow = j.day === day && j.win_flex === true && j.win_start == null;
  const pick = async (key: string, win: { start: number } | { flex: true }) => {
    if (busy) return;
    setBusy(key);
    const ok = await moveToWindow(j, day, win);
    setBusy(null);
    if (ok) p.onClose();
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
          <button key={c.start} type="button" class={`agenda-winpick${c.best ? ' is-best' : ''}`} disabled={c.current || !!busy} onClick={() => pick(`w${c.start}`, { start: c.start })} data-testid={`move-window-${c.start}`}>
            <Clock size={20} aria-hidden="true" />
            <span class="agenda-winpick-main">
              <span class="agenda-winpick-words">{c.words}</span>
              {c.eta != null && <span class="agenda-winpick-sub">{t('agenda.move.winEta', { time: clock(c.eta, l) })}</span>}
            </span>
            {c.current ? <span class="agenda-winpick-tag is-current">{t('agenda.move.winCurrent')}</span> : c.best ? <span class="agenda-winpick-tag">{t('agenda.move.winBest')}</span> : null}
            {busy === `w${c.start}` && <Spinner />}
          </button>
        ))}
        <button type="button" class="agenda-winpick is-flex" disabled={flexNow || !!busy} onClick={() => pick('flex', { flex: true })} data-testid="move-window-flex">
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

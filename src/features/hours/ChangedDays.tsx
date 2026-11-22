/* « Jours changés »: the coming dates of this truck that do not follow its usual week, each with « Revenir à l'horaire
   habituel ». Going back re-plans that day with the usual hours: when they leave out appointments booked on it, the person
   is asked first (map-hours-08). */
import { t, lang } from '../../lib/i18n';
import { dow, longDay, type Day } from '../../lib/dates';
import { allJobs, blockOfKey } from '../../data/select';
import { rowsOf } from '../../data/store';
import { deleteRow, flush, pull } from '../../data/sync';
import type { TruckDay } from '../../data/types';
import { Panel, Button, ask, attempt, run } from '../../ui';
import { rangesWords } from '../../domain/moment/words';
import { closedJobs } from '../../shared/map/closing';
import type { Week } from './grid';

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function ChangedDays(p: { truckId: string; usual: Week; today: Day; canEdit: boolean }) {
  const l = lang.value;
  const list = rowsOf<TruckDay>('truck_days').filter((x) => x.truck_id === p.truckId && !x.deleted_at && x.day >= p.today).sort((a, b) => a.day.localeCompare(b.day));
  const revert = async (x: TruckDay) => {
    const out = closedJobs(allJobs.value, p.truckId, { [dow(x.day)]: p.usual[dow(x.day)] || [] }, [x.day], blockOfKey);
    if (out.length && !(await ask({ title: t('hours.exceptions.askTitle', { n: out.length }), text: t('hours.exceptions.askText', { day: longDay(x.day, l) }), ok: t('hours.exceptions.askOk'), danger: true }))) return;
    const ok = await attempt(() => deleteRow('truck_days', x.id, { label: t('log.hours') }), { ok: t('hours.exceptions.reverted', { day: longDay(x.day, l) }) });
    // the server re-planned that day: bring its appointments now
    if (ok) await run(() => flush().then(() => pull('jobs')), { quiet: true });
  };
  return (
    <Panel title={t('hours.exceptions.title')} sub={t('hours.exceptions.sub')} data-testid="hours-exceptions">
      {!list.length ? <p class="muted small" style={{ margin: 0 }}>{t('hours.exceptions.none')}</p> : (
        <ul class="hours-exc">
          {list.map((x) => (
            <li key={x.id}>
              <span class="hours-exc-main">
                <b>{longDay(x.day, l)}</b>
                <span class={(x.ranges || []).length ? '' : 'hours-exc-closed'}>{rangesWords(x.ranges || [], l)}</span>
                <span class="faint small">{t('hours.exceptions.usual', { hours: lower(rangesWords(p.usual[dow(x.day)] || [], l)) })}</span>
              </span>
              {p.canEdit && <Button size="sm" onClick={() => revert(x)} data-testid={`hours-revert-${x.day}`}>{t('hours.exceptions.revert')}</Button>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

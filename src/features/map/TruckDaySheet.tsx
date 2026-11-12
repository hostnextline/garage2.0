/* « Départ et heure » of a truck, from the map's legend: where it leaves from (« Départ de ce camion », the same panel as
   Horaires) and when it starts on the day shown (that day only: Horaires keeps the usual week). A new start time keeps the
   end of the day; the server plans the day again (apply_hours, mode day). */
import { useState } from 'preact/hooks';
import { t, lang } from '../../lib/i18n';
import { clock, dow, longDay, type Range } from '../../lib/dates';
import { truck as truckRow, truckRanges } from '../../data/select';
import { applyHours } from '../../data/api';
import { flush, pull } from '../../data/sync';
import { Sheet, Panel, Field, Select, Button, attempt } from '../../ui';
import { TruckStartPanel } from '../hours/TruckStartPanel';
import { rangesWords } from '../hours/words';

const DAY_END = 20 * 60;
/** the day's hours with a new start: what ends before it goes, the first part left starts then; no hours: start → 20 h */
export function withStart(rs: Range[], start: number): Range[] {
  const left = rs.filter(([, e]) => e > start).map(([s, e]) => [s, e] as Range);
  if (!left.length) return [[start, Math.max(start + 60, DAY_END)]];
  left[0] = [start, left[0][1]];
  return left;
}
/** the start times offered: 5 h to 14 h, every half hour */
export const START_TIMES = Array.from({ length: 19 }, (_, i) => 300 + i * 30);

export function TruckDaySheet(p: { truckId: string; day: string; onClose: () => void }) {
  const tr = truckRow(p.truckId);
  const l = lang.value;
  const rs = truckRanges(p.truckId, p.day);
  const now = rs[0]?.[0] ?? null;
  const [start, setStart] = useState<string>(now != null ? String(now) : '480');
  if (!tr) return null;
  const next = withStart(rs, Number(start));
  const changed = now == null || Number(start) !== now;
  const save = async () => {
    const ok = await attempt(() => applyHours(p.truckId, 'day', { [dow(p.day)]: next }, p.day), { ok: t('map.truckDay.saved', { time: clock(Number(start), l) }) });
    // the day was planned again on the server: bring the hours and the appointments now
    if (ok) void flush().then(() => Promise.all([pull('truck_days'), pull('jobs')])).catch(() => undefined);
  };
  return (
    <Sheet open onClose={p.onClose} title={t('map.truckDay.title', { name: tr.name })} sub={longDay(p.day, l)} data-testid="truck-day-sheet"
      footer={<Button onClick={p.onClose}>{t('common.close')}</Button>}>
      <div class="stack">
        <Panel title={t('map.truckDay.timeTitle')} sub={t('map.truckDay.timeSub')} data-testid="truck-day-time">
          <div class="stack">
            <p class="small muted" style={{ margin: 0 }}>{rs.length ? t('map.truckDay.now', { hours: rangesWords(rs, l) }) : t('map.truckDay.off')}</p>
            <Field label={t('map.truckDay.start')}>
              <Select value={start} onValue={setStart} options={START_TIMES.map((m) => ({ value: String(m), label: clock(m, l) }))} aria-label={t('map.truckDay.start')} />
            </Field>
            {changed && <p class="small" style={{ margin: 0 }} data-testid="truck-day-after">{t('map.truckDay.after', { hours: rangesWords(next, l) })}</p>}
            <div><Button variant="primary" disabled={!changed} onClick={save} data-testid="truck-day-save">{t('map.truckDay.save')}</Button></div>
          </div>
        </Panel>
        <TruckStartPanel truckId={p.truckId} canEdit />
      </div>
    </Sheet>
  );
}

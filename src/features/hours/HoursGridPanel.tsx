/* The panel of the glass window: its title (the usual week; « one day »: that date), what is drawn in a few words, the
   day chips of the phone, « Annuler les changements », and the window itself. */
import { RotateCcw } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { duration, longDay, type Day } from '../../lib/dates';
import { truckColor, truckLabel } from '../../data/select';
import { Panel, Button, IconButton } from '../../ui';
import { rangesWords } from '../../domain/moment/words';
import { HoursGrid } from './HoursGrid';
import { weekdayName } from './dayNames';
import { paneMinutes, FROM, TO, type Panes, type Week } from './grid';

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function HoursGridPanel(p: {
  truckId: string; wide: boolean; editable: boolean;
  draft: Panes; dirtyDays: number[]; onPanes: (x: Panes) => void; onReset: () => void;
  /** what the truck has (the usual week; « one day »: that date's hours in its column) */
  week: Week;
  /** the day drawn on a phone */
  shownDay: number; onShownDay: (d: number) => void;
  /** « one day »: the date, the other weekdays dimmed */
  oneDay: Day | null;
}) {
  const l = lang.value;
  const dirty = p.dirtyDays.length > 0;
  const total = Object.values(p.draft).reduce((n, ps) => n + paneMinutes(ps), 0);
  const dim = p.oneDay ? [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== p.shownDay) : undefined;
  return (
    <Panel class="hours-gridpanel" title={p.oneDay ? t('hours.grid.dayTitle', { day: longDay(p.oneDay, l) }) : t('hours.grid.usual')}
      sub={<span class={dirty ? 'hours-dirty' : ''}>{dirty ? t('hours.grid.changed', { n: p.dirtyDays.length })
        : p.wide ? t('hours.grid.total', { d: duration(total, l) })
        : `${weekdayName(p.shownDay, l)} : ${lower(rangesWords(p.week[p.shownDay] || [], l))}`}</span>}
      action={
        // always there (hidden when nothing changed): the window must not move under the finger when painting starts
        <span class={`hours-reset${dirty ? '' : ' is-hidden'}`} aria-hidden={dirty ? undefined : 'true'}>
          {p.wide
            ? <Button size="sm" variant="ghost" icon={<RotateCcw />} disabled={!dirty} onClick={p.onReset} data-testid="hours-reset">{t('hours.grid.reset')}</Button>
            : <IconButton icon={<RotateCcw />} label={t('hours.grid.reset')} disabled={!dirty} onClick={p.onReset} data-testid="hours-reset" />}
        </span>
      }>
      {!p.wide && (
        <div class="hours-days" role="group" aria-label={t('hours.grid.days')}>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => {
            const lit = (p.draft[d] || []).length > 0;
            const changed = p.dirtyDays.includes(d);
            return (
              <button key={d} type="button" class={`hours-daychip${d === p.shownDay ? ' is-on' : ''}${changed ? ' is-changed' : ''}`} aria-pressed={d === p.shownDay}
                onClick={() => p.onShownDay(d)} data-testid={`hours-day-${d}`}>
                <span>{weekdayName(d, l, 'short')}</span>
                <span class={`hours-daychip-dot${lit ? ' is-lit' : ''}`} aria-hidden="true" />
                {changed && <span class="sr-only">{t('hours.grid.changedDay')}</span>}
              </button>
            );
          })}
        </div>
      )}
      <HoursGrid panes={p.draft} onPanes={p.onPanes} color={truckColor(p.truckId)} truckName={truckLabel(p.truckId)} editable={p.editable} week={p.wide} day={p.shownDay}
        dim={dim} changed={p.dirtyDays} />
      {Object.values(p.week).some((rs) => rs.some(([a, b]) => a < FROM || b > TO)) && <p class="faint small hours-note">{t('hours.grid.outside')}</p>}
    </Panel>
  );
}

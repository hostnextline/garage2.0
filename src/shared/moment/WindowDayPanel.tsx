/* « Plages d'arrivée »: under the calendar, the day chosen: « Flexible » (no window until the evening before), what the
   server said of it, and the day alone when it has no window to offer (« Réserver quand même » on a full day, for the
   owner and the office). */
import { Check } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { duration, longDay } from '../../lib/dates';
import { Button, Switch } from '../../ui';
import type { GridDay } from './windowDays';

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function WindowDayPanel(p: {
  day: GridDay; dur: number;
  /** « Flexible » is on for this day */
  flex: boolean; onFlex: (on: boolean) => void;
  /** the day alone is what is chosen now (the app gives the window) */
  dayAlone: boolean; onDayAlone: () => void;
  mayForce: boolean;
}) {
  const l = lang.value;
  const d = p.day;
  const closed = d.kind === 'closed' || d.kind === 'past';
  return (
    <div class="bp-dayp" data-testid="win-day-panel" data-day={d.day}>
      <div class="bp-head">
        <h4 class="bp-title">{cap(longDay(d.day, l))}</h4>
      </div>
      {!closed && <Switch checked={p.flex} onChange={p.onFlex} label={t('booking.win.flex')} hint={t('booking.win.flexHint')} data-testid="book-flex" />}
      {d.status === 'offline' && <p class="muted small bp-note">{t('booking.win.offlineDay')}</p>}
      {d.status === 'error' && <p class="muted small bp-note">{t('booking.win.errorDay')}</p>}
      {d.kind === 'full' && <p class="muted small bp-note" data-testid="win-none">{t('booking.win.noneDay', { d: duration(p.dur, l) })}</p>}
      {/* no time to offer: the day alone (the app gives the window). A full day: « Réserver quand même » */}
      {(d.kind === 'failed' || (d.kind === 'full' && p.mayForce)) && (
        <div class="bp-dayp-more">
          <Button size="sm" variant={p.dayAlone ? 'primary' : undefined} icon={p.dayAlone ? <Check /> : undefined} onClick={p.onDayAlone} data-testid="win-force">
            {d.kind === 'full' ? t('booking.force.ok') : t('booking.win.dayOnly')}
          </Button>
        </div>
      )}
    </div>
  );
}

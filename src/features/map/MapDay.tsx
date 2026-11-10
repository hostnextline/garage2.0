/* The map's day: ‹ the day › and a calendar (the phone's own date picker), for any day: plan the routes ahead or look back.
   « Aujourd'hui », « Hier », « Demain » by name, another day as « mar. 18 nov. »; a tap on the name comes back to today.
   (Who has no « Agenda » right keeps yesterday, today and tomorrow: the server refuses the other days to them.) */
import { useRef } from 'preact/hooks';
import { ChevronLeft, ChevronRight, CalendarSearch } from 'lucide-preact';
import { t, lang, type Lang } from '../../lib/i18n';
import { today, addDays, isValidDay, type Day } from '../../lib/dates';
import { IconButton } from '../../ui';

export function mapDayName(day: Day, now: Day = today(), l: string = lang.value): string {
  if (day === now) return t('map.days.today', undefined, l as Lang);
  if (day === addDays(now, -1)) return t('map.days.yesterday', undefined, l as Lang);
  if (day === addDays(now, 1)) return t('map.days.tomorrow', undefined, l as Lang);
  const d = new Date(`${day}T12:00:00`);
  const o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
  if (day.slice(0, 4) !== now.slice(0, 4)) o.year = 'numeric';
  return new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', o).format(d);
}

export function MapDay(p: { day: Day; onDay: (d: Day) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const pick = () => {
    const el = input.current;
    if (!el) return;
    try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { el.focus(); el.click(); }
  };
  const isToday = p.day === today();
  return (
    <div class="map-day" role="group" aria-label={t('map.dayLabel')} data-testid="map-day">
      <IconButton icon={<ChevronLeft size={20} />} label={t('map.dayPrev')} onClick={() => p.onDay(addDays(p.day, -1))} data-testid="map-day-prev" />
      <button type="button" class={`map-day-name${isToday ? ' is-today' : ''}`} onClick={() => { if (!isToday) p.onDay(today()); }}
        title={isToday ? undefined : t('map.dayBackToday')} aria-live="polite" data-testid="map-day-name">{mapDayName(p.day)}</button>
      <IconButton icon={<ChevronRight size={20} />} label={t('map.dayNext')} onClick={() => p.onDay(addDays(p.day, 1))} data-testid="map-day-next" />
      <span class="map-day-pick">
        <IconButton icon={<CalendarSearch size={20} />} label={t('map.dayPick')} onClick={pick} data-testid="map-day-pick" />
        <input ref={input} type="date" class="map-day-input" tabIndex={-1} aria-hidden="true" value={p.day} data-testid="map-day-input"
          onChange={(e) => { const v = (e.currentTarget as HTMLInputElement).value; if (isValidDay(v)) p.onDay(v); }} />
      </span>
    </div>
  );
}

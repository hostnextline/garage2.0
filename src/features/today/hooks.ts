/* The clocks of « Aujourd'hui »: a redraw every 30 s (time worked, « il y a 2 min ») and the day itself, which must
   roll over at midnight even on a phone left open on its charger with nothing else changing on screen. */
import { useEffect, useState } from 'preact/hooks';
import { today } from '../../lib/dates';

/** re-draws every `ms`; gives the time of the last redraw */
export function useTick(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

/** today's day, checked every minute and when the app comes back to the front */
export function useToday(): string {
  const [day, setDay] = useState(today);
  useEffect(() => {
    const check = () => setDay(today());   // same value: no redraw
    const id = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, []);
  return day;
}

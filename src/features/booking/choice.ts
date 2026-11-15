/* The moment chosen for an appointment, shared by the two pickers (blocks, « Plages d'arrivée ») and the screens that
   show or send a choice. */
import { today as todayOf, type BlockKey } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';
import { blocks, settings } from '../../data/select';
import { blockPhrase, blockPhraseWithHours, windowPhrase, windowWords } from './when';
import { choiceWindow, WIN_LEN, type FarInfo } from './logic';

export interface BlockChoice {
  day: string; block: BlockKey; truck_id?: string | null;
  /** « Plages d'arrivée » (block 'day'): the window chosen (minutes of the day), or « flexible » (no window until the
      evening before). Neither: the app gives the window when it books (« Réserver quand même », no network). */
  win_start?: number | null; win_end?: number | null; win_flex?: boolean;
  /** the estimated arrival of the moment offered (for « Voir sur la carte ») */
  eta?: number | null;
  /** the vehicle the server would send at that moment (for the map only: the booking leaves the choice to the app) */
  truck?: string | null;
}
export type VehicleKind = 'car' | 'truck' | null;
export interface BlockPickerProps {
  lat: number | null; lng: number | null;
  /** minutes of work (driving is added by the planner) */
  duration: number;
  /** moving a job: leave it out of the counts */
  excludeJob?: string | null;
  value: BlockChoice | null;
  onPick: (c: BlockChoice) => void;
  /** optional: only this truck counts (a truck chosen by hand, a mechanic booking on his own truck) */
  truckId?: string | null;
  /** the address, for « Voir sur la carte » */
  address?: string | null;
  /** the work needs the tire machine: only the truck (the switch is locked on it) */
  need?: boolean;
  /** the vehicle asked for, and the switch « Peu importe / Voiture / Camion » (shown when the garage has both) */
  kind?: VehicleKind;
  onKind?: (k: VehicleKind) => void;
  /** « garde-route » (blocks): the moment chosen puts too much road in the truck's day (the warning in words), or null */
  onFar?: (far: FarInfo | null) => void;
  /** « Plages d'arrivée »: nothing chosen any more (« Flexible » switched off with no window to go back to) */
  onClear?: () => void;
  /** « Plages d'arrivée »: a day to open at first (the address bar said a day, no window) */
  openDay?: string | null;
  /** « Plages d'arrivée »: a new number asks the suggestions again (a window refused by the server: `window_full`) */
  reload?: number;
  /** « Plages d'arrivée »: the calendar as a time grid (a computer) or as a list of times (a phone); by default the
      screen's width decides (≥ 760 px: the grid) */
  layout?: 'grid' | 'list';
}

/** how long a window is with the garage's settings (4 h: 1 h before the estimated arrival, 3 h after) */
export function winLen(): number {
  const b = settings.value.booking;
  const n = Number(b.win_before_min ?? 60) + Number(b.win_after_min ?? 180);
  return n > 0 ? n : WIN_LEN;
}

/** « Demain matin, 8 h à 12 h » for a choice (used by the summary of the screens that show a choice); a day booked by
    window: « Demain, entre 14 h et 18 h », « Demain, dans la journée (plage confirmée la veille) » */
export function choiceWords(c: BlockChoice | null, l = lang.value): string {
  if (!c) return '';
  if (c.block === 'day') {
    const win = choiceWindow(c, winLen());
    const flex = windowPhrase(c.day, null, todayOf(), l);
    if (win) return windowPhrase(c.day, win, todayOf(), l);
    // the day alone: the app gives the window when it books
    return c.win_flex ? flex : flex.replace(windowWords(null, l), t('booking.win.auto', undefined, l));
  }
  const b = blocks.value.find((x) => x.key === c.block);
  return b ? blockPhraseWithHours(c.day, c.block, b.start, b.end, todayOf(), l) : blockPhrase(c.day, c.block, todayOf(), l);
}

/* The moment chosen for an appointment, shared by the two pickers (blocks, « Plages d'arrivée ») and the screens that
   show or send a choice. */
import { today as todayOf, type BlockKey } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';
import { blocks, settings } from '../../data/select';
import { blockPhrase, blockPhraseWithHours, windowPhrase, windowWords } from './words';
import { choiceWindow, WIN_LEN, type FarInfo, type FarSeen } from './logic';

export interface BlockChoice {
  day: string; block: BlockKey; truck_id?: string | null;
  /** « Plages d'arrivée » (block 'day'): the window chosen (minutes of the day), or « flexible » (no window until the
      evening before). Neither: the app gives the window when it books (« Réserver quand même », no network). */
  win_start?: number | null; win_end?: number | null; win_flex?: boolean;
  /** the estimated arrival of the moment offered (for « Voir sur la carte ») */
  eta?: number | null;
  /** the vehicle the server would send at that moment (for the map only: the booking leaves the choice to the app) */
  truck?: string | null;
  /** Part 30: a time of the calendar the server does not offer (no room), chosen anyway by the owner or the office: the
      booking at that minute warns first (who would be late) */
  full?: boolean;
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
  /** « garde-route » (blocks): the moment chosen puts too much road in the truck's day (the warning in words), or null.
      `seen` (optional, m2): the moment chosen was scored by the answer to the question of now (far or not) and when it
      landed; absent or null: not scored (the booking screen then asks the server itself before « Réserver ») */
  onFar?: (far: FarInfo | null, seen?: FarSeen | null) => void;
  /** « Plages d'arrivée »: nothing chosen any more (« Flexible » switched off with no window to go back to) */
  onClear?: () => void;
  /** « Plages d'arrivée »: a day to open at first (the address bar said a day, no window) */
  openDay?: string | null;
  /** « Plages d'arrivée »: a new number asks the suggestions again (a window refused by the server: `window_full`) */
  reload?: number;
  /** « Plages d'arrivée »: the calendar as a time grid (a computer) or as a list of times (a phone); by default the
      screen's width decides (≥ 760 px: the grid) */
  layout?: 'grid' | 'list';
  /** « Déplacer » with arrival windows (« exact move », MoveSheet): a time chosen is where THIS appointment (`excludeJob`)
      lands, on its own truck (the vehicle offered there only when its truck does not work that day), every other stop
      keeping its order. The maps of a time then show it so: that truck, and no place in the route (the server decides it at
      the move and says first who would arrive later), never the planner's other vehicle or order (merge-main review M-1) */
  exactMove?: boolean;
  /** « Réserver à l'heure choisie » (Part 30, the booking screen): a time of the calendar is booked AT that minute (the
      booking asks the server first); a time the server does not offer is pickable by the owner and the office, marked
      full (the booking then warns who would be late) */
  exactBook?: boolean;
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

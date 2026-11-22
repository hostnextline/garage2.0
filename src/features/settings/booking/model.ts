/* Réglages → Réservations, the rules without the screen (model.test.ts):
   - viewOf: the stored `booking` part as the form shows it (the detour as a percent, the start as a name + a place);
   - patchOf: ONLY what the person changed, as stored keys (a key nobody touched is never written back from this copy);
   - check: what must be fixed before saving;
   - planOf: what the planner counts (a change re-plans the coming appointments on the server, Part 17); with the real roads
     on (Part 27) the speed and the detour are not counted any more and the rush hours are. */
import { t } from '../../../lib/i18n';
import { DEFAULT_BLOCKS, type BlockKey } from '../../../lib/dates';
import type { Settings } from '../../../data/types';
import { rangeError, limitError } from '../checks';
import { WIN_DEFAULTS, WIN_LIMITS, spanOf, spanTooShort, winRound, type BlockHours } from './windows';

type Stored = Settings['booking'];
export interface Place { address: string; lat: number | null; lng: number | null }
export interface BookingView {
  blocks: BlockHours[];
  horizon_days: number | null; speed_kmh: number | null; detour_pct: number | null; stop_min: number | null; unknown_min: number | null;
  min_block_min: number | null; near_km: number | null;
  /** « garde-route »: past these, a moment is said « loin des autres arrêts » when booking (no re-plan); 0 = no limit */
  max_hop_min: number | null; max_day_drive_min: number | null;
  /** « Départ des camions »: its name and its place apart, so changing one never writes back an old copy of the other */
  label: string; place: Place;
  /** the number texted when a mechanic heads back after the last job (arrival time, live map) */
  return_phone: string;
  /** every mechanic sees every route and may do any of its jobs (the vehicles are nobody's own) */
  shared_routes: boolean;
  /** « Plages d'arrivée »: minutes before / after the estimated arrival, and the rounding (15, 30 or 60) */
  win_before_min: number | null; win_after_min: number | null; win_round_min: number | null;
  /** « Vraies routes » (Part 27): the rush-hour times too (false: the usual-hours time all day), the month's ceiling of TomTom
      Matrix transactions, the public booking page's own allowance of them (roads_web_tx: the function « book »; owner
      only, like the ceiling), « proche » in minutes of real driving (used while the switch is on; off: near_km) */
  roads_rush: boolean; roads_month_tx: number | null; roads_web_tx: number | null; near_min: number | null;
}
export type NumKey = 'horizon_days' | 'speed_kmh' | 'detour_pct' | 'stop_min' | 'unknown_min' | 'min_block_min' | 'near_km' | 'max_hop_min' | 'max_day_drive_min'
  | 'roads_month_tx' | 'roads_web_tx' | 'near_min';
export interface NumDef { k: NumKey; min: number; max: number; unit: 'days' | 'kmh' | 'pct' | 'min' | 'km' | 'tx'; decimals?: boolean; label: string; /** 0 switches it off */ zeroOff?: boolean;
  /** used only while the real roads are off (the server ignores it when on: drive_min, drive_km, suggest_core) */ estimate?: boolean }
export const NUMS: NumDef[] = [
  { k: 'horizon_days', min: 7, max: 365, unit: 'days', label: 'horizon' },
  { k: 'speed_kmh', min: 10, max: 110, unit: 'kmh', label: 'speed', estimate: true },
  { k: 'detour_pct', min: 0, max: 100, unit: 'pct', label: 'detour', estimate: true },
  { k: 'stop_min', min: 0, max: 60, unit: 'min', label: 'stop' },
  { k: 'unknown_min', min: 5, max: 120, unit: 'min', label: 'unknown' },
  { k: 'min_block_min', min: 15, max: 240, unit: 'min', label: 'minBlock' },
  { k: 'near_km', min: 1, max: 50, unit: 'km', decimals: true, label: 'near', estimate: true },
  { k: 'max_hop_min', min: 10, max: 120, unit: 'min', label: 'maxHop', zeroOff: true },
  { k: 'max_day_drive_min', min: 30, max: 480, unit: 'min', label: 'maxDay', zeroOff: true }
];
/** the numbers of the « Vraies routes » panel (labels under settings.booking.roads); near_min is shown only while it is on.
    The ceiling may be 0: TomTom is then never asked (OSRM only, no rush times); the public page's allowance too (0: never
    TomTom for the page). */
export const ROAD_NUMS: NumDef[] = [
  { k: 'roads_month_tx', min: 0, max: 1000000, unit: 'tx', label: 'roads.monthTx' },
  { k: 'roads_web_tx', min: 0, max: 1000000, unit: 'tx', label: 'roads.webTx' },
  { k: 'near_min', min: 1, max: 60, unit: 'min', label: 'roads.nearMin' }
];
/** the usual values (CONTRACT §1), the same as the server's bset() defaults; roads_web_tx: the function « book »'s (1 000) */
export const ROAD_DEFAULTS = { roads_month_tx: 10000, roads_web_tx: 1000, near_min: 10 } as const;
const KEYS: BlockKey[] = ['am', 'pm', 'eve'];
/** a stored number, or the usual one when missing (a stored 0 stays 0: it switches a garde-route limit off) */
const num = (v: unknown, d: number) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

export function viewOf(b: Stored): BookingView {
  const stored = (b.blocks?.length ? b.blocks : DEFAULT_BLOCKS).map((x) => ({ key: x.key, start: x.start, end: x.end }));
  return {
    blocks: KEYS.map((k) => stored.find((x) => x.key === k) || DEFAULT_BLOCKS.find((x) => x.key === k)!),
    horizon_days: b.horizon_days, speed_kmh: b.speed_kmh, detour_pct: Math.round(((Number(b.detour) || 1.3) - 1) * 100), stop_min: b.stop_min,
    unknown_min: b.unknown_min, min_block_min: b.min_block_min, near_km: b.near_km,
    max_hop_min: num(b.max_hop_min, 35), max_day_drive_min: num(b.max_day_drive_min, 105),
    label: b.home?.label || 'Centrale',
    place: { address: b.home?.address || '', lat: b.home?.lat ?? null, lng: b.home?.lng ?? null },
    return_phone: b.return_phone || '',
    shared_routes: !!(b as { shared_routes?: boolean }).shared_routes,
    win_before_min: b.win_before_min ?? WIN_DEFAULTS.before, win_after_min: b.win_after_min ?? WIN_DEFAULTS.after, win_round_min: winRound(b.win_round_min),
    roads_rush: b.roads_rush !== false, roads_month_tx: num(b.roads_month_tx, ROAD_DEFAULTS.roads_month_tx),
    roads_web_tx: num(b.roads_web_tx, ROAD_DEFAULTS.roads_web_tx), near_min: num(b.near_min, ROAD_DEFAULTS.near_min)
  };
}

const round = (v: number | null) => Math.round(Number(v));
/** the stored keys for the fields the person changed; the start is merged into the start stored NOW */
export function patchOf(changes: Partial<BookingView>, b: Stored, winOn: boolean): Partial<Stored> & Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const c = changes;
  if (c.blocks) out.blocks = c.blocks;
  if ('horizon_days' in c) out.horizon_days = round(c.horizon_days!);
  if ('speed_kmh' in c) out.speed_kmh = c.speed_kmh;
  if ('detour_pct' in c) out.detour = Math.round(100 + Number(c.detour_pct)) / 100;
  for (const k of ['stop_min', 'unknown_min', 'min_block_min', 'max_hop_min', 'max_day_drive_min'] as const) if (k in c) out[k] = round(c[k]!);
  if ('near_km' in c) out.near_km = c.near_km;
  if ('label' in c || c.place) {
    out.home = {
      ...(b.home || {}),
      ...('label' in c ? { label: String(c.label).trim() || 'Centrale' } : {}),
      ...(c.place ? { address: c.place.address.trim(), lat: c.place.lat, lng: c.place.lng } : {})
    };
  }
  if ('return_phone' in c) out.return_phone = String(c.return_phone).trim() || null;
  if ('shared_routes' in c) out.shared_routes = c.shared_routes;
  // « Vraies routes »: only what was touched (roads_on itself is never written from here: roads_switch, guard trigger)
  if ('roads_rush' in c) out.roads_rush = c.roads_rush === true;
  if ('roads_month_tx' in c) out.roads_month_tx = round(c.roads_month_tx!);
  if ('roads_web_tx' in c) out.roads_web_tx = round(c.roads_web_tx!);
  // « proche » is checked only while the switch is on: an empty field (switch turned off before saving) writes nothing,
  // never 0 (review R7)
  if ('near_min' in c && c.near_min != null && Number.isFinite(Number(c.near_min))) out.near_min = round(c.near_min);
  // the numbers of the windows are written only once the garage books by windows (nothing new in the settings before)
  if (winOn) {
    if ('win_before_min' in c) out.win_before_min = round(c.win_before_min!);
    if ('win_after_min' in c) out.win_after_min = round(c.win_after_min!);
    if ('win_round_min' in c) out.win_round_min = winRound(c.win_round_min);
  }
  return out as Partial<Stored> & Record<string, unknown>;
}

/** what is wrong with one block's hours (the end before the start, or over the block before) */
export function blockError(blocks: BlockHours[], i: number): string | null {
  const bl = blocks[i];
  if (bl.end <= bl.start) return t('settings.booking.badBlock');
  if (i > 0 && bl.start < blocks[i - 1].end) return t('settings.booking.overlap');
  return null;
}

export type BookingErrors = Partial<Record<NumKey | 'win_before_min' | 'win_after_min' | 'day' | 'place', string | null>>;
/** every field to fix before saving; `placeChanged`: a start typed without its position (it is refused: the server would
    plan from a built-in address, settings-team-04). An old start without position does not block other changes. */
export function check(v: BookingView, o: { winOn: boolean; placeChanged: boolean; roadsOn?: boolean }): { errors: BookingErrors; blocks: boolean } {
  const e: BookingErrors = {};
  // near_min is on the screen only while the real roads are on: never an error the person cannot see
  for (const n of [...NUMS, ...ROAD_NUMS]) {
    if (n.k === 'near_min' && !o.roadsOn) continue;
    e[n.k] = n.zeroOff ? limitError(v[n.k], n.min, n.max) : rangeError(v[n.k], n.min, n.max);
  }
  if (o.winOn) {
    e.win_before_min = rangeError(v.win_before_min, WIN_LIMITS.before[0], WIN_LIMITS.before[1]);
    e.win_after_min = rangeError(v.win_after_min, WIN_LIMITS.after[0], WIN_LIMITS.after[1]);
    const win = { before: v.win_before_min, after: v.win_after_min, round: v.win_round_min };
    if (!e.win_before_min && !e.win_after_min && spanTooShort(spanOf(v.blocks), win)) e.day = t('settings.booking.win.dayShort');
  }
  if (o.placeChanged && v.place.address.trim() && (v.place.lat == null || v.place.lng == null)) e.place = t('settings.booking.noPos');
  const errors = Object.fromEntries(Object.entries(e).filter(([, x]) => x)) as BookingErrors;
  return { errors, blocks: v.blocks.some((_, i) => !!blockError(v.blocks, i)) };
}

/** what the planner counts: when one of these changes, the coming appointments are planned again (the server's
    plan_inputs: with the real roads on, the speed and the detour are not used and the rush hours are; off, as before) */
export const planOf = (x: BookingView, roadsOn = false) =>
  JSON.stringify([x.place.lat, x.place.lng, ...(roadsOn ? [x.roads_rush] : [x.speed_kmh, x.detour_pct]), x.stop_min, x.unknown_min, x.min_block_min, x.blocks.map((b) => [b.key, b.start, b.end])]);

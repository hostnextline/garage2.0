/* « Revenir aux blocs » (R87): what the server answers after the switch back from the arrival windows, read safely.
   `to_call`: the customers told a window that is not inside the block their appointment is now in (to call or text by
   hand); `kept`: the days and blocks left as they were, because planning them again would have thrown an appointment to
   « À placer ». An older server answers neither: both lists are empty, the screen is the one of before.
   Pure, tested in backToBlocks.test.ts. */
import { t, type Lang } from '../../../lib/i18n';
import { clockRange, type BlockKey } from '../../../lib/dates';
import { blockOfKey } from '../../../data/select';
import { dayInSentence } from '../../../domain/jobs/when';

export interface ToCall { job_id: string; day: string; block: BlockKey; win_start: number | null; win_end: number | null; customer_id: string | null }
export interface KeptBlock { day: string; block: BlockKey }
export interface BackOutcome { toCall: ToCall[]; kept: KeptBlock[] }

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const KEYS: readonly string[] = ['am', 'pm', 'eve', 'day'];
const key = (v: unknown): BlockKey | null => (typeof v === 'string' && KEYS.includes(v) ? v as BlockKey : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [];

/** « Demain matin »: a day and block the server left as they were */
export function keptWords(k: KeptBlock, l: Lang): string {
  const day = dayInSentence(k.day, l);
  return t('settings.booking.win.keptRow', { day: day.charAt(0).toUpperCase() + day.slice(1), block: t(`common.blocks.${k.block}`, undefined, l).toLowerCase() }, l);
}

/** the two lists of the server's answer to `windows_switch(false)`; anything missing or malformed is left out */
export function backOutcome(answer: unknown): BackOutcome {
  const a = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>;
  const toCall: ToCall[] = [];
  for (const r of rows(a.to_call)) {
    const job_id = str(r.job_id), day = str(r.day), block = key(r.block);
    if (!job_id || !day || !block) continue;
    toCall.push({ job_id, day, block, win_start: num(r.win_start), win_end: num(r.win_end), customer_id: str(r.customer_id) });
  }
  const kept: KeptBlock[] = [];
  for (const r of rows(a.kept)) {
    const day = str(r.day), block = key(r.block);
    if (day && block) kept.push({ day, block });
  }
  return { toCall, kept };
}

/** « demain matin (8 h à 12 h) »: the appointment's day and its block now */
export function blockNow(day: string, block: BlockKey, l: Lang): string {
  const b = blockOfKey(block);
  return t('settings.booking.win.backWhen', { day: dayInSentence(day, l), block: t(`common.blocks.${block}`, undefined, l).toLowerCase(), hours: clockRange(b.start, b.end, l) }, l);
}

/** the window the customer was told: « 10 h à 14 h » ('' when the server did not say it) */
export function toldWindow(c: Pick<ToCall, 'win_start' | 'win_end'>, l: Lang): string {
  return c.win_start != null && c.win_end != null ? clockRange(c.win_start, c.win_end, l) : '';
}

/** the text ready to send, in the customer's language: the new moment, and the window told before when known */
export function toCallText(c: ToCall, first: string | null, l: Lang): string {
  const told = toldWindow(c, l);
  return t(told ? 'settings.booking.win.backSms' : 'settings.booking.win.backSmsNoWin', { name: first ? ` ${first}` : '', when: blockNow(c.day, c.block, l), told }, l);
}

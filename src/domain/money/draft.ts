/* The lines of a draft invoice and the job's work (pure, tested in draft.test.ts).
   The draft follows the work of its job: work taken off the job leaves it (the server's trigger does the same, the
   phone does it at once so a save never puts it back), and work that became billable after the draft was made (added
   on site, an extra the customer accepted) goes on it by itself, so nothing done is left unbilled. Work and lines are
   matched by the job line's id (item_id on the line), never by dates or words. */
import type { JobItem, InvoiceLine } from '../../data/types';
import { BILLABLE } from '../jobs/steps';
import { lineCents, cleanLine, type LineLike } from './invoice';

export type WorkItem = Pick<JobItem, 'id' | 'status' | 'description' | 'qty' | 'unit_cents' | 'taxable' | 'kind'> & {
  deleted_at?: string | null; updated_at?: string | null; created_at?: string | null; answered_at?: string | null;
};
type LineRef = { item_id?: string | null };

export function isBillable(i: Pick<WorkItem, 'status' | 'deleted_at'>): boolean { return !i.deleted_at && BILLABLE.includes(i.status); }
/** a job coming or under way: its work and its invoice may still change (« Modifier la facture » too) */
export function jobOpen(status: string | null | undefined): boolean { return status === 'booked' || status === 'en_route' || status === 'on_site'; }

/** the job's billable work that is not on the invoice */
export function workMissing<I extends WorkItem>(lines: LineRef[] | null | undefined, items: I[]): I[] {
  const on = new Set((lines || []).map((l) => l.item_id).filter(Boolean));
  return items.filter((i) => isBillable(i) && !on.has(i.id));
}

/** of the work missing, what goes on the draft by itself: what became billable after the draft was made, that is work
    added to the job after it (created_at) or an extra the customer accepted after it (answered_at). Any other change
    of the work (marked done, a new price) does not count: older work missing from the draft was taken off on purpose
    (by someone who could not change the job), it stays off and the panel says it is missing. */
export function workToAdd<I extends WorkItem>(lines: LineRef[] | null | undefined, items: I[], draftMadeAt: string | null | undefined): I[] {
  const made = Date.parse(String(draftMadeAt || ''));
  if (!Number.isFinite(made)) return [];
  const after = (at: string | null | undefined) => { const x = Date.parse(String(at || '')); return Number.isFinite(x) && x > made; };
  return workMissing(lines, items).filter((i) => after(i.created_at) || after(i.answered_at));
}

/** a line made from a job line, as « Faire la facture » makes it */
export function lineOfWork(i: WorkItem): InvoiceLine & { item_id: string } {
  return { description: i.description, qty: Number(i.qty), unit_cents: i.unit_cents, taxable: i.taxable, kind: i.kind, item_id: i.id };
}

/** the lines whose work left the job (taken off, declined, deleted) are gone; a line whose work is not on this phone
    stays. Gives back the same array when nothing changes. */
export function withoutGoneWork<L extends LineRef>(lines: L[], items: WorkItem[]): L[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const keep = lines.filter((l) => { const it = l.item_id ? byId.get(l.item_id) : undefined; return !it || isBillable(it); });
  return keep.length === lines.length ? lines : keep;
}

/* ---------- « Rabais de 10 % » ---------- */
/** the percent a discount's words name, read with the words the chip writes (« Rabais de {n} % », « {n}% discount ») */
export function percentOf(description: string | null | undefined, templates: string[]): number | null {
  const d = String(description ?? '').trim();
  for (const tpl of templates) {
    const [before, after] = tpl.split('{n}');
    if (after == null) continue;
    if (!d.startsWith(before) || !d.endsWith(after)) continue;
    const n = d.slice(before.length, d.length - after.length);
    if (/^\d{1,2}$/.test(n)) return Number(n);
  }
  return null;
}
/** the other lines a percent discount is taken on (every line that is not a discount) */
export function discountBase(lines: LineLike[]): number {
  return lines.filter((l) => l.kind !== 'discount').reduce((n, l) => n + lineCents(l), 0);
}
/** a discount that says « 10 % » stays 10 % of the other lines when they change (a line added, a price changed, work
    taken off). Gives back the same array when nothing changes. */
export function syncPercents<L extends LineLike>(lines: L[], templates: string[]): L[] {
  const base = discountBase(lines);
  if (base <= 0) return lines;
  let changed = false;
  const out = lines.map((l) => {
    if (l.kind !== 'discount') return l;
    const pc = percentOf(l.description, templates);
    if (pc == null) return l;
    const cents = Math.round((base * pc) / 100);
    if (Math.abs(Number(l.unit_cents || 0)) === cents && Number(l.qty ?? 1) === 1) return l;
    changed = true;
    return { ...l, unit_cents: cents, qty: 1 };
  });
  return changed ? out : lines;
}

/** lines added from the catalog (the estimate's, the invoice's): they go last, and « Rabais de 10 % » follows at once */
export function addLines<L extends LineLike>(lines: L[], add: L[], templates: string[]): L[] {
  return add.length ? syncPercents([...lines, ...add], templates) : lines;
}

/** « Annuler » after a line was removed: that one line comes back at its place in the lines as they are NOW
    (what was typed meanwhile stays) */
export function putBack<L>(lines: L[], line: L, index: number): L[] {
  if (lines.includes(line)) return lines;
  const at = Math.max(0, Math.min(index, lines.length));
  return [...lines.slice(0, at), line, ...lines.slice(at)];
}

/* ---------- the draft as a whole ---------- */
type DraftLine = LineLike & { item_id?: string | null };
/** what the draft must take by itself from the job's work: lines of work gone leave it; work that became billable
    after it was made goes on it (only for someone who may change the job's work: their « Retirer » marks the work
    « Pas fait », so a line they removed never comes back); « Rabais de 10 % » follows. `lines` is the same array
    when nothing changes. */
export function settleLines<L extends DraftLine>(lines: L[], items: WorkItem[], o: { addNew: boolean; madeAt: string | null | undefined; percentWords: string[]; toLine: (i: WorkItem) => L }): { lines: L[]; added: WorkItem[] } {
  let out = withoutGoneWork(lines, items);
  const added = o.addNew ? workToAdd(out, items, o.madeAt) : [];
  if (added.length) out = [...out, ...added.map(o.toLine)];
  out = syncPercents(out, o.percentWords);
  return { lines: out, added };
}

export interface DraftFields { lines: DraftLine[]; taxesOn: boolean; notes: string }
/** the fields of the draft that changed since the server's version: only those are sent, so a note typed on the
    computer and a line added on the phone at the same time do not overwrite each other. Null: nothing to send. */
export function draftPatch(v: DraftFields, base: DraftFields): { lines?: ReturnType<typeof cleanLine>[]; taxes_on?: boolean; notes?: string | null } | null {
  const patch: { lines?: ReturnType<typeof cleanLine>[]; taxes_on?: boolean; notes?: string | null } = {};
  const lines = v.lines.map(cleanLine);
  if (JSON.stringify(lines) !== JSON.stringify(base.lines.map(cleanLine))) patch.lines = lines;
  if (v.taxesOn !== base.taxesOn) patch.taxes_on = v.taxesOn;
  if (v.notes.trim() !== base.notes.trim()) patch.notes = v.notes.trim() || null;
  return Object.keys(patch).length ? patch : null;
}

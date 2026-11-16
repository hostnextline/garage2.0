/* Expenses and stock moves on the phone: deleting an expense, and keeping a row just saved (see keepAfterSave). */
import { preview } from '../../data/auth';
import { Refused } from '../../data/api';
import { t } from '../../lib/i18n';
import { deleteRow, refetch } from '../../data/sync';
import { getRow } from '../../data/store';

const removed = new Set<string>();
export async function removeExpense(id: string) {
  if (preview.value) throw new Refused('preview', t('errors.preview'));
  removed.add(id);
  await deleteRow('expenses', id, { label: t('log.expense') });
}
/** A row just created can be dropped from the phone by the sync's « which ids do I still see? » check when both
    happen at the same moment (see the report: src/data/sync.ts checkIds). Until that is fixed there, look again a
    little later and bring the row back from the server if it vanished (never one the person deleted). */
export function keepAfterSave(table: 'expenses' | 'inventory_moves', id: string) {
  for (const ms of [5000, 15000]) {
    setTimeout(() => { if (!removed.has(id) && !getRow(table, id)) void refetch(table, id); }, ms);
  }
}

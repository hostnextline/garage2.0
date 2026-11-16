// « Once »: a text sent from the app carries an operation id made by the phone (a uuid, the same when it tries again).
// On a weak signal the request can reach the server while the answer is lost; the person taps again and, without this,
// the customer gets the text twice. The id becomes the id of the text's row in « messages », claimed BEFORE the text
// leaves (one atomic insert: two requests at the same instant cannot both pass):
//   - first time: the row is written « queued », the text goes, the row is completed (finishMessage);
//   - the same id again while the first is still going: not claimed (the caller answers « already / pending »);
//   - the same id again after it was sent: not claimed, the row says what was sent;
//   - the same id again after it FAILED (or a first try that died half-way, still « queued » after 2 minutes): claimed
//     again, the text is tried once more.
// An id already used by another person or for another kind of text is refused (op_reused): a phone never reuses one.
// Nothing changes for a request without an id (yesterday's app).
import { fail } from './http.ts';
import { adminDb } from './db.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE_MS = 2 * 60000;
export interface MessageRow { id: string; kind: string; staff_id: string | null; status: string; body: string | null; to_addr: string | null; error: string | null; provider_ref: string | null; updated_at: string }
export type Claim = { claimed: true } | { claimed: false; row: MessageRow };

/** claims the operation `op` for one text (`row`: the columns known before it leaves: kind, staff_id, customer_id…) */
export async function claimMessage(op: string, row: Record<string, unknown> & { kind: string; staff_id: string }): Promise<Claim> {
  if (!UUID.test(op)) fail('bad_op', 'Numéro d’opération invalide.');
  const db = adminDb();
  const { error } = await db.from('messages').insert({ ...row, id: op, status: 'queued' });
  if (!error) return { claimed: true };
  if (error.code !== '23505') throw error;
  const { data, error: e2 } = await db.from('messages').select('id, kind, staff_id, status, body, to_addr, error, provider_ref, updated_at').eq('id', op).maybeSingle();
  if (e2) throw e2;
  const had = data as MessageRow | null;
  if (!had) fail('op_reused', 'Ce numéro d’opération a déjà servi.', 409);
  if (had.kind !== row.kind || had.staff_id !== row.staff_id) fail('op_reused', 'Ce numéro d’opération a déjà servi.', 409);
  const stale = had.status === 'queued' && Date.parse(had.updated_at) < Date.now() - STALE_MS;
  if (had.status === 'failed' || stale) {
    // tried again after a failure: one request takes it (the status it saw is the condition)
    const { data: again, error: e3 } = await db.from('messages').update({ status: 'queued', error: null }).eq('id', op).eq('status', had.status).eq('updated_at', had.updated_at).select('id');
    if (e3) throw e3;
    if (((again || []) as unknown[]).length) return { claimed: true };
  }
  return { claimed: false, row: had };
}
/** the text's row completed once it left (or not): same columns as the insert the function made before */
export async function finishMessage(op: string, row: Record<string, unknown>) {
  const { id: _drop, ...rest } = row as { id?: unknown };
  const { error } = await adminDb().from('messages').update(rest).eq('id', op);
  if (error) throw error;
}
/** the claim given back when the work died before the text: the next try may send it */
export async function dropMessage(op: string, why: string) {
  await adminDb().from('messages').update({ status: 'failed', error: why.slice(0, 300) }).eq('id', op).eq('status', 'queued');
}

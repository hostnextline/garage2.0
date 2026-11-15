/* « Notes d'appels » (Part 26): after a call on the GoHighLevel number, the server (function `calls`) fetches the recording, has it
   written out (OpenAI) and keeps a short note in `call_notes`: what the customer wanted, what we told them, what is left to do.
   Owners only for now. Read straight from the server (not kept on the phone: online only); the pure parts are tested. */
import { sb, callFn } from '../../data/auth';

export type NoteStatus = 'new' | 'done' | 'short' | 'no_recording' | 'failed';
export interface CallNote {
  id: string; message_id: string; phone: string | null; customer_id: string | null; dir: 'in' | 'out' | null; at: string | null; duration_sec: number | null;
  status: NoteStatus; summary: string | null; told: string | null; todo: string | null; lang: string | null; transcript?: string | null; error: string | null;
}
const COLS = 'id, message_id, phone, customer_id, dir, at, duration_sec, status, summary, told, todo, lang, error';

/** the notes of one customer (by their file; by a number when there is no file), newest first */
export async function notesOf(customerId: string | null, phone: string | null, limit = 30): Promise<CallNote[]> {
  const digits = (phone || '').replace(/\D/g, '').slice(-10);
  let q = sb.from('call_notes').select(COLS).order('at', { ascending: false }).limit(limit);
  // the server links each call to the file with its number (when the note is made, and when a file with that number appears)
  if (customerId) q = q.eq('customer_id', customerId);
  else if (digits.length === 10) q = q.eq('phone_digits', digits);
  else return [];
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as CallNote[];
}
/** the last calls of the garage, newest first */
export async function recentNotes(limit = 60): Promise<CallNote[]> {
  const { data, error } = await sb.from('call_notes').select(COLS).order('at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []) as CallNote[];
}
/** everything said, for « Voir tout ce qui s'est dit » */
export async function transcriptOf(id: string): Promise<string> {
  const { data, error } = await sb.from('call_notes').select('transcript').eq('id', id).maybeSingle();
  if (error) throw error;
  return String((data as { transcript?: string | null } | null)?.transcript || '');
}

export interface CallsStatus { ok: boolean; key: boolean; ghl: boolean; counts?: { done: number; pending: number; failed: number }; last_at?: string | null; code?: string; error?: string }
export const callsStatus = () => callFn<CallsStatus>('calls', { action: 'status' }, 20000);
export interface SyncAnswer { ok: boolean; found?: number; done?: number; pending?: number; failed?: number; errors?: string[]; code?: string; error?: string }
export const callsSync = () => callFn<SyncAnswer>('calls', { action: 'sync' }, 150000);
export const callsRedo = (id: string) => callFn<SyncAnswer>('calls', { action: 'redo', id }, 150000);

/* ---------- pure ---------- */
/** « 4 min », « 45 s » */
export function callLength(sec: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (!s) return '';
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
}
/** a note worth showing in a customer's file: written, or still being written; a missed or very short call says nothing */
export const worthShowing = (n: Pick<CallNote, 'status'>) => n.status === 'done' || n.status === 'new' || n.status === 'failed';
/** the notes still waiting for their text */
export const pendingCount = (list: Pick<CallNote, 'status'>[]) => list.filter((n) => n.status === 'new').length;
/** the calls with something left to do, the newest first (they are already in that order) */
export const withTodo = (list: CallNote[]) => list.filter((n) => n.status === 'done' && !!(n.todo || '').trim());

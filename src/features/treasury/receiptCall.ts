/* The two calls of the receipt photos to the server, alone in this file, with no import at run time: the check
   against a real server (receipts.server-check.mjs, run by Node, which strips the types) imports THESE calls, so it
   proves the app's own insert and abort signal, never a copy that could drift (review treasury-recon-r2-3).
   receipts.ts sends and reads the photos only through them. Keep this file free of run-time imports. */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ReceiptCallPhoto { id: string; dataUrl: string; w: number; h: number }

/** the insert of a photo under its own id, stopped by `signal`; the raw answer of supabase-js ({ error, status }) */
export function insertReceipt(client: SupabaseClient, p: ReceiptCallPhoto, signal: AbortSignal) {
  const data = p.dataUrl.split(',')[1] || '';
  return client.from('attachments')
    .insert({ id: p.id, kind: 'receipt', mime: 'image/jpeg', data, bytes: Math.round(data.length * 0.75), width: p.w, height: p.h })
    .abortSignal(signal);
}

/** the stored picture as a data URL, or null when the server has none; a failed request THROWS */
export async function selectReceipt(client: SupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await client.from('attachments').select('mime, data').eq('id', id).maybeSingle();
  if (error) throw error;
  const row = data as { mime: string; data: string } | null;
  return row ? `data:${row.mime};base64,${row.data}` : null;
}

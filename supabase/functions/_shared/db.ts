// The database, as the server (service role: sees everything, so every function checks who is asking first),
// and as the person who called (their own rights, through the same rules as the app).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { env, fail } from './http.ts';

let admin: SupabaseClient | null = null;
export function adminDb(): SupabaseClient {
  if (!admin) admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
export function userDb(jwt: string): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
}
export interface Caller {
  id: string; jwt: string; db: SupabaseClient;
  access: { id: string; full_name: string; short_name: string | null; roles: string[]; owner: boolean; rights: Record<string, boolean>; trucks: string[]; lang: string };
}
/** the signed-in person (or a refusal) */
export async function caller(req: Request): Promise<Caller> {
  const h = req.headers.get('authorization') || '';
  const jwt = h.replace(/^Bearer\s+/i, '');
  if (!jwt || jwt.startsWith('sb_')) fail('signin', 'Connecte-toi d’abord.', 401);
  const { data, error } = await adminDb().auth.getUser(jwt);
  if (error || !data?.user) fail('signin', 'Ta connexion a expiré : reconnecte-toi.', 401);
  const db = userDb(jwt);
  const { data: access, error: e2 } = await db.rpc('my_access');
  if (e2) throw e2;
  if (!access) fail('no_access', 'Ton compte n’a pas (ou plus) accès au garage.', 403);
  return { id: data.user.id, jwt, db, access };
}
export async function secret(key: string): Promise<string | null> {
  const { data } = await adminDb().from('secrets').select('value').eq('key', key).maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}
export async function setSecret(key: string, value: string | null, by: string | null) {
  const db = adminDb();
  if (value == null) await db.from('secrets').delete().eq('key', key);
  else await db.from('secrets').upsert({ key, value, updated_at: new Date().toISOString(), updated_by: by });
}
export async function settings(): Promise<Record<string, any>> {
  const { data, error } = await adminDb().from('settings').select('*').eq('id', 1).single();
  if (error) throw error;
  return data as Record<string, any>;
}

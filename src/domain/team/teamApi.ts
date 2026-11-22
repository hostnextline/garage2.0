/* The « team » server function (invitations, new-password links, removing someone, the keys of outside services),
   as actions that throw the server's refusal, so run()/attempt() show it in plain words; the roles in words. */
import { team, rpcNow } from '../../data/api';
import type { Role } from '../../data/types';
import { t } from '../../lib/i18n';
import { applyServerRules } from './rights';

export interface Invitation {
  id: string; email: string; full_name: string; roles: Role[]; kind: 'invite' | 'reset'; truck_id: string | null;
  expires_at: string; used_at: string | null; created_at: string;
  /** given by a newer `team list` (R179): the short name and the language the invitation was made with; an older one
      answers neither */
  short_name?: string | null; lang?: string | null; phone?: string | null;
}
export interface TeamList { invitations: Invitation[]; sign_ins: Record<string, { last_sign_in_at: string | null }> }
export type SendHow = 'email' | 'sms' | 'none';
export interface LinkAnswer {
  link: string; sent: string; channel?: string; error?: string;
  message?: { subject?: string; text?: string; html?: string; sms?: string };
}
/** what the « link » sheet needs: who it is for, and the server's answer */
export interface LinkResult extends LinkAnswer { name: string; email?: string | null; phone?: string | null; reset?: boolean }

/** a team action; a refusal is thrown as { code, error } (errorMessage() reads it) */
export async function teamDo<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T & { ok: boolean }> {
  const r = await team<T>(action, body);
  if (!r || !r.ok) {
    const err = Object.assign(new Error((r && r.error) || t('errors.server')), { code: (r && r.code) || 'server', error: (r && r.error) || '' });
    throw err;
  }
  return r;
}

export async function loadTeamList(): Promise<TeamList> {
  const r = await teamDo<Partial<TeamList>>('list');
  const inv = Array.isArray(r.invitations) ? r.invitations : [];
  return {
    invitations: inv.filter((i) => i && i.id && !i.used_at).map((i) => ({ ...i, roles: Array.isArray(i.roles) ? i.roles : [], truck_id: i.truck_id ?? null })),
    sign_ins: r.sign_ins && typeof r.sign_ins === 'object' ? r.sign_ins : {}
  };
}

/* the server's table of rules (asked once; the copy in rights.ts is used meanwhile or without signal) */
let rulesAsked = false;
export async function loadRules() {
  if (rulesAsked) return;
  rulesAsked = true;
  try { applyServerRules(await rpcNow<unknown>('rights_table', {})); } catch { rulesAsked = false; }
}

/** « Bureau et Trésorier », « Bureau, Mécanicien et Trésorier » */
export function rolesWords(roles: readonly string[] | null | undefined): string {
  const words = (roles || []).map((r) => t(`team.roles.${r}`));
  if (words.length <= 1) return words[0] || '';
  return t('team.and', { a: words.slice(0, -1).join(', '), b: words[words.length - 1] });
}

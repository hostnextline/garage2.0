/* What a person may do: the same rules as the database (supabase/migrations: right_rule, right_default, right_of).
   - each (role, right) is 'always' (comes with the role), 'can' (the owner decides) or 'never';
   - what a role gives at the start: settings.role_rights, else the defaults below;
   - a person's own choice (staff.rights: { right: true|false }) wins, but only for a right one of their roles 'can' have;
   - the owner has everything.
   The server keeps the truth (it checks every action); these functions only draw the screen. */
import { RIGHTS, type Right, type Role } from '../../data/types';

export type TeamRole = Exclude<Role, 'owner'>;
export const TEAM_ROLES: TeamRole[] = ['office', 'mechanic', 'treasurer'];
export const ALL_ROLES: Role[] = ['owner', 'office', 'mechanic', 'treasurer'];
export type Rule = 'always' | 'can' | 'never';
export type RoleRights = Partial<Record<TeamRole, Partial<Record<Right, boolean>>>>;
export type Overrides = Partial<Record<Right, boolean>>;
/** the 3 choices for one person: follow the role, always yes, always no */
export type Choice = 'role' | 'yes' | 'no';

const RULE_TABLE: Record<Right, Partial<Record<TeamRole, Rule>>> = {
  agenda: { office: 'always', treasurer: 'can', mechanic: 'can' },
  book: { office: 'can', mechanic: 'can' },
  clients: { office: 'can', mechanic: 'can', treasurer: 'can' },
  invoices: { office: 'can', mechanic: 'can', treasurer: 'can' },
  edit_invoices: { office: 'can', treasurer: 'can' },
  money: { office: 'can', mechanic: 'can', treasurer: 'can' },
  treasury: { treasurer: 'always', office: 'can', mechanic: 'can' },
  inventory: { office: 'can', mechanic: 'can', treasurer: 'can' },
  map: { office: 'can', mechanic: 'can', treasurer: 'can' },
  hours: { office: 'can', mechanic: 'can' },
  settings: { office: 'can' }
};
export const ROLE_DEFAULTS: Record<TeamRole, Right[]> = {
  office: ['agenda', 'book', 'clients', 'invoices', 'edit_invoices', 'money', 'inventory', 'map', 'hours'],
  mechanic: ['clients', 'invoices', 'inventory', 'map'],
  treasurer: ['treasury', 'clients', 'invoices', 'money', 'inventory', 'map']
};

/* the server's own table (rights_table()), when it could be read: it wins over the copy above */
let serverRules: Partial<Record<TeamRole, Partial<Record<Right, Rule>>>> | null = null;
const isRule = (x: unknown): x is Rule => x === 'always' || x === 'can' || x === 'never';
/** takes the answer of rights_table() if it has the expected shape; returns true when used */
export function applyServerRules(answer: unknown): boolean {
  const rules = (answer as { rules?: unknown } | null)?.rules as Record<string, Record<string, unknown>> | undefined;
  if (!rules || typeof rules !== 'object') return false;
  const out: Partial<Record<TeamRole, Partial<Record<Right, Rule>>>> = {};
  for (const ro of TEAM_ROLES) {
    const row = rules[ro];
    if (!row || typeof row !== 'object') return false;
    out[ro] = {};
    for (const r of RIGHTS) if (isRule(row[r])) out[ro]![r] = row[r] as Rule;
  }
  serverRules = out;
  return true;
}
export function resetServerRules() { serverRules = null; }

export function ruleOf(role: Role, right: Right): Rule {
  if (role === 'owner') return 'always';
  const s = serverRules?.[role]?.[right];
  if (isRule(s)) return s;
  return RULE_TABLE[right]?.[role] ?? 'never';
}

/** what one role gives for a right (the owner's choice for the role, else the default) */
export function roleGives(role: TeamRole, right: Right, roleRights: RoleRights | null | undefined = {}): boolean {
  const r = ruleOf(role, right);
  if (r === 'always') return true;
  if (r === 'never') return false;
  const v = roleRights?.[role]?.[right];
  return typeof v === 'boolean' ? v : ROLE_DEFAULTS[role].includes(right);
}

export interface FromRoles {
  /** owner: everything · always: comes with a role · can: the owner decides · never: none of the roles may have it */
  kind: 'owner' | 'always' | 'can' | 'never';
  /** what the roles give, before the person's own choice */
  value: boolean;
}
export function fromRoles(roles: readonly Role[] | null | undefined, right: Right, roleRights: RoleRights | null | undefined = {}): FromRoles {
  const list = roles || [];
  if (list.includes('owner')) return { kind: 'owner', value: true };
  let can = false, gives = false;
  for (const ro of list) {
    if (ro === 'owner') continue;
    const r = ruleOf(ro, right);
    if (r === 'always') return { kind: 'always', value: true };
    if (r === 'can') { can = true; if (roleGives(ro, right, roleRights)) gives = true; }
  }
  return can ? { kind: 'can', value: gives } : { kind: 'never', value: false };
}

export function choiceOf(over: Overrides | null | undefined, right: Right): Choice {
  const v = over?.[right];
  return v === true ? 'yes' : v === false ? 'no' : 'role';
}
/** the person's choices after one change (« Selon son rôle » removes the person's own choice) */
export function withChoice(over: Overrides | null | undefined, right: Right, choice: Choice): Overrides {
  const next: Overrides = {};
  for (const [k, v] of Object.entries(over || {})) if (k !== right && typeof v === 'boolean') next[k as Right] = v;
  if (choice === 'yes') next[right] = true;
  else if (choice === 'no') next[right] = false;
  return next;
}
/** may this person do it, all things considered (the same answer as the server's right_of) */
export function effectiveRight(roles: readonly Role[] | null | undefined, over: Overrides | null | undefined, right: Right, roleRights: RoleRights | null | undefined = {}): boolean {
  const base = fromRoles(roles, right, roleRights);
  if (base.kind !== 'can') return base.value;
  const c = choiceOf(over, right);
  return c === 'role' ? base.value : c === 'yes';
}
export function effectiveRights(roles: readonly Role[] | null | undefined, over: Overrides | null | undefined, roleRights: RoleRights | null | undefined = {}): Record<Right, boolean> {
  const out = {} as Record<Right, boolean>;
  for (const r of RIGHTS) out[r] = effectiveRight(roles, over, r, roleRights);
  return out;
}
/** how many of the person's own choices still matter with their roles (shown as « 2 changements pour lui ») */
export function activeOverrides(roles: readonly Role[] | null | undefined, over: Overrides | null | undefined, roleRights: RoleRights | null | undefined = {}): Right[] {
  return RIGHTS.filter((r) => choiceOf(over, r) !== 'role' && fromRoles(roles, r, roleRights).kind === 'can');
}

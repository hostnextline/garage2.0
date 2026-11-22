import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RIGHTS, type Right } from '../../data/types';
import { choiceOf, withChoice, fromRoles, effectiveRight, roleGives, ruleOf, activeOverrides, applyServerRules, resetServerRules } from './rights';

describe('rights: 3 choices per person (Selon son rôle / Oui / Non)', () => {
  afterEach(() => resetServerRules());

  it('reads the choice of a person', () => {
    expect(choiceOf({}, 'book')).toBe('role');
    expect(choiceOf(null, 'book')).toBe('role');
    expect(choiceOf({ book: true }, 'book')).toBe('yes');
    expect(choiceOf({ book: false }, 'book')).toBe('no');
  });

  it('a change keeps the other choices; « Selon son rôle » removes the key', () => {
    const start = { book: true, money: false };
    expect(withChoice(start, 'hours', 'yes')).toEqual({ book: true, money: false, hours: true });
    expect(withChoice(start, 'book', 'no')).toEqual({ book: false, money: false });
    const back = withChoice(start, 'book', 'role');
    expect(back).toEqual({ money: false });
    expect('book' in back).toBe(false);
    expect(start).toEqual({ book: true, money: false });   // never changed in place
    expect(withChoice(undefined, 'map', 'role')).toEqual({});
  });

  it('the owner has everything, whatever is stored', () => {
    expect(fromRoles(['owner'], 'settings')).toEqual({ kind: 'owner', value: true });
    expect(effectiveRight(['owner'], { settings: false }, 'settings')).toBe(true);
    expect(RIGHTS.every((r) => effectiveRight(['owner'], {}, r, {}))).toBe(true);
  });

  it("'always' rights stay on even when the person is set to « Non »", () => {
    expect(ruleOf('office', 'agenda')).toBe('always');
    expect(effectiveRight(['office'], { agenda: false }, 'agenda')).toBe(true);
    expect(effectiveRight(['treasurer'], { treasury: false }, 'treasury')).toBe(true);
  });

  it("'never' rights stay off even when the person is set to « Oui »", () => {
    expect(fromRoles(['mechanic'], 'settings')).toEqual({ kind: 'never', value: false });
    expect(effectiveRight(['mechanic'], { settings: true }, 'settings')).toBe(false);
    expect(effectiveRight(['treasurer'], { book: true }, 'book')).toBe(false);
  });

  it("'can' rights: role default, then the owner's choice for the role, then the person's own choice", () => {
    // mechanic: book is off by default
    expect(roleGives('mechanic', 'book', {})).toBe(false);
    expect(effectiveRight(['mechanic'], {}, 'book', {})).toBe(false);
    // the owner turned it on for all mechanics
    const rr = { mechanic: { book: true } };
    expect(fromRoles(['mechanic'], 'book', rr)).toEqual({ kind: 'can', value: true });
    expect(effectiveRight(['mechanic'], {}, 'book', rr)).toBe(true);
    // … but not for this one
    expect(effectiveRight(['mechanic'], { book: false }, 'book', rr)).toBe(false);
    // and the other way round
    expect(effectiveRight(['mechanic'], { money: true }, 'money', { mechanic: { money: false } })).toBe(true);
  });

  it('several roles: one role that gives is enough', () => {
    expect(fromRoles(['mechanic', 'treasurer'], 'money', { mechanic: { money: false } })).toEqual({ kind: 'can', value: true });
    expect(fromRoles(['mechanic', 'office'], 'agenda')).toEqual({ kind: 'always', value: true });
    expect(effectiveRight(['mechanic', 'office'], { settings: true }, 'settings')).toBe(true);   // office can have it
  });

  it('counts only the choices that still matter with the roles', () => {
    expect(activeOverrides(['mechanic'], { book: true, settings: true, agenda: false }, {})).toEqual(['agenda', 'book']);
  });

  it("the server's table wins when it is read", () => {
    expect(applyServerRules({ rules: { office: { settings: 'never' }, mechanic: {}, treasurer: {} } })).toBe(true);
    expect(ruleOf('office', 'settings')).toBe('never');
    expect(ruleOf('office', 'book')).toBe('can');          // not in the answer: the copy
    expect(applyServerRules({ ok: true })).toBe(false);     // a wrong shape is ignored
  });
});

/* The client copy must say what the database says (right_rule / right_default, in their LAST migration): a rule changed on
   the server without the app would draw a wrong rights table (x-rights-25, settings-team-30). */
describe('rights: the client copy is the database’s rule', () => {
  afterEach(() => resetServerRules());
  const dir = join(__dirname, '../../../supabase/migrations');
  const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(dir, f), 'utf8'));
  const lastBody = (fn: string) => {
    const re = new RegExp(`create or replace function public\\.${fn}\\([^)]*\\)[^$]*\\$\\$([\\s\\S]*?)\\$\\$`, 'g');
    let body = '';
    for (const file of sql) for (const m of file.matchAll(re)) body = m[1];
    return body;
  };
  it('each (role, right) is always / can / never as in right_rule', () => {
    const body = lastBody('right_rule');
    expect(body).toContain('case p_right');
    const sqlRule = (role: string, right: Right): string => {
      const line = new RegExp(`when '${right}'\\s+then case p_role(.*?)end`).exec(body)?.[1] || '';
      return new RegExp(`when '${role}' then '(\\w+)'`).exec(line)?.[1] || 'never';
    };
    for (const right of RIGHTS) for (const role of ['office', 'mechanic', 'treasurer'] as const) expect(`${role}.${right}=${ruleOf(role, right)}`).toBe(`${role}.${right}=${sqlRule(role, right)}`);
  });
  it('what each role gives at the start is right_default', () => {
    const body = lastBody('right_default');
    for (const role of ['office', 'mechanic', 'treasurer'] as const) {
      const list = (new RegExp(`when '${role}'\\s+then p_right = any\\(array\\[([^\\]]*)\\]`).exec(body)?.[1] || '').match(/'(\w+)'/g)?.map((x) => x.slice(1, -1)).sort();
      expect(list?.length).toBeGreaterThan(0);
      expect(RIGHTS.filter((r) => ruleOf(role, r) !== 'never' && roleGives(role, r, {})).sort()).toEqual(list!.filter((r) => ruleOf(role, r as Right) !== 'never'));
    }
  });
  it('the rights table of the server, once read, is what the screens draw', () => {
    expect(ruleOf('mechanic', 'settings')).toBe('never');
    applyServerRules({ rules: { office: { settings: 'can' }, mechanic: { settings: 'can' }, treasurer: {} } });
    expect(ruleOf('mechanic', 'settings')).toBe('can');
  });
});

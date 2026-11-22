/* Every server refusal reaches the person in their language.
   The server refuses with a short code: the database with public.fail('<code>', '<French sentence>') (the code is the
   answer's « hint »), the server functions with fail('<code>', …) / new Fail('<code>', …). French shows the server's
   sentence, English shows errors.<code>: a code with no words left an English user reading French. These tests read
   the migrations and the functions themselves, so a new code without words fails here, not on someone's phone.
   The last part checks the words of common and log: every word a screen asks for exists, and every word exists for a
   screen (a word nobody asks for is dead weight in both dictionaries). */
import { describe, it, expect } from 'vitest';
import { fr } from './fr';
import { en } from './en';

const SQL = import.meta.glob('/supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const FUNCTIONS = import.meta.glob(['/supabase/functions/**/*.ts', '!/supabase/functions/**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const APP = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}', '!/src/i18n/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** what a refusal code looks like (the same rule the app uses to tell a code from a sentence) */
const CODE_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** a block comment where one can start (not « /* » inside a string such as a glob '…/*.ts') */
const COMMENT = /(^|[\s;{}(])\/\*[\s\S]*?\*\//g;

type Raised = { codes: Set<string>; notLiteral: string[] };

/** the codes a source raises; a refusal whose code is not a plain word cannot be given words, so it is reported */
function raisedCodes(source: string, lang: 'sql' | 'ts'): Raised {
  // comments may quote old calls; in SQL a quote inside a quoted body (execute '…') is doubled
  const text = lang === 'sql'
    ? source.replace(/--[^\n]*/g, '').replace(/''/g, '\'')
    : source.replace(COMMENT, '$1').replace(/^\s*\/\/[^\n]*/gm, '');
  const codes = new Set<string>();
  const notLiteral: string[] = [];
  const call = /\b(new\s+Fail|fail)\(\s*/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 20), m.index);
    if (/function\s+(public\.)?$/.test(before) || /class\s+$/.test(before)) continue;   // the definition itself
    const rest = text.slice(call.lastIndex);
    const lit = /^'([^']*)'/.exec(rest);
    if (lit && CODE_RE.test(lit[1])) { codes.add(lit[1]); continue; }
    // a helper that passes on its own parameter (fail(code, …) { throw new Fail(code, …) }) raises nothing itself
    const ident = /^([A-Za-z_]\w*)\s*,/.exec(rest)?.[1];
    if (ident && new RegExp(`function\\s+\\w+\\s*\\(\\s*${ident}\\s*:`).test(text.slice(Math.max(0, m.index - 200), m.index))) continue;
    // a function that passes on a database refusal (fail(String(e.hint), …)): its code is raised by the SQL, checked above
    if (/^(String\()?\w+\.hint\b/.test(rest)) continue;
    notLiteral.push(rest.slice(0, 60).split('\n')[0]);
  }
  // a function may also answer a refusal by hand
  for (const h of text.matchAll(/ok:\s*false\s*,\s*code:\s*'([^']*)'/g)) {
    if (CODE_RE.test(h[1])) codes.add(h[1]); else notLiteral.push(h[0]);
  }
  return { codes, notLiteral };
}

/** the SQL functions of the migrations, each with the codes its bodies raise (every version ever written) */
function codesBySqlFunction(files: Record<string, string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const sql of Object.values(files)) {
    const heads = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)];
    heads.forEach((h, i) => {
      const body = sql.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : sql.length);
      const name = h[1].toLowerCase();
      const set = out.get(name) || new Set<string>();
      for (const c of raisedCodes(body, 'sql').codes) set.add(c);
      out.set(name, set);
    });
  }
  return out;
}

/** the server functions (folder name), each with the codes its files raise; `_shared` raises for every function */
function codesByFunction(files: Record<string, string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [path, src] of Object.entries(files)) {
    const name = /\/supabase\/functions\/([^/]+)\//.exec(path)?.[1];
    if (!name) continue;
    const set = out.get(name) || new Set<string>();
    for (const c of raisedCodes(src, 'ts').codes) set.add(c);
    out.set(name, set);
  }
  return out;
}

const sqlCodes = new Set(Object.values(SQL).flatMap((s) => [...raisedCodes(s, 'sql').codes]));
const fnCodes = new Set(Object.values(FUNCTIONS).flatMap((s) => [...raisedCodes(s, 'ts').codes]));
const bySql = codesBySqlFunction(SQL);
const byFn = codesByFunction(FUNCTIONS);

type Words = Record<string, unknown>;
const flat = (d: Words) => Object.entries(d).filter(([, v]) => typeof v === 'string') as [string, string][];
const has = (d: Words, k: string) => Object.prototype.hasOwnProperty.call(d, k) && typeof d[k] === 'string' && (d[k] as string).trim() !== '';
const frE = fr.errors as unknown as Words;
const enE = en.errors as unknown as Words;

/** codes the app makes itself: no server raises them */
const APP_CODES = ['preview', 'payment_waiting'];   // payment_waiting: app-data reopenInvoice (a payment of the invoice still waits in the outbox)
/** codes raised by tonight's server branches (srv-acces, srv-argent, srv-planif, srv-rapprochement, fn-paiement,
    fn-terrain): their words are ready before their migrations and functions are merged here. Once merged, the sources
    raise them and this list only says where they came from. */
const COMING = [
  'bad_role', 'customer_busy', 'customer_owes',
  'numbered', 'refund_first', 'refund_too_much', 'too_much', 'unbilled',
  'quote_done', 'bad_finding',
  'amount_changed', 'event', 'pay_unavailable',
  'bad_day', 'bad_op', 'bad_run', 'no_email', 'not_ready', 'op_reused', 'stripe_down', 'stripe_refused', 'test_number',
  // « exact move » (STATE.md S4, 2026-11-21): move_job's 8th argument and the new move_preview, built beside this app
  'arrive_late', 'late_changed', 'pick_truck',
  // Part 28 « Réorganiser la journée » (20261122000100_reorganiser.sql): raised with « hint = '…' » and a detail, which
  // the scan above does not read (the exact move's codes the same)
  'day_changed', 'outcome_changed', 'truck_off', 'truck_ends'
];

describe('server refusals: every code has words in French and in English', () => {
  it('the sources are read (the migrations and the functions are found)', () => {
    expect(Object.keys(SQL).length).toBeGreaterThan(30);
    expect(Object.keys(FUNCTIONS).length).toBeGreaterThan(10);
    expect(sqlCodes.has('not_allowed')).toBe(true);
    expect(sqlCodes.has('invoice_done')).toBe(true);    // raised inside execute '…' too
    expect(fnCodes.has('vpic')).toBe(true);
    expect(fnCodes.has('timeout')).toBe(true);          // new Fail('timeout', …)
    expect(fnCodes.has('server')).toBe(true);           // { ok: false, code: 'server' }
  });

  it('every code raised by public.fail( in supabase/migrations has errors.<code> in both languages', () => {
    const missing = [...sqlCodes].filter((c) => !has(frE, c) || !has(enE, c)).sort();
    expect(missing).toEqual([]);
  });

  it('every code raised by the server functions has errors.<code> in both languages', () => {
    const missing = [...fnCodes].filter((c) => !has(frE, c) || !has(enE, c)).sort();
    expect(missing).toEqual([]);
  });

  it('every refusal names its code as a plain word (a code built at run time cannot be given words)', () => {
    const bad = [
      ...Object.entries(SQL).flatMap(([p, s]) => raisedCodes(s, 'sql').notLiteral.map((x) => `${p}: ${x}`)),
      ...Object.entries(FUNCTIONS).flatMap(([p, s]) => raisedCodes(s, 'ts').notLiteral.map((x) => `${p}: ${x}`))
    ];
    expect(bad).toEqual([]);
  });

  it('no dead entry: every errors.<code> is raised by the server or made by the app', () => {
    const known = new Set([...sqlCodes, ...fnCodes, ...APP_CODES, ...COMING]);
    expect(flat(frE).map(([k]) => k).filter((k) => !known.has(k))).toEqual([]);
  });

  it('the codes reported missing for English users now have English words (x-errors-27, jobs-a-21, invoices-quotes-23)', () => {
    const reported = ['already', 'bad_amount', 'bad_from', 'bad_job', 'bad_list', 'bad_qty', 'bad_vehicle', 'bad_window',
      'below_paid', 'changed', 'closed', 'coffre_job', 'has_payment', 'invoice_done', 'needs_truck', 'no_job', 'no_position',
      'no_truck', 'past', 'pool_fixed', 'same', 'started', 'too_many', 'no_home', 'no_window', 'not_on_site', 'owner_only',
      'sms_off', 'too_long', 'hermes_off', 'hermes_down', 'hermes_error', 'hermes_empty', 'busy', 'timeout', 'no_phone',
      'far', 'no_service', 'web_off', 'signed', 'bad_key', 'bad_pair', 'no_pair', 'pair_expired', 'bad_url', 'github', 'table'];
    expect(reported.filter((c) => !has(enE, c))).toEqual([]);
    expect(reported.filter((c) => !has(frE, c))).toEqual([]);
  });

  it('the new codes of tonight\'s server work have words (srv-argent, srv-acces, srv-planif, fn-paiement, fn-terrain)', () => {
    expect(COMING.filter((c) => !has(enE, c) || !has(frE, c))).toEqual([]);
    expect(en.errors.too_much).toBe('This payment is more than what is left to pay. Refresh the invoice.');
    expect(fr.errors.too_much).toBe('Ce paiement dépasse ce qui reste à payer. Rafraîchis la facture.');
  });

  it('the Stripe key words say what the server accepts: live keys only (sk_live_ or rk_live_)', () => {
    const team = Object.entries(FUNCTIONS).find(([p]) => p.endsWith('/team/handler.ts'))?.[1] || '';
    expect(team).toContain('rk_live_');
    for (const s of [fr.errors.stripe_key, en.errors.stripe_key]) {
      expect(s).toContain('sk_live_');
      expect(s).toContain('rk_live_');
      expect(s).not.toContain('sk_test_');
    }
  });
});

describe('server refusals: one code, several meanings (i18n-04)', () => {
  const at = fr.errors.at as unknown as Record<string, Record<string, string>>;
  const atEn = en.errors.at as unknown as Record<string, Record<string, string>>;

  it('each errors.at.<source>.<code> names a source that really raises that code, and the code has its plain words', () => {
    const wrong: string[] = [];
    for (const [source, codes] of Object.entries(at)) {
      for (const code of Object.keys(codes)) {
        const raises = bySql.get(source)?.has(code) || byFn.get(source)?.has(code);
        if (!raises) wrong.push(`${source}.${code}: not raised there`);
        if (!has(frE, code)) wrong.push(`${source}.${code}: no errors.${code}`);
        if (!atEn[source]?.[code]) wrong.push(`${source}.${code}: no English`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('the English words of a code raised in two places are no longer the other place\'s sentence', () => {
    // before: « Add at least one line before finishing the invoice. » for an empty text message or Hermes question
    expect(en.errors.at.conversation.empty).toBe('Write the message.');
    expect(en.errors.at.hermes.empty).toBe('Write your question.');
    expect(en.errors.at.notify.not_booked).not.toBe(en.errors.not_booked);
    expect(en.errors.at.windows_switch.bad_mode).toBe('Pick: arrival windows, or blocks.');
    expect(en.errors.at.extra_answer.signature).toBe('The signature doesn’t match this job.');
  });

  it('the block codes have their « day » words for a garage that books by arrival windows', () => {
    expect(Object.keys(fr.errors.day).sort()).toEqual(['bad_block', 'block_closed', 'block_full', 'block_started']);
    for (const k of Object.keys(fr.errors.day)) expect(sqlCodes.has(k)).toBe(true);
    expect(fr.errors.day.block_full).toMatch(/journée/);
    expect(en.errors.day.block_full).toMatch(/day/);
    expect(en.errors.day.block_full).not.toMatch(/block/i);
  });
});

describe('the words of errors follow the writing rules', () => {
  const all = (d: Words): [string, string][] => Object.entries(d).flatMap(([k, v]) =>
    typeof v === 'string' ? [[k, v] as [string, string]] : all(v as Words).map(([k2, v2]) => [`${k}.${k2}`, v2] as [string, string]));

  it('French and English have the same entries', () => {
    expect(all(enE).map(([k]) => k)).toEqual(all(frE).map(([k]) => k));
  });

  it('a refusal is shown as it is: no {placeholder}, no arrow, a full sentence', () => {
    for (const [k, s] of [...all(frE), ...all(enE)]) {
      expect(s, k).not.toMatch(/[{}]/);
      expect(s, k).not.toMatch(/→/);
      expect(s, k).toMatch(/[.»”)]$/);
    }
  });

  it('the team is spoken to with « tu », and English quotes are English', () => {
    for (const [k, s] of all(frE)) expect(s, k).not.toMatch(/(?<![-\w])(?:[Vv]ous|[Vv]otre|[Vv]os)\b/);
    for (const [k, s] of all(enE)) expect(s, k).not.toMatch(/[«»]/);
  });
});

describe('common and log: every word asked for exists, every word is asked for', () => {
  // comments may show made-up keys as examples (« t('job.next.leave') »)
  const code = Object.values(APP).join('\n').replace(COMMENT, '$1').replace(/^\s*\/\/[^\n]*/gm, '');

  /** dotted paths of a dictionary part; a plural object ({ one, other }) is one word */
  const paths = (d: unknown, prefix: string): string[] => Object.entries(d as Words).flatMap(([k, v]) =>
    v && typeof v === 'object' && !('other' in (v as object)) ? paths(v, `${prefix}.${k}`) : [`${prefix}.${k}`]);

  const lookup = (key: string): unknown => key.split('.').reduce<unknown>((cur, p) =>
    cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, p) ? (cur as Words)[p] : undefined, fr);

  it('every literal key the app asks t() or tl() for exists (a missing word would show its key on screen)', () => {
    const keys = new Set<string>();
    for (const m of code.matchAll(/(?<![\w.])t\(\s*'([a-z][\w]*(?:\.[\w]+)+)'\s*[,)]/g)) keys.add(m[1]);
    for (const m of code.matchAll(/(?<![\w.])tl\(\s*[\w.]+\s*,\s*'([a-z][\w]*(?:\.[\w]+)+)'\s*[,)]/g)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(1000);
    const missing = [...keys].filter((k) => {
      const v = lookup(k);
      return !(typeof v === 'string' || (v && typeof v === 'object' && 'other' in (v as object)));
    });
    expect(missing).toEqual([]);
  });

  /** words no screen shows, kept for a reason */
  const KEPT = new Set(['common.done', 'common.minutes', 'common.hours']);   // read by the test of t() (src/lib/i18n.test.ts)

  it('every word of common and log is asked for by the app (literally, or through a key built from a prefix)', () => {
    const prefixes = [...code.matchAll(/`((?:common|log)\.[\w.]*\.)\$\{/g)].map((m) => m[1]);
    const used = (k: string) => new RegExp(`['\`"]${k.replace(/\./g, '\\.')}['\`"]`).test(code) || prefixes.some((p) => k.startsWith(p));
    const dead = [...paths(fr.common, 'common'), ...paths(fr.log, 'log')].filter((k) => !KEPT.has(k) && !used(k));
    expect(dead).toEqual([]);
  });
});

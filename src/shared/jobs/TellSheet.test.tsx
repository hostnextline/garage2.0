/* « Envoyer les heures aux clients » (Part 28, REARRANGE.md §3.3, U5): the list from the phone at once then the
   server's, today's « en retard sur sa plage » never in `only`, the unmeasured line and « Mesurer d'abord », the send
   loop (`left`, a new call each round), the result's sections, « Je l'ai averti » (call) and « C'est envoyé » (hand),
   the list read again when the sheet comes back on screen, offline, the rights. The server is pretended (data/tell). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { DayAnswer, TellMark, TellRow } from '../../data/tell';

const srv = vi.hoisted(() => ({
  list: null as null | ((day: string) => unknown[] | Promise<unknown[]>),
  lists: [] as string[],
  sends: [] as { day: string; only: string[]; again: string[] }[],
  answers: [] as (Partial<DayAnswer> | Error)[],
  marks: [] as TellMark[][],
  mark: null as null | ((m: TellMark[]) => { ok: boolean; marked: string[]; changed: string[]; busy: string[] }),
  warms: [] as { lat: number; lng: number }[],
  refetched: [] as string[]
}));
vi.mock('../../data/tell', async (orig) => {
  const real = await orig<typeof import('../../data/tell')>();
  const empty = { ok: true, status: 'done', sent: [], maybe: [], already: [], busy: [], gone: [], quiet: [], no_phone: [], failed: [], by_hand: [], left: [] };
  return {
    ...real,
    tellList: async (day: string) => { srv.lists.push(day); return real.tellRowsOf(srv.list ? await srv.list(day) : []); },
    sendDay: async (day: string, only: string[], again: string[] = []) => {
      srv.sends.push({ day, only: [...only], again: [...again] });
      const a = srv.answers.shift() ?? { sent: [...only] };
      if (a instanceof Error) throw a;
      return { ...empty, ...a };
    },
    tellMark: async (m: TellMark[]) => { srv.marks.push(m); return srv.mark ? srv.mark(m) : { ok: true, marked: m.map((x) => x.id), changed: [], busy: [] }; }
  };
});
vi.mock('../../data/roads', async (orig) => ({ ...(await orig<object>()), warmRoads: async (p: { lat: number; lng: number }) => { srv.warms.push(p); return { ok: true, ready: true }; } }));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<object>()), refetch: async (_t: string, id: string) => { srv.refetched.push(id); return 'updated'; } }));
import { TellSheet } from './TellSheet';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { net } from '../../data/sync';
import { toasts } from '../../ui/toast';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';

const TODAY = '2026-11-23', D = '2026-11-25';
const owner = { id: 'u1', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const mechanic = { id: 'u3', owner: false, roles: ['mechanic'], rights: {}, trucks: ['t1'] } as unknown as Access;
const told = (day: string, start: number | null, end: number | null) => ({ told_day: day, told_start: start, told_end: end, told_at: '2026-11-20T10:00:00-05:00', told_how: 'sms' });
const job = (id: string, o: Record<string, unknown>) => ({ id, number: Number(id.replace(/\D/g, '')) || 1, truck_id: 't1', day: D, block: 'day', status: 'booked', stop_order: 1, duration_min: 60,
  win_start: 780, win_end: 1020, win_flex: false, eta_min: 840, deleted_at: null, ...o });
const CUSTOMERS = [
  { id: 'c1', first_name: 'Chloé', last_name: 'Gagnon', phone: '514 555-0101', sms_ok: true },
  { id: 'c2', first_name: 'Omar', last_name: 'Haddad', phone: '514 555-0102', sms_ok: true },
  { id: 'c3', first_name: 'Alice', last_name: 'Roy', phone: '514 555-0103', sms_ok: true },
  { id: 'c4', first_name: 'Fanny', last_name: 'Côté', phone: null, sms_ok: true },
  { id: 'c5', first_name: 'Hélène', last_name: 'Roy', phone: '514 555-0105', sms_ok: true }
];
/** mardi 25: Chloé told 9 h à 13 h now 13 h à 17 h; Omar never told; Alice two cars (one told mardi 24); Fanny no cell */
const WORLD = [
  job('j1', { customer_id: 'c1', ...told(D, 540, 780) }),
  job('j2', { customer_id: 'c2', win_start: 480, win_end: 720, eta_min: 500 }),
  job('j3', { customer_id: 'c3', ...told('2026-11-24', 540, 780) }),
  job('j4', { customer_id: 'c3', win_start: 540, win_end: 780, eta_min: 560 }),
  job('j5', { customer_id: 'c4' }),
  job('j6', { customer_id: 'c2', day: '2026-11-26' })
];
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const qa = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const sp = (s: string | null | undefined) => String(s).replace(/\s+/g, ' ').trim();
const settle = () => act(async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); } });
const click = async (el: HTMLElement | null) => { expect(el).toBeTruthy(); await act(async () => { el!.click(); }); await settle(); };
let closed = 0;
const open = async (day = D) => { await act(async () => { render(<TellSheet day={day} onClose={() => { closed++; }} />, box); }); await settle(); };
/** the server's list = what the phone shows (the rows are read from the same rule) */
const sameAsPhone = async (day: string) => (await import('./TellSheet')).phoneTellRows(day) as unknown[];
/** a row of « Ils reçoivent un texto »: the name, each appointment's line, the pill */
const rowOf = (r: HTMLElement) => [sp(r.querySelector('.row-title')!.textContent), ...[...r.querySelectorAll('[data-testid="tell-row-line"]')].map((x) => sp(x.textContent)),
  sp(r.querySelector('.pill')?.textContent ?? '')].filter(Boolean).join(' | ');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T09:00:00-05:00'));
  lang.value = 'fr'; clearAll(); access.value = owner; closed = 0; toasts.value = [];
  srv.list = sameAsPhone; srv.lists.length = 0; srv.sends.length = 0; srv.answers.length = 0; srv.marks.length = 0; srv.mark = null; srv.warms.length = 0; srv.refetched.length = 0;
  net.value = { ...net.value, online: true };
  replaceLocal('settings', [{ id: '1', booking: { windows_on: true, win_before_min: 60, win_after_min: 180, win_round_min: 60 }, messages: { on: {}, fr: {}, en: {} } }] as never);
  replaceLocal('customers', CUSTOMERS as never);
  replaceLocal('jobs', WORLD as never);
});
afterEach(async () => { await act(async () => { render(null, box); }); vi.useRealTimers(); access.value = null; });

describe('the list before sending', () => {
  it('from the phone at once: who gets a text (each customer once, his appointments under his name), who to tell yourself', async () => {
    srv.list = sameAsPhone;
    await open();
    expect(srv.lists).toEqual([D]);
    expect(q('tell-refreshed')).toBeNull();
    const reach = q('tell-reach')!;
    expect(sp(reach.querySelector('h3')!.textContent)).toBe('Ils reçoivent un texto (3)');
    expect(qa('tell-row').map(rowOf)).toEqual([
      'Omar Haddad | 8 h à 12 h la confirmation complète | Nouveau',
      'Alice Roy (2 autos) | 9 h à 13 h la confirmation complète | 13 h à 17 h avant : mar. 24',
      'Chloé Gagnon | 13 h à 17 h avant : 9 h à 13 h'
    ]);
    expect(sp(q('tell-tocall')!.textContent)).toContain('À avertir toi-même (1)');
    expect(sp(q('tell-tocall')!.textContent)).toContain('Fanny Côté');
    expect(sp(q('tell-tocall')!.textContent)).toContain('Pas de cellulaire');
    expect(sp(q('tell-go')!.textContent)).toBe('Envoyer à 3 clients');
  });
  it('the server’s list differs: the sheet follows it and says so', async () => {
    srv.list = () => [{ id: 'j2', number: 2, customer_id: 'c2', state: 'new', kind: 'booking', told: null, now: { day: D, start: 480, end: 720, rewin: false }, phone_ok: true, sms_ok: true, kind_on: true }];
    await open();
    expect(sp(q('tell-refreshed')!.textContent)).toBe('La liste vient d’être mise à jour.');
    expect(qa('tell-row').length).toBe(1);
    expect(sp(q('tell-go')!.textContent)).toBe('Envoyer à 1 client');
  });
  it('nobody to text: the button says so and is off; nobody at all: « Tous les clients … »', async () => {
    replaceLocal('jobs', [job('j5', { customer_id: 'c4' })] as never);
    await open();
    expect((q('tell-go') as HTMLButtonElement).disabled).toBe(true);
    expect(sp(q('tell-go')!.textContent)).toBe('Personne à texter');
    replaceLocal('jobs', [] as never);
    await open('2026-11-24');
    expect(sp(q('tell-all')!.textContent)).toBe('Tous les clients de demain ont leur heure.');
  });
  it('today: a customer whose sure arrival only slipped is listed apart, never in what the button sends', async () => {
    replaceLocal('jobs', [
      job('j7', { customer_id: 'c5', day: TODAY, win_start: 540, win_end: 780, eta_min: 800, ...told(TODAY, 540, 780) }),
      job('j8', { customer_id: 'c2', day: TODAY, win_start: 600, win_end: 840, eta_min: 640 })
    ] as never);
    await open(TODAY);
    expect(sp(q('tell-drift')!.textContent)).toContain('En retard sur sa plage (1) : le texto « en route » lui donnera l’heure');
    expect(sp(q('tell-drift')!.textContent)).toContain('Hélène Roy');
    expect(sp(q('tell-drift')!.textContent)).toContain('vers 13 h 20 (9 h à 13 h)');
    await click(q('tell-go'));
    expect(srv.sends.map((s) => s.only)).toEqual([['j8']]);
  });
  it('« Vraies routes » on, stops not measured: said under the head; « Mesurer d’abord » measures them, then the list is read again', async () => {
    replaceLocal('settings', [{ id: '1', booking: { windows_on: true, roads_on: true } }] as never);
    replaceLocal('jobs', [job('j2', { customer_id: 'c2', eta_measured: false, lat: 45.5, lng: -73.6 }), job('j9', { customer_id: 'c1', eta_measured: true, lat: 45.6, lng: -73.7 })] as never);
    await open();
    expect(sp(q('tell-unmeasured')!.textContent)).toContain('1 arrêt sans route mesurée : son heure peut encore changer.');
    await click(q('tell-measure'));
    expect(srv.warms).toEqual([{ lat: 45.5, lng: -73.6 }]);
    expect(srv.lists).toEqual([D, D]);
  });
  it('« Je l’ai averti » on a customer no text can reach: tell_mark how call with the hours he must be told; he leaves the list', async () => {
    await open();
    await click(q('tell-mark-j5'));
    expect(srv.marks).toEqual([[{ id: 'j5', how: 'call', kind: 'booking', day: D, start: 780, end: 1020 }]]);
    expect(toasts.value.map((x) => x.text)).toContain('Noté : Fanny a son heure.');
    expect(q('tell-tocall')).toBeNull();
    expect(srv.refetched).toEqual(['j5']);
  });
});

describe('sending', () => {
  it('« Envoyer à 3 clients »: the ids shown, again with what is left (a new call each round) until nothing is left; then the result', async () => {
    srv.list = sameAsPhone;
    srv.answers.push({ sent: ['j2'], left: ['j1', 'j3', 'j4'] }, { sent: ['j3', 'j4'], maybe: ['j1'] });
    await open();
    srv.list = () => [];
    await click(q('tell-go'));
    // tell_list's order: the new hours (8 h, 9 h, then 13 h by number)
    expect(srv.sends.map((s) => s.only)).toEqual([['j2', 'j4', 'j1', 'j3'], ['j1', 'j3', 'j4']]);
    expect(sp(q('tell-sent')!.textContent)).toBe('3 textos partis : Omar, Alice.');
    expect(sp(q('tell-maybe')!.textContent)).toContain('Peut-être parti : Chloé. Regarde sa conversation avant de renvoyer.');
    expect([...srv.refetched].sort()).toEqual(['j1', 'j2', 'j3', 'j4']);
    // « Renvoyer »: that one again, with `again`
    await click(q('tell-resend'));
    expect(srv.sends[2]).toEqual({ day: D, only: ['j1'], again: ['j1'] });
    expect(sp(q('tell-sent')!.textContent)).toBe('4 textos partis : Omar, Alice, Chloé.');
    expect(q('tell-maybe')).toBeNull();
    await click(q('tell-close'));
    expect(closed).toBe(1);
  });
  it('a list longer than notify takes (100 ids a call, else bad_list): sent in parts, what is left of each part asked again', async () => {
    const many = Array.from({ length: 130 }, (_, i) => job(`j${100 + i}`, { customer_id: 'c2', number: 100 + i, win_start: 480, win_end: 720, eta_min: 500 }));
    replaceLocal('jobs', many as never);
    srv.answers.push({ sent: many.slice(0, 98).map((j) => j.id), left: [many[98].id, many[99].id] });
    await open();
    await click(q('tell-go'));
    // (one window for all: the list's order is the numbers' order)
    expect(srv.sends.map((x) => x.only.length)).toEqual([100, 32]);
    expect(new Set([...srv.sends[0].only, ...srv.sends[1].only]).size).toBe(130);
    // the second call: what the first part left, then the rest of the list
    expect(srv.sends[1].only.slice(0, 2)).toEqual(srv.sends[0].only.slice(98, 100));
  });
  it('the result’s sections: not sent (Réessayer, « Je l’ai averti »), busy, already, to tell yourself', async () => {
    srv.answers.push({
      sent: [], busy: ['j3'], already: ['j4'], quiet: [{ id: 'j2', phone: '5145550102', why: 'sms_ok' }],
      failed: [{ id: 'j1', error: 'Le service de textos ne répond pas.', phone: '5145550101', told: { day: D, start: 780, end: 1020 }, kind: 'moved' }]
    });
    await open();
    srv.list = () => [];
    await click(q('tell-go'));
    expect(sp(q('tell-failed')!.textContent)).toContain('Pas parti : Chloé (Le service de textos ne répond pas.)');
    expect(sp(q('tell-busy')!.textContent)).toBe('Déjà en cours d’envoi par quelqu’un d’autre : Alice');
    expect(sp(q('tell-already')!.textContent)).toBe('Déjà averti : Alice');
    expect(sp(q('tell-self')!.textContent)).toContain('Omar 514 555-0102');
    // « Réessayer »: that one alone, a new call; it went
    srv.answers.push({ sent: ['j1'] });
    await click(q('tell-retry-j1'));
    expect(srv.sends[1].only).toEqual(['j1']);
    expect(q('tell-failed')).toBeNull();
    expect(sp(q('tell-sent')!.textContent)).toBe('1 texto parti : Chloé.');
    // a customer the text cannot reach: « Je l'ai averti » with the hours he must be told
    await click(q('tell-mark-j2'));
    expect(srv.marks[0]).toEqual([{ id: 'j2', how: 'call', kind: 'booking', day: D, start: 480, end: 720 }]);
    expect(q('tell-self')).toBeNull();
  });
  it('texts not connected: each message to send by hand, « Ouvrir dans Messages », « C’est envoyé » = tell_mark hand with what it said', async () => {
    srv.answers.push({ by_hand: [
      { id: 'j1', phone: '5145550101', message: 'Bonjour Chloé, votre rendez-vous a changé : …', link: 'https://x/1', told: { day: D, start: 780, end: 1020 }, kind: 'moved' },
      { id: 'j2', phone: '5145550102', message: 'Bonjour Omar…', link: null, told: { day: D, start: 480, end: 720 }, kind: 'booking' },
      { id: 'j4', phone: '5145550103', message: 'Bonjour Alice…', link: null, told: { day: D, start: 540, end: 780 }, kind: 'booking' }
    ] });
    await open();
    srv.list = () => [];
    await click(q('tell-go'));
    expect(sp(q('tell-byhand')!.textContent)).toContain('Les textos automatiques ne sont pas branchés : envoie-les toi-même.');
    expect(decodeURIComponent(q('tell-open-j1')!.getAttribute('href')!)).toContain('Bonjour Chloé, votre rendez-vous a changé : …\nhttps://x/1');
    await click(q('tell-handed-j1'));
    expect(srv.marks[0]).toEqual([{ id: 'j1', how: 'hand', kind: 'moved', day: D, start: 780, end: 1020 }]);
    expect(q('tell-handed-j1')).toBeNull();
    await click(q('tell-all-sent'));
    expect(srv.marks[1]).toEqual([{ id: 'j2', how: 'hand', kind: 'booking', day: D, start: 480, end: 720 }, { id: 'j4', how: 'hand', kind: 'booking', day: D, start: 540, end: 780 }]);
    expect(q('tell-byhand')).toBeNull();
  });
  it('an answer lost on the way: never asked again with the same op; the list read again says what is left, with the button', async () => {
    srv.list = sameAsPhone;
    srv.answers.push(new TypeError('Failed to fetch'));
    await open();
    await click(q('tell-go'));
    expect(srv.sends.length).toBe(1);
    expect(srv.lists).toEqual([D, D]);
    expect(sp(q('tell-left')!.textContent)).toContain('Encore à avertir : 3');
    srv.answers.push({ sent: ['j2', 'j3', 'j4', 'j1'] });
    srv.list = () => [];
    await click(q('tell-go-left'));
    expect(srv.sends[1].only.sort()).toEqual(['j1', 'j2', 'j3', 'j4']);
  });
  it('the sheet back on screen (the phone was locked): the list is read again', async () => {
    await open();
    expect(srv.lists.length).toBe(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await settle();
    expect(srv.lists.length).toBe(2);
  });
  it('offline: nothing is sent, it says why; a refusal of the server is shown', async () => {
    await open();
    net.value = { ...net.value, online: false };
    await click(q('tell-go'));
    expect(srv.sends.length).toBe(0);
    expect(toasts.value.map((x) => x.text)).toContain('Pas de réseau : les textos ne peuvent pas partir. Réessaie quand le réseau revient.');
    net.value = { ...net.value, online: true };
    srv.answers.push({ ok: false, code: 'not_allowed', error: 'Seuls le propriétaire et le bureau envoient les heures aux clients.' });
    await click(q('tell-go'));
    expect(sp(q('tell-failure')!.textContent)).toContain('Seuls le propriétaire et le bureau');
  });
});

describe('rights and words', () => {
  it('a mechanic: what the button is for, nothing asked of the server', async () => {
    access.value = mechanic;
    await open();
    expect(sp(q('tell-right')!.textContent)).toBe('Seuls le propriétaire et le bureau envoient les heures aux clients.');
    expect(srv.lists.length).toBe(0);
  });
  it('English', async () => {
    lang.value = 'en';
    await open();
    expect(sp(q('tell-reach')!.querySelector('h3')!.textContent)).toBe('They get a text (3)');
    expect(sp(q('tell-go')!.textContent)).toBe('Send to 3 customers');
    expect(qa('tell-row').map(rowOf)[2]).toBe('Chloé Gagnon | 1 p.m. to 5 p.m. before: 9 a.m. to 1 p.m.');
  });
});

export type { TellRow };

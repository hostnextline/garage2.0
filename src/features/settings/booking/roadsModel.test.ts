/* « Vraies routes », the rules without the screen: the measure loop, the words of every failure, the customers to call. */
import { describe, it, expect, beforeEach } from 'vitest';
import { lang } from '../../../lib/i18n';
import { addDays, today, clock } from '../../../lib/dates';
import { replaceLocal } from '../../../data/store';
import type { DriveAnswer, DriveDone } from '../../../data/roads';
import type { Customer, Job } from '../../../data/types';
import { measureLoop, refusalOf, failWords, fnMissing, serviceNote, loopWords, lateRows, lateText, switchOutcome, rushBlocked, rushBlockedNow, MAX_ROUNDS, type LoopResult } from './roadsModel';
import { t } from '../../../lib/i18n';
import { viewOf, patchOf, check, planOf, ROAD_DEFAULTS } from './model';
import { DEFAULT_SETTINGS } from '../../../data/select';
import type { Settings } from '../../../data/types';

const BLOCKS = [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }];
beforeEach(() => { lang.value = 'fr'; replaceLocal('settings', [{ id: '1', booking: { blocks: BLOCKS } } as never]); });
const sp = (s: string | null) => String(s).replace(/\s/g, ' ');
const done = (x: Partial<DriveDone> = {}): DriveDone => ({ ok: true, ready: false, left: 0, left0: 0, stored: 0, planned: 0, kept: [], late: [], no_road: 0,
  tomtom: 'ok', osrm: 'unused', spent: { month: '2026-11-01', tx: 0, cap: 10000 }, more: false, ...x });
/** a pretend sweep: answers the list in order (an Error is thrown) */
const seq = (list: (DriveAnswer | Error)[]) => { let i = 0; const calls = { n: 0 }; const fn = async () => { calls.n++; const a = list[Math.min(i++, list.length - 1)]; if (a instanceof Error) throw a; return a; }; return { fn, calls }; };

describe('the measure loop', () => {
  it('calls again while `more`, adds up what was measured, stops when everything is measured', async () => {
    const s = seq([done({ stored: 24, left: 40, left0: 30, more: true }), done({ stored: 24, left: 16, left0: 6, more: true }), done({ stored: 16, left: 0, left0: 0 })]);
    const seen: number[] = [];
    const r = await measureLoop(s.fn, { goal: 'all', onRound: (p) => seen.push(p.left) });
    expect([r.end, r.stored, r.rounds, s.calls.n]).toEqual(['done', 64, 3, 3]);
    expect(seen).toEqual([40, 16, 0]);
  });
  it('the switch waits only for the usual hours: done as soon as left0 is 0, even with rush times left and more', async () => {
    const s = seq([done({ stored: 24, left: 50, left0: 12, more: true }), done({ stored: 12, left: 30, left0: 0, more: true }), done({ left: 0 })]);
    const r = await measureLoop(s.fn, { goal: 'usual' });
    expect([r.end, s.calls.n]).toEqual(['done', 2]);
    expect(r.last?.left).toBe(30);
  });
  it('nothing more the function can do now: « usualOnly » for everything when the rush hours never come (no TomTom key: review R3), « stuck » for the usual hours', async () => {
    expect((await measureLoop(seq([done({ stored: 3, left: 18, left0: 0, tomtom: 'no_key', osrm: 'ok' })]).fn, { goal: 'all' })).end).toBe('usualOnly');
    expect((await measureLoop(seq([done({ stored: 3, left: 18, left0: 0, tomtom: 'busy', osrm: 'ok' })]).fn, { goal: 'all' })).end).toBe('rest');
    const down = done({ left: 20, left0: 20, tomtom: 'busy', osrm: 'down' });
    expect((await measureLoop(seq([down]).fn, { goal: 'usual' })).end).toBe('stuck');
  });
  it('rounds that measure nothing and leave as much: stuck after two (never an endless loop)', async () => {
    const s = seq([done({ stored: 5, left: 10, left0: 10, more: true }), done({ left: 10, left0: 10, more: true })]);
    const r = await measureLoop(s.fn, { goal: 'usual' });
    expect([r.end, s.calls.n]).toEqual(['stuck', 3]);
  });
  it('a ceiling of rounds', async () => {
    let left = 10000;
    const fn = async () => done({ stored: 1, left: --left, left0: left, more: true });
    const r = await measureLoop(fn, { goal: 'all' });
    expect([r.end, r.rounds]).toEqual(['limit', MAX_ROUNDS]);
  });
  it('a refusal or a call that throws ends it, with the reason; the person can stop it between two calls', async () => {
    const r = await measureLoop(seq([done({ stored: 2, left: 5, left0: 5, more: true }), { ok: false, code: 'NOT_FOUND', at: 'drive' }]).fn, { goal: 'all' });
    expect([r.end, r.failure?.code, r.stored]).toEqual(['failed', 'NOT_FOUND', 2]);
    const t = await measureLoop(seq([new Error('Failed to fetch')]).fn, { goal: 'all' });
    expect([t.end, t.failure?.code]).toEqual(['failed', 'network']);
    const o = await measureLoop(seq([Object.assign(new Error('timeout'), { code: 'timeout' })]).fn, { goal: 'all' });
    expect(o.failure?.code).toBe('timeout');
    let stop = false;
    const s = seq([done({ stored: 1, left: 9, left0: 9, more: true })]);
    const p = await measureLoop(s.fn, { goal: 'all', stopped: () => stop, onRound: () => { stop = true; } });
    expect([p.end, s.calls.n]).toEqual(['stopped', 1]);
  });
  it('the person left the screen: the round under way ends, no new one starts (« away »), what it measured is kept', async () => {
    let gone = false;
    const s = seq([done({ stored: 4, left: 9, left0: 9, more: true })]);
    const r = await measureLoop(s.fn, { goal: 'all', away: () => gone, onRound: () => { gone = true; } });
    expect([r.end, s.calls.n, r.stored, r.last?.left]).toEqual(['away', 1, 4, 9]);
    // gone before it starts: nothing asked
    const n = seq([done()]);
    expect([(await measureLoop(n.fn, { goal: 'usual', away: () => true })).end, n.calls.n]).toEqual(['away', 0]);
  });
  it('switch on: the blocks kept and the customers now late of every round, each once', async () => {
    const day = addDays(today(), 1);
    const s = seq([done({ stored: 5, left: 5, left0: 5, more: true, planned: 2, kept: [{ day, block: 'am' }], late: ['j1'] }),
      done({ stored: 5, planned: 1, kept: [{ day, block: 'am' }], late: ['j1', 'j2'] })]);
    const r = await measureLoop(s.fn, { goal: 'all' });
    expect([r.planned, r.kept, r.late]).toEqual([3, [{ day, block: 'am' }], ['j1', 'j2']]);
  });
});

describe('the words', () => {
  const other = () => 'AUTRE';
  it('the function not installed (Supabase 404, the local copy), no network, no answer, the brakes, the demo', () => {
    expect(fnMissing({ code: 'NOT_FOUND' })).toBe(true);
    expect(fnMissing({ code: 'server', error: 'no function drive' })).toBe(true);
    expect(fnMissing({ code: 'busy', error: 'Trop de demandes' })).toBe(false);
    expect(failWords({ ok: false, code: 'NOT_FOUND' }, other)).toContain('pas encore installée sur le serveur');
    expect(failWords({ ok: false, code: 'network' }, other)).toContain('Vérifie Internet');
    expect(failWords({ ok: false, code: 'timeout' }, other)).toContain('pas répondu à temps');
    expect(failWords({ ok: false, code: 'busy' }, other)).toContain('Réessaie dans un moment');
    expect(failWords({ ok: false, code: 'not_allowed', error: 'Non.' }, other)).toBe('AUTRE');
    lang.value = 'en';
    expect(failWords({ ok: false, code: 'NOT_FOUND' }, other)).toContain('not installed on the server yet');
  });
  it('a call that threw, as a refusal: the app’s limit, « Voir l’app comme… », anything else = no network', () => {
    expect(refusalOf({ code: 'timeout' }).code).toBe('timeout');
    expect(refusalOf({ hint: 'preview', code: 'preview' }).code).toBe('preview');
    expect(refusalOf(new TypeError('Failed to fetch')).code).toBe('network');
  });
  it('what the two route services did: no key, TomTom refuses, busy, the month’s ceiling, both down; TomTom fine = nothing', () => {
    expect(serviceNote('ok', 'unused')).toBeNull();
    expect(serviceNote('unused', 'unused')).toBeNull();
    expect(serviceNote('no_key', 'ok')).toContain('pas la clé de TomTom');
    expect(serviceNote('refused', 'ok')).toContain('TomTom refuse la clé');
    expect(serviceNote('busy', 'ok')).toContain('trop occupé');
    expect(serviceNote('over_budget', 'ok')).toContain('plafond du mois');
    expect(serviceNote('busy', 'down')).toContain('Ni TomTom ni');
    expect(serviceNote('no_key', 'down')).toContain('Ni TomTom ni');
  });
  it('how a loop ended', () => {
    const r = (end: 'done' | 'rest' | 'stuck' | 'stopped' | 'away' | 'limit', last: Partial<DriveDone>, stored = 0) => loopWords({ end, last: done(last), failure: null, stored, rounds: 1, planned: 0, kept: [], late: [] });
    expect(r('done', { left: 0 })).toBe('Tous les trajets à venir sont mesurés.');
    expect(r('done', { left: 12, left0: 0 })).toContain('heures de pointe se mesurent ensuite');
    expect(r('rest', { left: 18 }, 6)).toContain('18 trajets restent');
    expect(r('stuck', { left: 30, left0: 4 })).toContain('4 trajets n’ont pas pu être mesurés');
    expect(r('stopped', { left: 7 })).toContain('7 trajets restent à mesurer');
    expect(r('limit', { left: 7 })).toContain('Mesurer maintenant');
    expect(r('away', { left: 7 })).toBe('La mesure s’est arrêtée quand tu as quitté l’écran : 7 trajets restent. Touche « Mesurer maintenant » pour continuer.');
    lang.value = 'en';
    expect(r('away', { left: 1 })).toBe('The measure stopped when you left the screen: 1 drive is left. Tap « Measure now » to go on.');
  });
});

describe('the customers now late, to call', () => {
  const tomorrow = addDays(today(), 1);
  const jobs: Record<string, Partial<Job>> = {
    j1: { id: 'j1', number: 41, customer_id: 'c1', day: tomorrow, block: 'am', eta_min: 745, win_start: null, win_end: null },
    j2: { id: 'j2', number: 42, customer_id: null, day: tomorrow, block: 'day', eta_min: 900, win_start: 600, win_end: 840 }
  };
  const customers: Record<string, Partial<Customer>> = { c1: { id: 'c1', first_name: 'Julie', last_name: 'Roy', phone: '514 555-1234', lang: 'en' } };
  const rowsOf = () => lateRows(['j1', 'j2', 'gone'], (id) => jobs[id] as Job, (id) => (id ? customers[id] as Customer : undefined),
    (c) => (c ? `${c.first_name} ${c.last_name}` : ''), 'fr');
  it('names, the moment told (block or window), the planned arrival; a job the device does not have: its place only', () => {
    const [a, b, c] = rowsOf();
    expect([a.name, a.phone, sp(a.told), a.eta, a.lang]).toEqual(['Julie Roy', '514 555-1234', 'demain matin (8 h à 12 h)', 745, 'en']);
    expect([b.name, sp(b.told), b.phone]).toEqual(['#42', 'demain, entre 10 h et 14 h', null]);
    expect([c.name, c.told, c.eta]).toEqual(['Rendez-vous', '', null]);
  });
  it('the text is in the customer’s language, with the new arrival time', () => {
    const [a] = rowsOf();
    expect(sp(lateText(a))).toBe(sp(`Hello Julie, a small change for your appointment tomorrow: the mechanic will arrive around ${clock(745, 'en')}. Thank you for your patience!`));
    expect(sp(lateText({ ...a, lang: 'fr', eta: null, first: null, when: 'demain' }))).toBe('Bonjour, petit changement pour votre rendez-vous demain : le mécanicien arrivera un peu plus tard que prévu. Merci de votre patience !');
  });
  it('the switch’s answer kept as it is', () => {
    expect(switchOutcome({ ok: true, on: true, planned: 3, kept: [{ day: tomorrow, block: 'am' }], late: ['j1'], unchanged: false }))
      .toEqual({ on: true, planned: 3, kept: [{ day: tomorrow, block: 'am' }], late: ['j1'] });
  });
});

describe('the small settings of « Vraies routes » (Réglages → Réservations)', () => {
  const stored = (x: Record<string, unknown> = {}): Settings['booking'] => ({ ...DEFAULT_SETTINGS.booking, ...x } as Settings['booking']);
  it('missing: rush on, 10 000 a month, near = 10 min; a stored value is shown', () => {
    expect([viewOf(stored()).roads_rush, viewOf(stored()).roads_month_tx, viewOf(stored()).near_min]).toEqual([true, ROAD_DEFAULTS.roads_month_tx, ROAD_DEFAULTS.near_min]);
    const v = viewOf(stored({ roads_rush: false, roads_month_tx: 2500, near_min: 8 }));
    expect([v.roads_rush, v.roads_month_tx, v.near_min]).toEqual([false, 2500, 8]);
  });
  it('only what was touched is written, whole numbers; roads_on is never written from the form', () => {
    expect(patchOf({ roads_rush: false, roads_month_tx: 2500.4, near_min: 7.6 }, stored(), false)).toEqual({ roads_rush: false, roads_month_tx: 2500, near_min: 8 });
    expect(patchOf({ horizon_days: 90 }, stored({ roads_on: true }), false)).toEqual({ horizon_days: 90 });
  });
  it('the ceiling may be 0 (never TomTom); « near » in minutes is checked only while the real roads are on', () => {
    const v = viewOf(stored());
    expect(check({ ...v, roads_month_tx: 0 }, { winOn: false, placeChanged: false }).errors).toEqual({});
    expect(Object.keys(check({ ...v, roads_month_tx: -1 }, { winOn: false, placeChanged: false }).errors)).toEqual(['roads_month_tx']);
    expect(check({ ...v, near_min: 0 }, { winOn: false, placeChanged: false }).errors).toEqual({});
    expect(Object.keys(check({ ...v, near_min: 0 }, { winOn: false, placeChanged: false, roadsOn: true }).errors)).toEqual(['near_min']);
  });
  it('the public page’s own TomTom budget (roads_web_tx, decision of 2026-11-20 19:20): 1 000 when missing, may be 0, whole numbers, written only when touched, never re-plans', () => {
    expect(viewOf(stored()).roads_web_tx).toBe(1000);
    expect(ROAD_DEFAULTS.roads_web_tx).toBe(1000);
    expect(viewOf(stored({ roads_web_tx: 0 })).roads_web_tx).toBe(0);
    expect(viewOf(stored({ roads_web_tx: 250 })).roads_web_tx).toBe(250);
    expect(patchOf({ roads_web_tx: 300.4 }, stored(), false)).toEqual({ roads_web_tx: 300 });
    expect('roads_web_tx' in patchOf({ roads_month_tx: 2500 }, stored(), false)).toBe(false);
    const v = viewOf(stored());
    expect(check({ ...v, roads_web_tx: 0 }, { winOn: false, placeChanged: false }).errors).toEqual({});
    expect(Object.keys(check({ ...v, roads_web_tx: -1 }, { winOn: false, placeChanged: false }).errors)).toEqual(['roads_web_tx']);
    expect(planOf({ ...v, roads_web_tx: 5 }, true)).toBe(planOf(v, true));
    expect(planOf({ ...v, roads_web_tx: 5 }, false)).toBe(planOf(v, false));
  });
  it('what re-plans follows the server’s plan_inputs: on, the speed and the detour do not, the rush hours do; off, as before', () => {
    const v = viewOf(stored());
    expect(planOf({ ...v, speed_kmh: 40 }, true)).toBe(planOf(v, true));
    expect(planOf({ ...v, detour_pct: 50 }, true)).toBe(planOf(v, true));
    expect(planOf({ ...v, roads_rush: false }, true)).not.toBe(planOf(v, true));
    expect(planOf({ ...v, stop_min: 9 }, true)).not.toBe(planOf(v, true));
    expect(planOf({ ...v, speed_kmh: 40 }, false)).not.toBe(planOf(v, false));
    expect(planOf({ ...v, roads_rush: false }, false)).toBe(planOf(v, false));
    expect(planOf(v)).toBe(planOf(v, false));
  });
});

/* review-settings, round 3b: each test failed on the code it was written against (the reviewer's proofs P4, P5, P6, P8, P9
   and mutation M10 turned around), then the fix made it pass. */
describe('review-settings round 3b: the end of a measure says only what is true', () => {
  const spent0 = { month: '2026-11-01', tx: 0, cap: 0 };
  it('R3 no TomTom key, TomTom refusing it, or a ceiling of 0: the usual hours measured, the rush hours said impossible, never « plus tard »', async () => {
    for (const [x, why] of [[{ tomtom: 'no_key' }, 'avec la clé de TomTom'], [{ tomtom: 'refused' }, 'avec la clé de TomTom'],
      [{ tomtom: 'over_budget', spent: spent0 }, 'le plafond du mois chez TomTom est à 0']] as [Partial<DriveDone>, string][]) {
      const r = await measureLoop(seq([done({ stored: 16, left: 20, left0: 0, osrm: 'ok', ...x })]).fn, { goal: 'all' });
      expect(r.end).toBe('usualOnly');
      const w = sp(loopWords(r));
      expect(w).toContain('Les trajets aux heures habituelles sont mesurés.');
      expect(w).toContain(why);
      expect(w).toContain('(ou éteins « Heures de pointe »)');
      expect(w).not.toMatch(/plus tard|mois prochain|Mesure faite/);
    }
    lang.value = 'en';
    const e = await measureLoop(seq([done({ stored: 16, left: 20, left0: 0, tomtom: 'no_key', osrm: 'ok' })]).fn, { goal: 'all' });
    expect(sp(loopWords(e))).toBe('The drives at the usual hours are measured. The rush hours are measured only with TomTom’s key (or switch « Rush hours » off).');
    lang.value = 'fr';
    // a ceiling of 0 is « jamais TomTom », not « attendent le mois prochain »; a ceiling reached is
    expect(sp(serviceNote('over_budget', 'ok', undefined, 0))).toContain('à 0 : l’app ne demande jamais TomTom');
    expect(sp(serviceNote('over_budget', 'ok', undefined, 0))).not.toContain('mois prochain');
    expect(sp(serviceNote('over_budget', 'ok', undefined, 10000))).toContain('attendent le mois prochain');
    expect(sp(serviceNote('over_budget', 'ok'))).toContain('attendent le mois prochain');
    // the ceiling reached (not 0) or TomTom busy: the rush hours DO come later
    expect((await measureLoop(seq([done({ stored: 4, left: 20, left0: 0, tomtom: 'over_budget', osrm: 'ok' })]).fn, { goal: 'all' })).end).toBe('rest');
    expect((await measureLoop(seq([done({ stored: 4, left: 20, left0: 0, tomtom: 'busy', osrm: 'ok' })]).fn, { goal: 'all' })).end).toBe('rest');
    // the switch ON waits only for the usual hours: done, as before
    expect((await measureLoop(seq([done({ stored: 4, left: 20, left0: 0, tomtom: 'no_key', osrm: 'ok' })]).fn, { goal: 'usual' })).end).toBe('done');
  });
  it('R3 why the rush hours cannot be measured: from an answer, and from the status', () => {
    expect([rushBlocked(done({ tomtom: 'no_key' })), rushBlocked(done({ tomtom: 'refused' })), rushBlocked(done({ tomtom: 'over_budget', spent: spent0 }))]).toEqual(['key', 'key', 'cap']);
    expect([rushBlocked(done({ tomtom: 'over_budget' })), rushBlocked(done({ tomtom: 'busy' })), rushBlocked(done({ tomtom: 'ok' }))]).toEqual([null, null, null]);
    const st = { ok: true as const, key: true, on: false, left: 9, left0: 1, month: { month: '2026-11-01', tx: 5, cap: 10000 }, rows: { tomtom: 0, osrm: 0, none: 0 } };
    expect([rushBlockedNow(st), rushBlockedNow({ ...st, key: false }), rushBlockedNow({ ...st, month: spent0 }), rushBlockedNow({ ...st, month: null })]).toEqual([null, 'key', 'cap', null]);
  });
  it('R3 the progress counts only what can be measured: without TomTom, the usual-hours trips', async () => {
    const seen: number[] = [];
    await measureLoop(seq([done({ stored: 20, left: 40, left0: 10, more: true, tomtom: 'no_key', osrm: 'ok' }), done({ stored: 10, left: 30, left0: 0, tomtom: 'no_key', osrm: 'ok' })]).fn,
      { goal: 'all', onRound: (p) => seen.push(p.todo) });
    expect(seen).toEqual([10, 0]);
    const all: number[] = [];
    await measureLoop(seq([done({ stored: 20, left: 40, left0: 10, more: true }), done({ stored: 40, left: 0, left0: 0 })]).fn, { goal: 'all', onRound: (p) => all.push(p.todo) });
    expect(all).toEqual([40, 0]);
  });
  it('R4 nothing measured at all (TomTom and OSRM down): « n’ont pas pu être mesurés », never « Mesure faite »', async () => {
    const r = await measureLoop(seq([done({ stored: 0, left: 30, left0: 30, tomtom: 'busy', osrm: 'down' })]).fn, { goal: 'all' });
    expect(r.end).toBe('stuck');
    expect(sp(loopWords(r))).toBe('30 trajets n’ont pas pu être mesurés pour l’instant. Réessaie plus tard.');
    // nothing stored, only rush hours left that come later (TomTom busy): not « Mesure faite » either
    const b = await measureLoop(seq([done({ stored: 0, left: 12, left0: 0, tomtom: 'busy', osrm: 'ok' })]).fn, { goal: 'all' });
    expect(b.end).toBe('rest');
    expect(sp(loopWords(b))).toBe('Pas de mesure possible pour l’instant : 12 trajets attendent, ils se mesureront plus tard.');
    // something stored: « Mesure faite », as before
    const c = await measureLoop(seq([done({ stored: 6, left: 12, left0: 0, tomtom: 'busy', osrm: 'ok' })]).fn, { goal: 'all' });
    expect(sp(loopWords(c))).toBe('Mesure faite. 12 trajets restent : ils se mesureront plus tard.');
  });
  it('R8 the switch ON (usual hours): the counts said are the usual-hours trips that hold it, not every trip', () => {
    const r = (end: LoopResult['end'], goal: 'all' | 'usual') => sp(loopWords({ end, goal, last: done({ left: 340, left0: 12, more: true }), failure: null, stored: 900, rounds: 40, planned: 0, kept: [], late: [] }));
    for (const end of ['limit', 'stopped', 'away'] as const) {
      expect(r(end, 'usual')).toContain('12 trajets');
      expect(r(end, 'usual')).not.toContain('340');
      expect(r(end, 'all')).toContain('340 trajets');
    }
    // a loop result carries its goal
    return measureLoop(seq([done({ stored: 1, left: 5, left0: 5, more: true })]).fn, { goal: 'usual', maxRounds: 1 }).then((x) => expect([x.end, x.goal]).toEqual(['limit', 'usual']));
  });
  it('R9 the progress words count in the singular and the plural', () => {
    expect(sp(t('settings.booking.roads.measuring', { n: 1, left: 1 }))).toBe('Mesure en cours : 1 trajet mesuré, 1 à mesurer.');
    expect(sp(t('settings.booking.roads.measuring', { n: 0, left: 5 }))).toBe('Mesure en cours : aucun trajet mesuré encore, 5 à mesurer.');
    expect(sp(t('settings.booking.roads.measuring', { n: 24, left: 24 }))).toBe('Mesure en cours : 24 trajets mesurés, 24 à mesurer.');
    expect(sp(t('settings.booking.roads.measuringUsual', { n: 1, left: 3 }))).toBe('Mesure des heures habituelles : 1 trajet mesuré, 3 à mesurer.');
    expect(sp(t('settings.booking.roads.measuring', { n: 1, left: 1 }, 'en'))).toBe('Measuring: 1 drive measured, 1 to measure.');
    expect(sp(t('settings.booking.roads.measuring', { n: 0, left: 5 }, 'en'))).toBe('Measuring: no drive measured yet, 5 to measure.');
    expect(sp(t('settings.booking.roads.measuringUsual', { n: 2, left: 3 }, 'en'))).toBe('Measuring the usual hours: 2 drives measured, 3 to measure.');
  });
  it('R7 « proche » in minutes emptied, then the switch off before « Enregistrer »: nothing written (never 0)', () => {
    const b = { ...DEFAULT_SETTINGS.booking, roads_on: true } as Settings['booking'];
    expect('near_min' in patchOf({ near_min: null }, b, false)).toBe(false);
    expect('near_min' in patchOf({ near_min: Number.NaN }, b, false)).toBe(false);
    expect(patchOf({ near_min: 7 }, b, false)).toEqual({ near_min: 7 });
  });
  it('R12 (M10) a stored ceiling of 0 (« jamais TomTom ») is shown as 0, not the usual 10 000', () => {
    expect(viewOf({ ...DEFAULT_SETTINGS.booking, roads_month_tx: 0 } as Settings['booking']).roads_month_tx).toBe(0);
  });
});

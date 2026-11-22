/* « exact move », the one flow (STATE.md A2, A4, A5): the preview first, then ONE question by its four cases, then
   « Garde-route », then the move with the stops accepted late; never queued without signal. The server is pretended. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from '../../data/types';
import type { ExactAnswer, ExactStop } from '../../data/exact';

const api = vi.hoisted(() => ({ moveJob: vi.fn() }));
const exact = vi.hoisted(() => ({ exactPreview: vi.fn() }));
const ui = vi.hoisted(() => ({ ask: vi.fn(), toast: vi.fn() }));
const rows = vi.hoisted(() => ({ job: vi.fn(), customer: vi.fn(), truckLabel: vi.fn() }));
const roads = vi.hoisted(() => ({ warmJobDay: vi.fn() }));
const sync = vi.hoisted(() => ({ refetch: vi.fn() }));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<object>()), ...sync }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock('../../data/roads', async (orig) => ({ ...(await orig<object>()), ...roads }));
vi.mock('../../data/exact', async (orig) => ({ ...(await orig<object>()), ...exact }));
vi.mock('../../ui', async (orig) => ({ ...(await orig<object>()), ...ui }));
vi.mock('../../data/select', async (orig) => ({ ...(await orig<object>()), ...rows }));

import { setNet } from '../../data/net';
import { lang } from '../../lib/i18n';
import { errorMessage } from '../../lib/errors';
import { moveAt, doneWords } from './exactMove';

const DAY = '2030-01-10';
const julie = (o: Partial<Job> = {}): Job => ({ id: 'j1', number: 7, day: DAY, block: 'day', status: 'booked', win_start: 540, win_end: 780, win_flex: false, eta_min: 600,
  truck_id: 't1', truck_pinned: false, duration_min: 60, customer_id: 'c-julie', ...o } as Job);
const PEOPLE: Record<string, { first_name: string }> = { 'c-julie': { first_name: 'Julie' }, 'c-carla': { first_name: 'Carla' }, 'c-bob': { first_name: 'Bob' } };
const JOBS: Record<string, Partial<Job>> = { j1: { customer_id: 'c-julie' }, c: { customer_id: 'c-carla' }, b: { customer_id: 'c-bob' } };
const stop = (o: Partial<ExactStop>): ExactStop => ({ id: 'x', day: DAY, truckId: 't1', orderBefore: 1, orderAfter: 1, etaBefore: 600, etaAfter: 600, winStart: 540, winEnd: 780, delay: 0, late: false, lateMin: 0, measured: null, ...o });
const answer = (o: Partial<ExactAnswer> = {}): ExactAnswer => ({ exact: true, stops: [stop({ id: 'j1', etaBefore: 600, etaAfter: 780 })], overHours: 0, earliest: null, earliestKeep: null, refused: null, ...o });
const asked = (i = 0) => ui.ask.mock.calls[i][0] as { title: string; text: string; ok: string; cancel?: string; danger?: boolean };
const sent = (i = 0) => api.moveJob.mock.calls[i];

beforeEach(() => {
  vi.clearAllMocks();
  lang.value = 'fr';
  setNet({ online: true });
  ui.ask.mockResolvedValue(true);
  rows.customer.mockImplementation((id: string) => PEOPLE[id]);
  rows.job.mockImplementation((id: string) => (JOBS[id] ? { id, ...JOBS[id] } : undefined));
  rows.truckLabel.mockImplementation((id: string) => (id === 't2' ? 'Voiture' : 'Camion'));
  roads.warmJobDay.mockResolvedValue({ ok: true, ready: true });
  sync.refetch.mockResolvedValue('updated');
  api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, exact: true, stops: [{ id: 'j1', eta_before: 600, eta_after: 780 }] } });
});

describe('« Vraies routes »: the address measured first (A7)', () => {
  it('the trips of that address for the day it goes to are measured BEFORE the preview, and the flow waits for them', async () => {
    const order: string[] = [];
    let done: (v: unknown) => void = () => {};
    roads.warmJobDay.mockImplementation(() => { order.push('warm'); return new Promise((r) => { done = r; }); });
    exact.exactPreview.mockImplementation(async () => { order.push('preview'); return answer(); });
    api.moveJob.mockImplementation(async () => { order.push('move'); return { queued: false, data: { ok: true } }; });
    const p = moveAt({ job: julie(), day: '2030-01-11', truck: null, at: 780, confirm: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['warm']);
    expect(roads.warmJobDay).toHaveBeenCalledWith('j1', '2030-01-11');
    done({ ok: true, ready: true });
    await p;
    expect(order).toEqual(['warm', 'preview', 'move']);
  });
});

describe('no signal (A4)', () => {
  it('says it and keeps nothing on the phone: no preview, no move', async () => {
    setNet({ online: false });
    expect(await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: true })).toEqual({ kind: 'stopped' });
    expect(exact.exactPreview).not.toHaveBeenCalled();
    expect(api.moveJob).not.toHaveBeenCalled();
    expect(ui.toast.mock.calls[0][0]).toMatch(/^Pas de réseau/);
  });
  it('the signal lost during the preview: the same words, nothing queued', async () => {
    // review F3: the browser's « no network » (a timeout is no answer, not no signal: below)
    exact.exactPreview.mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: true })).kind).toBe('stopped');
    expect(api.moveJob).not.toHaveBeenCalled();
    expect(ui.toast.mock.calls[0][0]).toMatch(/^Pas de réseau/);
  });
});

describe('a weak signal, a slow server (review F3)', () => {
  it('the preview does not answer in a few seconds: « Je n’ai pas pu vérifier… », « Déplacer quand même » moves it', async () => {
    exact.exactPreview.mockImplementation(() => new Promise(() => undefined));
    const d = await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: true, previewMs: 20 });
    expect(asked().text.split('\n')[0]).toBe('Je n’ai pas pu vérifier l’heure des autres clients.');
    expect([asked().ok, asked().cancel]).toEqual(['Déplacer quand même', 'Annuler']);
    expect(sent()[4]).toMatchObject({ at: 780, lateOk: [] });
    expect(d.kind).toBe('moved');
  });
  it('the preview answers « timeout » or a server error: the same question, never « Pas de réseau »', async () => {
    exact.exactPreview.mockRejectedValueOnce({ code: 'timeout', name: 'AbortError' }).mockRejectedValueOnce({ status: 503, message: 'busy' });
    ui.ask.mockResolvedValue(false);
    expect((await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: true })).kind).toBe('stopped');
    expect((await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: true })).kind).toBe('stopped');
    expect(ui.ask.mock.calls.map((c) => (c[0] as { text: string }).text.split('\n')[0])).toEqual(['Je n’ai pas pu vérifier l’heure des autres clients.', 'Je n’ai pas pu vérifier l’heure des autres clients.']);
    expect(ui.toast).not.toHaveBeenCalled();
    expect(api.moveJob).not.toHaveBeenCalled();
  });
  it('the move sent, its answer lost: « peut-être fait », and that day asked again of the server (never « Pas de réseau, réessaie »)', async () => {
    exact.exactPreview.mockResolvedValue(answer());
    api.moveJob.mockRejectedValue({ code: 'timeout', name: 'AbortError' });
    const d = await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: false });
    expect(d.kind).toBe('stopped');
    expect(ui.toast.mock.calls.at(-1)?.[0]).toBe('Pas de réponse du serveur : le déplacement est peut-être fait. Regarde l’agenda dans un instant avant de réessayer.');
    await new Promise((r) => setTimeout(r, 0));
    expect(sync.refetch).toHaveBeenCalledWith('jobs', 'j1');
    // no signal at all when sent (the browser's « Failed to fetch »): not sent, said as before
    api.moveJob.mockRejectedValue(new TypeError('Failed to fetch'));
    await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: false });
    expect(ui.toast.mock.calls.at(-1)?.[0]).toMatch(/^Pas de réseau/);
  });
});

describe('the one question (A2)', () => {
  it('nobody late, from the grid: the confirm with true words, then the move to that very minute on that truck', async () => {
    exact.exactPreview.mockResolvedValue(answer());
    const far = vi.fn().mockResolvedValue(null);
    const d = await moveAt({ job: julie(), day: DAY, truck: 't1', at: 780, confirm: true, sms: true, far });
    expect(exact.exactPreview).toHaveBeenCalledWith('j1', DAY, 't1', 780);
    expect(ui.ask).toHaveBeenCalledTimes(1);
    expect(asked().title).toMatch(/^Déplacer la job de Julie : .* à 13 h \?$/);
    expect(asked().text).toBe('Dit au client : entre 12 h et 16 h. Les autres arrêts gardent leur heure.\nUn texto avertira Julie du changement.');
    expect(far).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual(['j1', DAY, 'day', 't1', { start: 720, flex: false, at: 780, lateOk: [] }]);
    expect(d).toMatchObject({ kind: 'moved', at: 780, late: [], real: null });
  });
  it('nobody late, from a sheet: its tap was the choice, no second question', async () => {
    exact.exactPreview.mockResolvedValue(answer());
    await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: false });
    expect(ui.ask).not.toHaveBeenCalled();
    expect(api.moveJob).toHaveBeenCalledTimes(1);
  });
  it('a stop arriving later inside its window is said (« gardent leur heure » would not be true)', async () => {
    exact.exactPreview.mockResolvedValue(answer({ stops: [stop({ id: 'j1', etaAfter: 780 }), stop({ id: 'b', etaBefore: 840, etaAfter: 860, delay: 20, winStart: 780, winEnd: 1020 })] }));
    await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: false });
    expect(asked().text).toBe('Dit au client : entre 12 h et 16 h.\nCet arrêt arrive un peu plus tard, toujours dans sa plage :\nBob : vers 14 h 20 au lieu de 14 h.');
  });
  it('somebody late: who and by how much; « Déplacer quand même » sends them as accepted, « Choisir une autre heure » moves nothing', async () => {
    const carla = stop({ id: 'c', etaBefore: 900, etaAfter: 1000, delay: 100, winStart: 720, winEnd: 960, late: true, lateMin: 40 });
    exact.exactPreview.mockResolvedValue(answer({ stops: [stop({ id: 'j1', etaAfter: 780 }), carla] }));
    ui.ask.mockResolvedValueOnce(false);
    expect((await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: true })).kind).toBe('stopped');
    expect(asked().title).toBe('Déplacer Julie à 13 h met Carla en retard');
    expect(asked().text.split('\n')[0]).toBe('Carla : vers 16 h 40, 40 min après sa plage (12 h à 16 h).');
    expect([asked().ok, asked().cancel, asked().danger]).toEqual(['Déplacer quand même', 'Choisir une autre heure', true]);
    expect(api.moveJob).not.toHaveBeenCalled();
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, exact: true, stops: [{ id: 'j1', eta_after: 780 }, { id: 'c', eta_after: 1000, late: true, late_min: 40 }] } });
    const d = await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: true });
    expect(api.moveJob).toHaveBeenCalledTimes(1);
    expect(sent()[4]).toMatchObject({ at: 780, lateOk: ['c'] });
    // A5: the late customer is named in the message (to call them); the app texts them nothing
    expect(d.kind === 'moved' && doneWords(d, DAY)).toMatch(/à 13 h\. Avertis Carla : servi après sa plage\.$/);
  });
  it('the late question names the moved appointment and its time, and whose window the « Dit à … » line is (review L2)', async () => {
    const carla = stop({ id: 'c', etaBefore: 900, etaAfter: 1000, delay: 100, winStart: 720, winEnd: 960, late: true, lateMin: 40 });
    exact.exactPreview.mockResolvedValue(answer({ stops: [stop({ id: 'j1', etaAfter: 780 }), carla] }));
    ui.ask.mockResolvedValue(false);
    await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: true });
    expect(asked().title).toBe('Déplacer Julie à 13 h met Carla en retard');
    expect(asked().text).toBe('Carla : vers 16 h 40, 40 min après sa plage (12 h à 16 h).\nDit à Julie : entre 12 h et 16 h.');
  });
  it('the truck cannot be there: the earliest, « Mettre à … » asks again at that minute and moves there', async () => {
    exact.exactPreview.mockResolvedValueOnce(answer({ refused: 'arrive_late', stops: [], earliest: 622, earliestKeep: 700 })).mockResolvedValueOnce(answer({ stops: [stop({ id: 'j1', etaAfter: 622 })] }));
    const onAt = vi.fn();
    await moveAt({ job: julie(), day: DAY, truck: null, at: 600, confirm: true, onAt });
    expect(asked().title).toBe('Pas possible à 10 h');
    expect(asked().text).toBe('Le camion ne peut pas être chez Julie à 10 h : au plus tôt 10 h 22.\nÀ 11 h 40, aucun autre arrêt ne change d’heure.');
    expect([asked().ok, asked().cancel]).toEqual(['Mettre à 10 h 22', 'Choisir une autre heure']);
    expect(onAt).toHaveBeenCalledWith(622);
    expect(exact.exactPreview).toHaveBeenLastCalledWith('j1', DAY, null, 622);
    // that minute was the answer: no second confirm
    expect(ui.ask).toHaveBeenCalledTimes(1);
    expect(sent()[4]).toMatchObject({ start: 540, at: 622 });
  });
  it('« Mettre à … » from a sheet: the window that minute gives is SAID when it is not the one pointed, with the text (review F5)', async () => {
    // told 12 h – 16 h, planned 13 h 15; the other truck can be there at 14 h at the earliest (window 13 h – 17 h)
    rows.customer.mockImplementation((id: string) => (PEOPLE[id] ? { ...PEOPLE[id], phone: '5145550000' } : undefined));
    exact.exactPreview.mockResolvedValueOnce(answer({ refused: 'arrive_late', stops: [], earliest: 840, earliestKeep: 840 })).mockResolvedValueOnce(answer({ stops: [stop({ id: 'j1', etaAfter: 840 })] }));
    const d = await moveAt({ job: julie({ win_start: 720, win_end: 960, eta_min: 795 }), day: DAY, truck: 't2', at: 795, confirm: false });
    expect(ui.ask).toHaveBeenCalledTimes(1);
    expect(asked().text).toBe('Le camion ne peut pas être chez Julie à 13 h 15 : au plus tôt 14 h.\nÀ 14 h, la plage dite au client devient : entre 13 h et 17 h. Un texto avertira Julie du changement.');
    expect(sent()[4]).toMatchObject({ start: 780, at: 840 });
    expect(d.kind).toBe('moved');
    // the same window (10 h → 10 h 22 inside 9 h – 13 h): nothing more to say, as before
    lang.value = 'en';
    exact.exactPreview.mockResolvedValueOnce(answer({ refused: 'arrive_late', stops: [], earliest: 840, earliestKeep: null })).mockResolvedValueOnce(answer());
    await moveAt({ job: julie({ win_start: 720, win_end: 960, eta_min: 795 }), day: DAY, truck: 't2', at: 795, confirm: false });
    expect(asked(1).text).toBe('The truck can’t be at Julie’s at 1:15 p.m.: 2 p.m. at the earliest.\nAt 2 p.m., the window the customer is told becomes 1 p.m. to 5 p.m. instead. A text will let Julie know about the change.');
    lang.value = 'fr';
  });
  it('the truck cannot be there, thrown with no minute: the refusal’s words, nothing moved', async () => {
    exact.exactPreview.mockRejectedValue({ code: 'P0001', hint: 'arrive_late', message: 'Le camion ne peut pas être là.' });
    expect((await moveAt({ job: julie(), day: DAY, truck: null, at: 600, confirm: true })).kind).toBe('stopped');
    expect(ui.ask).not.toHaveBeenCalled();
    expect(api.moveJob).not.toHaveBeenCalled();
  });
  it('not measured, or no answer: said plainly, « Déplacer quand même » / « Annuler »', async () => {
    exact.exactPreview.mockResolvedValue(answer({ stops: [stop({ id: 'j1', measured: false })] }));
    await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: false });
    expect(asked().text.split('\n')[0]).toBe('Les routes de cette journée ne sont pas toutes mesurées : je ne peux pas encore dire si quelqu’un sera en retard.');
    expect([asked().ok, asked().cancel]).toEqual(['Déplacer quand même', 'Annuler']);
    exact.exactPreview.mockRejectedValue(new Error('boom'));
    ui.ask.mockResolvedValueOnce(false);
    await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: false });
    expect(asked(1).text.split('\n')[0]).toBe('Je n’ai pas pu vérifier l’heure des autres clients.');
    expect(api.moveJob).toHaveBeenCalledTimes(1);
  });
  it('another refusal of the preview (its truck does not work that day, nothing offered): given back with its words, nothing moved', async () => {
    exact.exactPreview.mockResolvedValue(answer({ refused: 'pick_truck', stops: [] }));
    const d = await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: true });
    expect(d.kind).toBe('refused');
    expect(d.kind === 'refused' && errorMessage(d.error)).toMatch(/camion/);
    expect(ui.ask).not.toHaveBeenCalled();
    expect(api.moveJob).not.toHaveBeenCalled();
    // thrown: the same
    exact.exactPreview.mockRejectedValue({ code: 'P0001', hint: 'block_started', message: 'Commencé.' });
    const e = await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: true });
    expect(e.kind === 'refused' && (e.error as { hint: string }).hint).toBe('block_started');
  });
  it('its truck does not work that day, the place came with the vehicle the server offered: that one, SAID, then moved there', async () => {
    exact.exactPreview.mockResolvedValueOnce(answer({ refused: 'pick_truck', stops: [] })).mockResolvedValueOnce(answer());
    const d = await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: false, offered: 't2' });
    expect(exact.exactPreview.mock.calls.map((c) => c[2])).toEqual([null, 't2']);
    // a sheet's tap asks nothing when nobody is late, but a truck changed is never in silence
    expect(ui.ask).toHaveBeenCalledTimes(1);
    expect(asked().text.split('\n')[0]).toBe('Son camion ne travaille pas ce jour-là : la job va sur Voiture.');
    expect(sent()[3]).toBe('t2');
    expect(d.kind).toBe('moved');
  });
  it('« Garde-route » comes after the question, and its « no » moves nothing', async () => {
    exact.exactPreview.mockResolvedValue(answer());
    const far = vi.fn().mockResolvedValue({ title: 'Beaucoup de route ce jour-là', text: '…' });
    ui.ask.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: true, far })).kind).toBe('stopped');
    expect(asked(1).title).toBe('Beaucoup de route ce jour-là');
    expect(api.moveJob).not.toHaveBeenCalled();
  });
});

describe('after the move', () => {
  it('the day changed since the preview (late_changed): looked at again once, asked with the new facts', async () => {
    const carla = stop({ id: 'c', etaAfter: 1000, late: true, lateMin: 40, winStart: 720, winEnd: 960 });
    exact.exactPreview.mockResolvedValueOnce(answer()).mockResolvedValueOnce(answer({ stops: [stop({ id: 'j1', etaAfter: 780 }), carla] }));
    api.moveJob.mockRejectedValueOnce({ code: 'P0001', hint: 'late_changed', message: '…' });
    const d = await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: true });
    expect(exact.exactPreview).toHaveBeenCalledTimes(2);
    expect(asked(1).title).toBe('Déplacer Julie à 13 h met Carla en retard');
    expect(sent(1)[4]).toMatchObject({ lateOk: ['c'] });
    expect(d.kind).toBe('moved');
  });
  it('the day changed again after the second look (late_changed twice): given back, never a third round of questions (review T1 / M3)', async () => {
    exact.exactPreview.mockResolvedValue(answer());
    api.moveJob.mockRejectedValue({ code: 'P0001', hint: 'late_changed', message: 'La journée a changé.' });
    const d = await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: true });
    expect(exact.exactPreview).toHaveBeenCalledTimes(2);
    expect(api.moveJob).toHaveBeenCalledTimes(2);
    expect(d.kind === 'refused' && (d.error as { hint: string }).hint).toBe('late_changed');
  });
  it('another refusal is given back to the caller (the grid opens the windows still possible for its full codes)', async () => {
    exact.exactPreview.mockResolvedValue(answer());
    api.moveJob.mockRejectedValue({ code: 'P0001', hint: 'window_full', message: '…' });
    const d = await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: false });
    expect(d.kind).toBe('refused');
  });
  it('never a silent jump: landed elsewhere (an older server), the message says the real time', async () => {
    exact.exactPreview.mockResolvedValue(answer());
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, changed: false, rows: { jobs: [julie({ eta_min: 800 })] } } });
    const d = await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: false });
    expect(d.kind === 'moved' && doneWords(d, DAY)).toBe('Placé à 13 h 20 : le camion ne pouvait pas être là à 13 h.');
  });
  it('in English too', async () => {
    lang.value = 'en';
    exact.exactPreview.mockResolvedValue(answer({ stops: [stop({ id: 'j1', etaAfter: 780 }), stop({ id: 'c', etaAfter: 1000, late: true, lateMin: 40, winStart: 720, winEnd: 960 })] }));
    await moveAt({ job: julie(), day: DAY, truck: null, at: 780, confirm: true });
    expect(asked().title).toBe('Moving Julie to 1 p.m. makes Carla late');
    expect(asked().text.split('\n')[0]).toBe('Carla: around 4:40 p.m., 40 min after their window (12 p.m. to 4 p.m.).');
    lang.value = 'fr';
  });
});

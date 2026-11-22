/* « C'est envoyé » on the single « send by hand » sheets (Part 28, REARRANGE.md §3.3-5, days F6, code F9, U13): when the
   server's answer to a booking / window / moved text that could not go (texts not connected: `off`; refused: `error`)
   says the hours it told (`told`, `kind`, `job_id`), the agenda's sheet (MessageHost, notify.tsx) and the job screens'
   sheet (TextOutcome.tsx, through texts.ts sendText) offer « C'est envoyé »: tell_mark how 'hand' with those hours, so
   « Envoyer les heures aux clients » never texts him again what was sent from the phone. Without `told`: no such button.
   A new file so notify.test.tsx keeps one owner (code F15). notify and tell_mark pretended. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const api = vi.hoisted(() => ({ notify: vi.fn() }));
const tell = vi.hoisted(() => ({ marks: [] as unknown[][], answer: null as null | Record<string, unknown> }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock('../../data/tell', async (orig) => ({
  ...(await orig<object>()),
  tellMark: async (m: { id: string }[]) => { tell.marks.push(m); return tell.answer ?? { ok: true, marked: m.map((x) => x.id), changed: [], busy: [] }; }
}));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<object>()), refetch: vi.fn(async () => 'updated'), pull: vi.fn(async () => undefined) }));
import { notifyCustomer } from './notify';
import { sendText, outcome } from '../jobs/texts';
import { TextOutcomeHost } from '../jobs/TextOutcome';
import { upsertLocal, clearAll, getRow } from '../../data/store';
import { toasts } from '../../ui/toast';
import { lang } from '../../lib/i18n';
import type { Job } from '../../data/types';

const DAY = '2030-01-15';
const TOLD = { day: DAY, start: 780, end: 1020 };
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const settle = () => act(async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); } });
const click = async (el: HTMLElement | null) => { expect(el).toBeTruthy(); await act(async () => { el!.click(); }); await settle(); };
/** the toast's « Voir le texto » (the agenda's way: the sheet opens from it) */
const showFromToast = async () => { const x = toasts.value.find((t) => t.action); expect(x).toBeTruthy(); await act(async () => { void x!.action!.run(); }); await settle(); };
let box: HTMLElement | null = null;

beforeEach(() => {
  lang.value = 'fr'; api.notify.mockReset(); tell.marks.length = 0; tell.answer = null; toasts.value = []; outcome.value = null;
  upsertLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Roy', phone: '5145550141', sms_ok: true }], { force: true });
  upsertLocal('jobs', [{ id: 'j1', number: 7, customer_id: 'c1', day: DAY, block: 'day', status: 'booked', duration_min: 60, win_start: 780, win_end: 1020, win_flex: false }], { force: true });
});
afterEach(async () => { if (box) { await act(async () => { render(null, box!); }); box.remove(); box = null; } outcome.value = null; clearAll(); });

describe('the agenda’s « texto à envoyer » sheet (notify.tsx)', () => {
  it('texts not connected, the answer says what it told: « C’est envoyé » marks him told by hand, then the sheet closes', async () => {
    api.notify.mockResolvedValue({ ok: false, status: 'off', message: 'Bonjour Julie, votre rendez-vous a changé…', link: 'https://x', phone: '5145550141', told: TOLD, kind: 'moved', job_id: 'j1' });
    await notifyCustomer('moved', 'j1');
    await showFromToast();
    expect(q('sms-sheet')).toBeTruthy();
    await click(q('sms-handed'));
    expect(tell.marks).toEqual([[{ id: 'j1', how: 'hand', kind: 'moved', day: DAY, start: 780, end: 1020 }]]);
    expect(toasts.value.map((x) => x.text)).toContain('Noté : Julie a son heure.');
    expect(q('sms-sheet')).toBeNull();
  });
  it('a text that failed (error) says it too; the hours changed meanwhile: not marked, the sheet stays', async () => {
    api.notify.mockResolvedValue({ ok: false, status: 'error', error: 'Numéro fixe', message: 'Bonjour Julie…', link: null, phone: '5145550141', told: TOLD, kind: 'booking', job_id: 'j1' });
    tell.answer = { ok: true, marked: [], changed: ['j1'], busy: [] };
    await notifyCustomer('booking', 'j1');
    await showFromToast();
    await click(q('sms-handed'));
    expect(tell.marks[0]).toEqual([{ id: 'j1', how: 'hand', kind: 'booking', day: DAY, start: 780, end: 1020 }]);
    expect(toasts.value.map((x) => x.text).join(' ')).toContain('a changé entre-temps');
    expect(q('sms-sheet')).toBeTruthy();
  });
  it('an answer without `told` (an older server, another kind): no « C’est envoyé »', async () => {
    api.notify.mockResolvedValue({ ok: false, status: 'off', message: 'Bonjour Julie…', link: null, phone: '5145550141' });
    await notifyCustomer('moved', 'j1');
    await showFromToast();
    expect(q('sms-sheet')).toBeTruthy();
    expect(q('sms-handed')).toBeNull();
  });
});

describe('the job screens’ « text to send by hand » sheet (TextOutcome.tsx)', () => {
  const withHost = async () => { box = document.createElement('div'); document.body.appendChild(box); await act(async () => { render(<TextOutcomeHost />, box!); }); };
  it('sendText copies told, kind and the job; « C’est envoyé » = tell_mark hand with those hours, then the sheet closes', async () => {
    api.notify.mockResolvedValue({ ok: false, status: 'off', message: 'Bonjour Julie, votre rendez-vous est confirmé…', link: 'https://x', phone: '5145550141', told: TOLD, kind: 'booking', job_id: 'j1' });
    await withHost();
    await sendText('booking', getRow<Job>('jobs', 'j1')!);
    await settle();
    expect(outcome.value).toMatchObject({ status: 'off', told: TOLD, kind: 'booking', jobId: 'j1' });
    await click(q('text-outcome-handed'));
    expect(tell.marks).toEqual([[{ id: 'j1', how: 'hand', kind: 'booking', day: DAY, start: 780, end: 1020 }]]);
    expect(outcome.value).toBeNull();
  });
  it('no `told` in the answer: the sheet as before, no « C’est envoyé »', async () => {
    api.notify.mockResolvedValue({ ok: false, status: 'off', message: 'Bonjour Julie…', link: null, phone: '5145550141' });
    await withHost();
    await sendText('moved', getRow<Job>('jobs', 'j1')!);
    await settle();
    expect(q('text-outcome')).toBeTruthy();
    expect(q('text-outcome-handed')).toBeNull();
    expect(outcome.value?.told).toBeUndefined();
  });
});

describe('« already »: nothing new to tell him is said as such, never « déjà envoyé » (review R0)', () => {
  it('why « told » (what he was told still holds): « Pas de texto : l’heure qu’on a dite à Julie tient toujours… »; why « busy » or none: as before', async () => {
    api.notify.mockResolvedValue({ ok: true, status: 'already', why: 'told' });
    await notifyCustomer('moved', 'j1');
    expect(toasts.value.map((x) => x.text)).toEqual(['Pas de texto : l’heure qu’on a dite à Julie tient toujours, rien de nouveau à lui dire']);
    toasts.value = [];
    await sendText('moved', getRow<Job>('jobs', 'j1')!);
    await settle();
    expect(toasts.value.map((x) => x.text)).toEqual(['Pas de texto : l’heure qu’on a dite à Julie tient toujours, rien de nouveau à lui dire.']);
    toasts.value = [];
    api.notify.mockResolvedValue({ ok: true, status: 'already', why: 'busy' });
    await notifyCustomer('moved', 'j1');
    expect(toasts.value.map((x) => x.text)).toEqual(['Le texto avait déjà été envoyé']);
  });
});

/* The tracking page against a pretend public_track: the way back to the appointment, and the card on a dark phone. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { TrackAnswer } from '../api';

let answer: () => TrackAnswer = () => ({ status: 'not_found' });
vi.mock('../api', async (orig) => {
  const real = await orig<typeof import('../api')>();
  return { ...real, callTrack: async () => answer() };
});
import { TrackPage } from './TrackPage';
import { rememberAppointment } from '../link';
import { localDayOf } from '../format';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => [...box.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const wait = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const arrived = (o: Partial<TrackAnswer> = {}): TrackAnswer => ({ status: 'arrived', garage: { name: 'Garage', phone: '438 901-6606' }, mechanic: 'Adam', lang: 'fr', ended_at: new Date().toISOString(), ...o });
async function open(token = 'TRIP-token-123456') {
  await act(async () => { render(<TrackPage token={token} linkLang={null} onLang={() => undefined} />, box); });
  await wait(); await wait();
}
beforeEach(() => { localStorage.clear(); });
afterEach(() => act(() => render(null, box)));

describe('« Voir mon rendez-vous » (client-page-11)', () => {
  it('points to today’s appointment opened on this phone, in the page’s language', async () => {
    rememberAppointment('APPT-today-token', localDayOf(Date.now()));
    answer = () => arrived();
    await open();
    expect(q('track-see-job')[0].getAttribute('href')).toBe('#t=APPT-today-token&l=fr');
  });
  it('is not offered for last month’s appointment', async () => {
    rememberAppointment('APPT-old-token', '2026-10-01', Date.now() - 86400000);
    answer = () => arrived();
    await open();
    expect(q('track-see-job')).toHaveLength(0);
  });
  it('is not offered on the way back to the Centrale (no appointment behind it)', async () => {
    rememberAppointment('APPT-today-token', localDayOf(Date.now()));
    answer = () => arrived({ kind: 'return', dest_label: 'Centrale' });
    await open();
    expect(q('track-see-job')).toHaveLength(0);
  });
});

describe('the tracking card on a dark phone (client-page-13)', () => {
  it('a note inside the white card takes the card’s light ground and dark ink', () => {
    const css = readFileSync(resolve(__dirname, '../client.css'), 'utf8');
    const rule = css.match(/\.cl-uber-card \.cl-note\s*\{([^}]*)\}/);
    expect(rule, 'a rule for the note inside the card').toBeTruthy();
    expect(rule![1]).toMatch(/--solid:\s*#FFFFFF/i);
    expect(rule![1]).toMatch(/color:\s*#111/);
  });
});

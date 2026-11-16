/* The month's numbers on screen: « n autres prévues » only for the month in progress, and « À recevoir » a link only
   for whoever may open the invoices. */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Numbers } from './Numbers';
import { normalizeDashboard } from './kpis';
import { access } from '../../data/auth';
import { replaceLocal } from '../../data/store';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';

const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => { act(() => render(null, box)); access.value = null; });

const who = (rights: Record<string, boolean>): Access => ({ id: 'u1', full_name: 'T', short_name: 'T', email: null, phone: null, roles: ['office'], owner: false, lang: 'fr', prefs: {}, color: null,
  rights, trucks: [], card_online: false, texts_online: false } as unknown as Access);
const d = (month: string) => normalizeDashboard({ revenue_cents: 100000, jobs_done: 3, jobs_booked: 2, receivable_cents: 5000, receivable_count: 1 }, month);
const draw = (month: string, now: string) => act(() => render(<Numbers d={d(month)} month={month} now={now} l="fr" sameYear onGoal={() => undefined} />, box));
const text = (id: string) => box.querySelector(`[data-testid="${id}"]`)?.textContent || '';

describe('the month’s numbers', () => {
  it('« autres prévues ce mois-ci » for the month in progress, never for a month already over', async () => {
    lang.value = 'fr';
    replaceLocal('settings', []);
    access.value = who({ money: true, invoices: true });
    await draw('2026-11-01', '2026-11-16');
    expect(text('kpi-jobs')).toMatch(/2 autres prévues ce mois-ci/);
    await draw('2026-10-01', '2026-11-16');
    expect(text('kpi-jobs')).not.toMatch(/prévue/);
  });
  it('« À recevoir » opens the invoices only for whoever may open them', async () => {
    access.value = who({ money: true, invoices: true });
    await draw('2026-11-01', '2026-11-16');
    expect(box.querySelector('[data-testid="kpi-receivable"] a[href="#/invoices"]')).not.toBeNull();
    access.value = who({ money: true });
    await draw('2026-11-01', '2026-11-16');
    expect(box.querySelector('[data-testid="kpi-receivable"] a')).toBeNull();
    expect(text('kpi-receivable')).toMatch(/50,00/);
  });
});

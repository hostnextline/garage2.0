/* « Questions de l'équipe »: without signal it says so (no grey bars for ever), and a quick change of person never shows
   another person's questions (comms-guide-16). */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { TeamLog, type LogPage, type Question } from './TeamLog';

const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => act(() => render(null, box)));
const q = (id: string, staff: string, text: string): Question => ({ id, staff_id: staff, question: text, answer: 'ok', error: null, created_at: '2026-11-17T15:00:00Z' });
const tick = (ms = 0) => act(() => new Promise((r) => setTimeout(r, ms)));

describe('« Questions de l’équipe »', () => {
  it('no signal: a message and « Réessayer », not a skeleton for ever', async () => {
    let calls = 0;
    const read = async (): Promise<LogPage> => (++calls === 1 ? { ok: false, error: 'Pas de réseau' } : { ok: true, questions: [q('1', 's', 'Quoi apporter ?')] });
    await act(() => render(<TeamLog read={read} />, box));
    await tick();
    expect(box.querySelector('.skel')).toBeNull();
    expect(box.textContent).toContain('Pas de réseau');
    const retry = [...box.querySelectorAll('button')].find((b) => /Réessayer|Try again/.test(b.textContent || ''))!;
    await act(() => { retry.click(); });
    await tick();
    expect(box.querySelectorAll('[data-testid="hermes-team-row"]')).toHaveLength(1);
  });
  it('the slower answer of an earlier choice is dropped', async () => {
    const read = (who: string): Promise<LogPage> => new Promise((r) => setTimeout(() => r({ ok: true, questions: [q(who || 'all', who, `question de ${who || 'tous'}`)] }), who ? 5 : 40));
    await act(() => render(<TeamLog read={read} />, box));
    const sel = box.querySelector('select')!;
    const opt = document.createElement('option'); opt.value = 'adam'; sel.appendChild(opt);
    await act(() => { sel.value = 'adam'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    await tick(60);
    const rows = [...box.querySelectorAll('[data-testid="hermes-team-row"]')].map((r) => r.textContent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('question de adam');
  });
});

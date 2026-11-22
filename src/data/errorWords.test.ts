/* The words of a refusal (lib/errors.ts errorMessage): those of the operation that refused, the « journée » ones while the
   garage books by arrival windows, then the code's own (R144, i18n-04). */
import { describe, it, expect, beforeEach } from 'vitest';
import { errorMessage, AppError, setDayMode, fromSource } from '../lib/errors';
import { lang, t } from '../lib/i18n';

describe('the words of a code depend on who refused it, and on the way the garage books (R144, i18n-04)', () => {
  beforeEach(() => { lang.value = 'en'; setDayMode(false); });
  it('English: « empty » from the conversation is not « empty » from invoice_finish', () => {
    const fromText = errorMessage({ code: 'P0001', hint: 'empty', message: 'Écris le message.', at: 'conversation' });
    const fromInvoice = errorMessage({ code: 'P0001', hint: 'empty', message: 'La facture est vide.', at: 'invoice_finish' });
    expect(fromText).toBe(t('errors.at.conversation.empty'));
    expect(fromInvoice).toBe(t('errors.empty'));
    expect(fromText).not.toBe(fromInvoice);
  });
  it('a server function\'s own answer: its code read in its group (`code`, not `hint`)', () => {
    expect(errorMessage({ ok: false, code: 'exists', error: 'Déjà un compte', at: 'team' })).toBe(t('errors.at.team.exists'));
  });
  it('while the garage books by arrival windows, the block codes say « day »; the operation\'s own words still come first', () => {
    const full = { code: 'P0001', hint: 'block_full', message: 'Ce bloc est complet.' };
    expect(errorMessage(full)).toBe(t('errors.block_full'));
    setDayMode(true);
    expect(errorMessage(full)).toBe(t('errors.day.block_full'));
    expect(errorMessage({ ...full, at: 'set_job_duration' })).toBe(t('errors.at.set_job_duration.block_full'));
    setDayMode(false);
    expect(errorMessage(full)).toBe(t('errors.block_full'));
  });
  it('a code named like a group is never looked up as words (no « undefined »)', () => {
    for (const code of ['at', 'day']) {
      const m = errorMessage({ code: 'P0001', hint: code, message: 'Phrase du serveur' });
      expect(m).not.toMatch(/undefined/);
      expect(m).toBe('Phrase du serveur');
    }
  });
  it('a server function that says an outside service is slow (504, code timeout) → « un service extérieur »; the app\'s own time limit → no signal', () => {
    expect(errorMessage({ ok: false, code: 'timeout', error: 'NHTSA ne répond pas', at: 'vin' })).toBe(t('errors.timeout'));
    expect(errorMessage(new AppError('network', 'timeout', 'timeout', { code: 'timeout' }))).toBe(t('common.networkError'));
    expect(errorMessage(Object.assign(new Error('timeout'), { code: 'timeout' }))).toBe(t('common.networkError'));
  });
  it('French still shows the server\'s own sentence', () => {
    lang.value = 'fr';
    expect(errorMessage({ code: 'P0001', hint: 'empty', message: 'Écris le message.', at: 'conversation' })).toBe('Écris le message.');
  });
  it('the source goes only on refusals, never on no signal', () => {
    expect(fromSource(new AppError('refusal', 'rule', 'x', { hint: 'empty' }), 'conversation').at).toBe('conversation');
    expect(fromSource(new AppError('network', 'timeout', 'x', { code: 'timeout' }), 'vin').at).toBeUndefined();
    expect(fromSource(new AppError('refusal', 'rule', 'x', { at: 'book_job' }), 'other').at).toBe('book_job');
  });
});

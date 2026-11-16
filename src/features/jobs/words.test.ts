import { describe, it, expect } from 'vitest';
import { jobs as fr } from '../../i18n/fr/jobs';
import { jobs as en } from '../../i18n/en/jobs';

describe('the texts of a job have a word for every kind and status the server writes (i18n-05)', () => {
  // supabase/functions/notify (kinds, « window » for a flexible booking's window), messages.status default 'queued'
  const kinds = ['booking', 'moved', 'en_route', 'extras', 'invoice', 'payment_reminder', 'reminder', 'arrived', 'estimate_signed', 'extras_answer', 'return_trip', 'window'];
  const statuses = ['sent', 'failed', 'skipped', 'queued'];
  it('in French and in English', () => {
    for (const d of [fr, en]) {
      for (const k of kinds) expect(d.text.kinds[k as keyof typeof d.text.kinds], k).toBeTruthy();
      for (const s of statuses) expect(d.text.status[s as keyof typeof d.text.status], s).toBeTruthy();
    }
  });
});

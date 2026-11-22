/* « Les étapes d'une job » on the guide follows the red button (comms-guide-22: the NIV step was missing). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOB_STEPS } from './GuideScreen';
import { guide as fr } from '../../i18n/fr/guide';
import { guide as en } from '../../i18n/en/guide';

describe('the steps of a job on the guide', () => {
  it('are the red button’s steps, in its order, the VIN before the signature', () => {
    const kinds = readFileSync(join(__dirname, '..', '..', 'domain', 'jobs', 'steps.ts'), 'utf8');
    const order = ['leave', 'arrive', 'vin', 'waiver', 'invoice', 'pay', 'finish'];
    for (const k of JOB_STEPS) expect(kinds, k).toContain(`kind: '${k}'`);
    expect([...JOB_STEPS]).toEqual(order);
  });
  it('each step has its words in French and English', () => {
    for (const k of JOB_STEPS) {
      expect(fr.jobSteps[k].title, k).toBeTruthy();
      expect(en.jobSteps[k].text, k).toBeTruthy();
    }
  });
});

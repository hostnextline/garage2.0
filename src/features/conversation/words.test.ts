import { describe, it, expect } from 'vitest';
import { conversation as fr } from '../../i18n/fr/conversation';
import { conversation as en } from '../../i18n/en/conversation';

describe('« Conversation »: the words', () => {
  it('every word exists in French and English', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    expect(Object.keys(en.status).sort()).toEqual(Object.keys(fr.status).sort());
  });
});

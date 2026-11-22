import { describe, it, expect } from 'vitest';
import { viewOf, patchOf, flipSwitch, switchOn, textOf, textKey } from './textsModel';
import { changesOf } from './draft';
import { DEFAULT_TEXTS, shownKinds } from './messages';

const stored = { on: { reminder: true, booking: true }, fr: { booking: 'Bonjour {prenom} !' }, en: {} };

describe('Textos: a save writes only what was changed (settings-team-21a)', () => {
  it('one switch flipped: only that switch is written, no text is frozen into the settings', () => {
    const kinds = shownKinds(false);
    const v = viewOf(stored, kinds);
    const next = flipSwitch(v, 'moved');
    const m = patchOf(changesOf(v, next), stored);
    expect(m.on).toEqual({ reminder: true, booking: true, moved: false });
    expect(m.fr).toEqual({ booking: 'Bonjour {prenom} !' });
    expect(m.en).toEqual({});
  });
  it('a stored « Rappel la veille » switch is kept although the row is no longer shown', () => {
    const v = viewOf(stored, shownKinds(false));
    expect(Object.keys(v).some((k) => k.endsWith('.reminder'))).toBe(false);
    const m = patchOf(changesOf(v, { ...v, [textKey('fr', 'booking')]: '  Salut {prenom}  ' }), stored);
    expect(m.on.reminder).toBe(true);
    expect(m.fr.booking).toBe('Salut {prenom}');
  });
  it('a text never set reads the starting text; « en route » without time follows the « en route » switch', () => {
    const v = viewOf(stored, shownKinds(false));
    expect(textOf(v, 'en', 'booking')).toBe(DEFAULT_TEXTS.en.booking);
    expect(switchOn(flipSwitch(v, 'en_route_no_eta'), 'en_route')).toBe(false);
  });
});

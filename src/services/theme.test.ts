import { describe, it, expect } from 'vitest';
import { resolveLook, type Look } from './theme';

const L = (theme: Look['theme'], mode: Look['mode'] = 'auto'): Look => ({ theme, mode, glass: 'auto' });

describe('the look shown', () => {
  it('my own choice wins', () => {
    expect(resolveLook({ mine: L('or'), signedIn: true, teamKnown: true, team: L('saphir'), device: L('his') })).toEqual(L('or'));
  });
  it('signed in, the settings not read yet: the look kept on the phone, not the default (old logic flashed H.I.S and stored it)', () => {
    expect(resolveLook({ mine: null, signedIn: true, teamKnown: false, team: L('his'), device: L('saphir') })).toEqual(L('saphir'));
  });
  it('signed in with the settings read: the team’s look; signed out: the phone’s, else H.I.S', () => {
    expect(resolveLook({ mine: null, signedIn: true, teamKnown: true, team: L('emeraude'), device: L('saphir') })).toEqual(L('emeraude'));
    expect(resolveLook({ mine: null, signedIn: false, teamKnown: true, team: L('emeraude'), device: L('saphir') })).toEqual(L('saphir'));
    expect(resolveLook({ mine: null, signedIn: false, teamKnown: false, team: L('emeraude'), device: null })).toEqual(L('his'));
  });
});

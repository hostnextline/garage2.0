import { describe, it, expect } from 'vitest';
import { pickDay } from './select';

const who = (o: Partial<Parameters<typeof pickDay>[0]>) => ({ owner: false, office: false, mechanic: false, treasurer: false, agenda: false, ...o });

describe('« Vue propriétaire » / « Vue mécano »', () => {
  it('an owner who is also a mechanic sees the day they picked', () => {
    expect(pickDay(who({ owner: true, mechanic: true }), 'office')).toBe('office');
    expect(pickDay(who({ owner: true, mechanic: true }), 'mechanic')).toBe('mechanic');
    expect(pickDay(who({ office: true, mechanic: true }), 'mechanic')).toBe('mechanic');
  });
  it('an owner who is not a mechanic keeps the team day, whatever the phone remembers', () => {
    expect(pickDay(who({ owner: true }), 'mechanic')).toBe('office');
    expect(pickDay(who({ office: true }), 'mechanic')).toBe('office');
  });
  it('the others are unchanged', () => {
    expect(pickDay(who({ mechanic: true }), 'office')).toBe('mechanic');
    expect(pickDay(who({ treasurer: true }), 'office')).toBe('treasurer');
    expect(pickDay(who({ agenda: true }), 'office')).toBe('office');
    expect(pickDay(who({}), 'office')).toBe('treasurer');
  });
});

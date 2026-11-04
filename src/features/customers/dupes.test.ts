import { describe, it, expect } from 'vitest';
import { phoneOwners, phoneKey } from './dupes';

const people = [
  { id: 'c-julie', phone: '514 555-0141', phone_digits: null, deleted_at: null, name: 'Julie' },
  { id: 'c-marc', phone: '(438) 555-0177', phone_digits: '4385550177', deleted_at: null, name: 'Marc' },
  { id: 'c-old', phone: '514 555-0188', phone_digits: '5145550188', deleted_at: '2026-01-01T00:00:00Z', name: 'Old' },
  { id: 'c-none', phone: null, phone_digits: null, deleted_at: null, name: 'Nobody' }
];

describe('same phone on two files', () => {
  it('finds the other customer whatever the format', () => {
    expect(phoneOwners('5145550141', people).map((c) => c.id)).toEqual(['c-julie']);
    expect(phoneOwners('+1 (514) 555-0141', people).map((c) => c.id)).toEqual(['c-julie']);
    expect(phoneOwners('1-438-555-0177', people).map((c) => c.id)).toEqual(['c-marc']);
  });
  it('leaves out the customer being edited and deleted files', () => {
    expect(phoneOwners('514 555-0141', people, 'c-julie')).toEqual([]);
    expect(phoneOwners('514 555-0188', people)).toEqual([]);
  });
  it('says nothing while the number is incomplete', () => {
    expect(phoneOwners('514 555', people)).toEqual([]);
    expect(phoneOwners('', people)).toEqual([]);
    expect(phoneOwners(null, people)).toEqual([]);
  });
  it('keeps the last 10 digits like the server', () => {
    expect(phoneKey('514 555-0141')).toBe('5145550141');
    expect(phoneKey('011 514 555 0141')).toBe('5145550141');
    expect(phoneKey('555-0141')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { callLength, worthShowing, pendingCount, withTodo, type CallNote } from './notes';

const note = (o: Partial<CallNote>): CallNote => ({ id: 'n', message_id: 'm', phone: null, customer_id: null, dir: 'in', at: null, duration_sec: 120, status: 'done', summary: 's', told: '', todo: '', lang: 'fr', error: null, ...o });

describe('« Notes d’appels »', () => {
  it('says how long a call was', () => {
    expect(callLength(45)).toBe('45 s');
    expect(callLength(95)).toBe('2 min');
    expect(callLength(240)).toBe('4 min');
    expect(callLength(null)).toBe('');
  });
  it('a missed or very short call is not shown in a file; a note being written is', () => {
    expect(worthShowing({ status: 'done' })).toBe(true);
    expect(worthShowing({ status: 'new' })).toBe(true);
    expect(worthShowing({ status: 'failed' })).toBe(true);
    expect(worthShowing({ status: 'short' })).toBe(false);
    expect(worthShowing({ status: 'no_recording' })).toBe(false);
  });
  it('counts what is still being written and lists what is left to do', () => {
    const list = [note({ id: 'a', todo: 'Rappeler mardi' }), note({ id: 'b', status: 'new', summary: null }), note({ id: 'c', todo: '  ' }), note({ id: 'd', status: 'failed', todo: 'x' })];
    expect(pendingCount(list)).toBe(1);
    expect(withTodo(list).map((n) => n.id)).toEqual(['a']);
  });
});

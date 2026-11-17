import { describe, it, expect, afterEach } from 'vitest';
import { myRoute, setMyRoute } from './prefs';
import * as position from '../../services/position';

afterEach(() => { setMyRoute(null); });

describe('the route this mechanic does (R73)', () => {
  it('is the one signal of services/position: a choice made on « Ma journée » is the route the position is sent for', () => {
    expect(myRoute).toBe(position.myRoute);
    setMyRoute('t2');
    expect(position.myRoute.value).toBe('t2');
    expect(position.refreshMyRoute()).toBe('t2');
  });
  it('keeps the same key on the phone (« his.myRoute »), and « all routes » removes it', () => {
    setMyRoute('t1');
    expect(localStorage.getItem('his.myRoute')).toBe('t1');
    setMyRoute(null);
    expect(localStorage.getItem('his.myRoute')).toBeNull();
    expect(myRoute.value).toBeNull();
  });
  it('a choice changed on the phone (another tab) reaches « Ma journée » too', () => {
    setMyRoute('t1');
    localStorage.setItem('his.myRoute', 't3');
    position.refreshMyRoute();
    expect(myRoute.value).toBe('t3');
  });
});

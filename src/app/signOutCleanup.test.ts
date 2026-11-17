/* « Me déconnecter » forgets what the phone kept of this person (R104): the reports kept on the phone (his.report.*),
   the routes by the streets and the team's maps kept in memory; the push address goes first, then the session. The
   next person who signs in on this phone never sees the last one's. Other keys of the phone stay (language, look). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
vi.mock('../services/push', () => ({ pushOff: async () => { calls.push('pushOff'); } }));
vi.mock('../data/auth', async (orig) => ({ ...(await orig<typeof import('../data/auth')>()), signOut: async () => { calls.push('signOut'); return 'done'; } }));
vi.mock('../data/sync', async (orig) => ({ ...(await orig<typeof import('../data/sync')>()), pendingCount: async () => 0 }));
vi.mock('../shared/map/roads', async (orig) => {
  const real = await orig<typeof import('../shared/map/roads')>();
  return { ...real, forgetRoads: () => { calls.push('forgetRoads'); real.forgetRoads(); } };
});
vi.mock('../shared/map/useTeamMap', async (orig) => {
  const real = await orig<typeof import('../shared/map/useTeamMap')>();
  return { ...real, forgetTeamMaps: () => { calls.push('forgetTeamMaps'); real.forgetTeamMaps(); } };
});
import { registerSignOutCleanup } from './signOutCleanup';
import { signOutNow } from '../shared/app/signOut';

beforeEach(() => { calls.length = 0; localStorage.clear(); registerSignOutCleanup(); registerSignOutCleanup(); });

describe('signing out forgets this person', () => {
  it('push address, then the session, then the routes, the team maps and the reports kept on the phone', async () => {
    localStorage.setItem('his.report.month', '{"rows":[1]}');
    localStorage.setItem('his.report.recon', '{"open":2}');
    localStorage.setItem('his.lang', 'en');
    localStorage.setItem('his.look', 'dark');
    await signOutNow();
    expect(calls.slice(0, 2)).toEqual(['pushOff', 'signOut']);
    expect(calls.filter((c) => c === 'forgetRoads')).toHaveLength(1);
    expect(calls.filter((c) => c === 'forgetTeamMaps')).toHaveLength(1);
    const keys = Object.keys(localStorage);
    expect(keys.filter((k) => k.startsWith('his.report.'))).toEqual([]);
    expect(localStorage.getItem('his.lang')).toBe('en');
    expect(localStorage.getItem('his.look')).toBe('dark');
  });
});

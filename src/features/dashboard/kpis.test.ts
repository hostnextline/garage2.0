import { describe, it, expect } from 'vitest';
import { normalizeDashboard, noShowRate, perKm, goalShare, projection, versusLastMonth, truckShares } from './kpis';

describe('the dashboard numbers', () => {
  it('makes the server answer safe: numbers, lists, the six months in order', () => {
    const d = normalizeDashboard({
      month: '2026-11-01', revenue_cents: '1234567', km: '184.4', goal_cents: 2500000, invoices: 12,
      by_truck: [{ truck_id: 't-v', revenue_cents: 100, invoices: 1 }, { truck_id: null, revenue_cents: 900, invoices: 2 }],
      months: [{ month: '2026-09-01', revenue_cents: 5 }, { month: '2026-11-01', revenue_cents: 1234567 }],
      top_services: [{ name: 'Huile', n: 3 }, { name: '', n: 2 }, { name: 'Pneus', n: 0 }]
    }, '2026-11-04');
    expect(d.revenue_cents).toBe(1234567);
    expect(d.km).toBe(184.4);
    expect(d.jobs_done).toBe(0);
    expect(d.months.map((m) => m.month)).toEqual(['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']);
    expect(d.months.map((m) => m.revenue_cents)).toEqual([0, 0, 0, 5, 0, 1234567]);
    expect(d.by_truck[0].truck_id).toBeNull();          // biggest first
    expect(d.top_services).toEqual([{ name: 'Huile', n: 3 }]);
    expect(normalizeDashboard(null, '2026-11-04').goal_cents).toBeNull();
    expect(normalizeDashboard({ goal_cents: 0 }, '2026-11-04').goal_cents).toBeNull();
  });
  it('no-show rate: no-shows out of done + no-show + cancelled', () => {
    expect(noShowRate({ jobs_done: 18, jobs_no_show: 2, jobs_cancelled: 0 })).toBeCloseTo(0.1);
    expect(noShowRate({ jobs_done: 7, jobs_no_show: 1, jobs_cancelled: 2 })).toBeCloseTo(0.1);
    expect(noShowRate({ jobs_done: 0, jobs_no_show: 0, jobs_cancelled: 0 })).toBeNull();
  });
  it('money per km and km per 100 $', () => {
    expect(perKm(1234500, 184)).toEqual({ centsPerKm: 1234500 / 184, kmPer100: (184 * 10000) / 1234500 });
    expect(perKm(1234500, 0)).toEqual({ centsPerKm: null, kmPer100: null });
    expect(perKm(0, 50)).toEqual({ centsPerKm: 0, kmPer100: null });
    expect(perKm(1000000, 150).kmPer100).toBeCloseTo(1.5);
  });
  it('goal and pace of the month in progress', () => {
    expect(goalShare(1250000, 2500000)).toBe(0.5);
    expect(goalShare(1250000, null)).toBeNull();
    expect(projection(400000, '2026-11-01', '2026-11-10')).toBe(1200000);
    expect(projection(400000, '2026-11-01', '2026-11-02')).toBeNull();     // too early to say
    expect(projection(400000, '2026-10-01', '2026-11-10')).toBeNull();     // a closed month
  });
  it('compares with the month before only when the month is closed', () => {
    const months = [{ month: '2026-09-01', revenue_cents: 1000000 }, { month: '2026-10-01', revenue_cents: 1100000 }, { month: '2026-11-01', revenue_cents: 300000 }];
    expect(versusLastMonth({ month: '2026-10-01', revenue_cents: 1100000, months }, '2026-11-04')).toEqual({ prev: 1000000, change: expect.closeTo(0.1) });
    expect(versusLastMonth({ month: '2026-11-01', revenue_cents: 300000, months }, '2026-11-04')).toEqual({ prev: 1100000, change: null });
  });
  it('the share and the average ticket of each truck', () => {
    const s = truckShares([{ truck_id: 'a', revenue_cents: 7500, invoices: 3 }, { truck_id: 'b', revenue_cents: 2500, invoices: 0 }]);
    expect(s[0]).toMatchObject({ share: 0.75, avg: 2500 });
    expect(s[1]).toMatchObject({ share: 0.25, avg: 0 });
  });
});

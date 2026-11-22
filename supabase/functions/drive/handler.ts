// « Vraies routes » (Part 27): the road times the planner counts, measured on the real roads (TomTom with its usual traffic;
// OSRM when TomTom cannot answer) and kept in drive_times. Never a straight line: what nobody could measure stays « not
// measured ». The pairs to measure always come from the database (drive_wanted), NEVER from the caller: a person can only
// say which address and which days. The measuring itself is _shared/roads.ts (also used by « book »).
//   { action: 'warm', point: { lat, lng }, from?: 'YYYY-MM-DD', days?: 1…14, only?: 'point' }
//       any member of the team. The address's usual-hours trips first (two requests: the address → the places of those
//       days, the places → the address), stored at once; with only: 'point' it stops there (a screen is waiting); without
//       it, it goes on with what else those days miss (other trips, then the rush times), within its brakes.
//       The address must be within 150 km of « Départ des camions » (far). Without `point`: the trips of those days, for
//       the owner and the office only (the sweep's right: a mechanic gets no_position; the app always sends an address).
//   { action: 'sweep' }
//       the owner or the office (« Mesurer maintenant », called again while `more` is true), or the nightly job of the
//       backup repository (GitHub's signed ticket in « x-github-oidc », as for « recon »; it may ask nothing else): every
//       trip missing over the coming horizon_days, round after round.
//     → warm / sweep: { ok, ready, left, left0, stored, planned, kept, late, no_road, tomtom, osrm, spent, more }
//       ready: no usual-hours trip is missing for what was asked (the address's; all of them for a sweep). left / left0:
//       what drive_wanted still lists for that ask (everything / usual hours with no time at all: what the switch waits
//       for). stored / planned / kept / late: drive_store's (the days planned again with the new times). no_road: trips
//       with no road at all (TomTom and OSRM both said so). tomtom: ok | no_key | refused | busy | over_budget | unused;
//       osrm: ok | down | unused. spent: this month's TomTom spend { month, tx, cap }. more: a brake of the call was
//       reached while something measurable is left: call again.
//   { action: 'status' }  any member of the team → { ok, key: the server has TOMTOM_KEY, on, left, left0, month, rows }
// Brakes: 60 warm / sweep an hour a person, 300 an hour for the garage (rate_hit: a person looping on random addresses
// costs TomTom money); the month's TomTom ceiling (booking.roads_month_tx) is drive_spend_add's, before each request.
// (final-fix-server, 2026-11-21) Also: a person's own TomTom allowance for addresses, 30 warms an hour that would ask TomTom
// (`drive:tt:<person>`), then OSRM measures them (money F6, security F7: one phone is slowed: 30 addresses an hour is still about 2 700 transactions an hour, so the month's ceiling is what bounds it); status
// 120 an hour a person (it reads the whole horizon); the nightly ticket 20 sweeps an hour (`drive:night`, money F9). The
// nightly ticket's sweep also deletes the trips nobody drives any more (drive_prune: 30 days old, an end that is no place of
// the coming days; security F2) and names the appointments it made late (`late_jobs`: number, day, block; critic W2).
// Two calls at the same time never measure the same trips: each holds a lease while it measures (rate_limits rows
// `drive:claim:…`, _shared/roads.ts); the second waits for it, then finds them stored (or answers `more` out of time).
// Never the public key (caller(): « signin »).
import { serve, json, body, fail, env } from '../_shared/http.ts';
import { adminDb, caller, secret, type Caller } from '../_shared/db.ts';
import { verifyGithub } from '../_shared/github.ts';
import { measureRoads, warmPoint, pointOf, realDay, tableClaims, LIMITS } from '../_shared/roads.ts';

/** a function of the database as the server (drive_wanted, drive_store, drive_spend_add, roads_state are the server's only) */
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await adminDb().rpc(name, args);
  if (error) throw error;
  return data;
}
/** false when this key asked too often in the window */
async function brake(key: string, windowSec: number, max: number): Promise<boolean> {
  return (await rpc('rate_hit', { p_key: key, p_window_sec: windowSec, p_max: max })) === true;
}

/** a test copy of the server may LOWER the brakes of one call (secrets « drive_limits »: JSON { ms, requests, inFlight }),
    to prove what a call does when it stops early. A value is only ever lowered, never raised: on live such a row could
    only make a call stop sooner */
async function limitsOf(): Promise<Partial<typeof LIMITS>> {
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse((await secret('drive_limits')) || '{}'); } catch { return {}; }
  const out: Partial<typeof LIMITS> = {};
  for (const k of ['ms', 'requests', 'inFlight'] as const) {
    const v = Number(raw?.[k]);
    if (Number.isInteger(v) && v >= 1 && v < LIMITS[k]) out[k] = v;
  }
  return out;
}

export const handler = serve(async (req) => {
  // who is asking, before anything else: the nightly job's GitHub ticket, or a signed-in member of the team
  const ticket = req.headers.get('x-github-oidc');
  let c: Caller | null = null;
  if (ticket) await verifyGithub(ticket);
  else c = await caller(req);
  const b = await body(req);
  const action = String(b.action || '');
  if (action !== 'warm' && action !== 'sweep' && action !== 'status') fail('action', 'Action inconnue.');
  if (!c && action !== 'sweep') fail('not_allowed', 'La tâche de nuit mesure les routes (sweep), rien d’autre.', 403);
  const BUSY = 'Les routes ont été demandées trop souvent. Réessaie dans quelques minutes.';
  // the nightly ticket: 20 sweeps an hour (a replayed ticket, or a workflow run in a loop, never measures without end)
  if (!c && !(await brake('drive:night', 3600, 20))) fail('busy', BUSY, 429);

  if (action === 'status') {
    if (c && !(await brake(`drive:status:${c.id}`, 3600, 120))) fail('busy', BUSY, 429);
    return json({ ok: true, key: env('TOMTOM_KEY') !== '', ...((await rpc('roads_state', {})) || {}) });
  }

  const office = !!c && (c.access.owner || (c.access.roles || []).includes('office'));
  if (action === 'sweep' && c && !office) {
    fail('not_allowed', 'Mesurer toutes les routes est pour le propriétaire et le bureau.', 403);
  }
  // what is asked, checked before it counts in the brakes. A warm names an address: without one it measures every trip of
  // those days, which is the sweep's right (the owner and the office)
  const point = action === 'warm' && b.point != null ? pointOf(b.point) : null;
  if (action === 'warm' && (b.point != null || !office) && !point) fail('no_position', 'Cette adresse n’a pas de position sur la carte.');
  const from = realDay(b.from) ? b.from : null;
  const n = Number(b.days);
  const days = Number.isFinite(n) ? Math.max(1, Math.min(14, Math.floor(n))) : 14;
  // a person: 60 an hour, the garage 300 an hour (the nightly job is one call a night)
  if (c && (!(await brake(`drive:${c.id}`, 3600, 60)) || !(await brake('drive:all', 3600, 300)))) {
    fail('busy', BUSY, 429);
  }
  const limits = await limitsOf();
  const claims = tableClaims(adminDb());
  if (action === 'sweep') {
    // the nightly job first forgets the trips nobody drives any more (never an error that stops the measuring)
    let pruned: number | null = null;
    if (!c) {
      try { pruned = Number(await rpc('drive_prune', { p_days: 30 })) || 0; } catch (e) {
        console.error('drive: prune', String((e as Error)?.message || e).slice(0, 200));
      }
    }
    // every coming day the garage books (drive_wanted keeps it to booking.horizon_days)
    const m = await measureRoads({ point: null, from: null, days: 3650, only: false, rpc, limits, claims });
    if (c) return json(m);
    // the night's summary names the appointments this sweep made late (no customer's name: the summary is GitHub's)
    let lateJobs: { id: string; number: number | null; day: string; block: string }[] = [];
    if (m.late.length) {
      const { data, error } = await adminDb().from('jobs').select('id, number, day, block').in('id', m.late);
      if (error) console.error('drive: late jobs', String(error.message).slice(0, 200));
      lateJobs = ((data || []) as typeof lateJobs).sort((x, y) => (x.day + x.block).localeCompare(y.day + y.block));
    }
    return json({ ...m, pruned, late_jobs: lateJobs });
  }
  // a person's own TomTom allowance for addresses: counted once a call, only by a call that asks TomTom for the address's
  // own trips (a new address, or one with new stops since); past it OSRM measures the address (the moments are still
  // offered, the garage keeps its month)
  let hour: Promise<boolean> | null = null;
  const gate = c ? (): Promise<boolean> => (hour ??= brake(`drive:tt:${c!.id}`, 3600, 30)) : undefined;
  if (point) return json(await warmPoint(rpc, point, from, days, b.only === 'point', limits, { claims, gate }));
  return json(await measureRoads({ point: null, from, days, only: false, rpc, limits, claims }));
});

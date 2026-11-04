/* Sharing the mechanic's position with the office, only between « Commencer ma journée » and « Terminer ma journée »,
   and only while the app is on the screen (a web app cannot follow anyone in the background).
   - The phone reads the position as it changes (watchPosition) and sends it at most once a minute, or sooner when the
     person moved more than 25 m (but never more often than every 10 s: driving would send every second).
   - Each position carries the job the person is driving to (en route) or working at (on site).
   - A refusal of the phone (permission) is explained in plain words; it is tried again when the app comes back.
   The rules are pure functions (tested); startPositionSharing() runs the rest once for the whole app. */
import { signal, effect, untracked } from '@preact/signals';
import type { Job } from '../../data/types';
import { me, preview } from '../../data/auth';
import { openShift, allJobs } from '../../data/select';
import { reportPosition } from '../../data/api';
import { pull } from '../../data/sync';
import { today, duration } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';

/* ---------- the rules (pure) ---------- */
export interface Fix { lat: number; lng: number; accuracy: number | null; heading?: number | null; speed?: number | null; at: number }
export interface Sent { lat: number; lng: number; at: number; jobId: string | null }
export const RULES = {
  /** at least this often while sharing (the office sees « il y a 1 min ») */
  everyMs: 60_000,
  /** sooner when the person moved this much… */
  moveM: 25,
  /** …but never more often than this */
  minGapMs: 10_000,
  /** a reading this vague (cell towers, indoors) never counts as moving: it jumps around */
  maxAccuracyM: 1000,
  /** a reading this old is not where the person is now */
  staleMs: 120_000
};

/** metres between two points (haversine) */
export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const d = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(d)));
}

/** send this reading now? (last: what was sent last; jobId: the job it belongs to now) */
export function shouldSend(last: Sent | null, fix: Fix, jobId: string | null, now: number, r = RULES): boolean {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return false;
  if (now - fix.at > r.staleMs) return false;
  if (!last) return true;
  const gap = now - last.at;
  if (gap < 0 || gap >= r.everyMs) return true;
  if (gap < r.minGapMs) return false;
  if ((jobId ?? null) !== (last.jobId ?? null)) return true;
  if (fix.accuracy != null && fix.accuracy > r.maxAccuracyM) return false;
  return metersBetween(last, fix) >= r.moveM;
}

/** the job a position belongs to: the one the person drives to, else the one they work at (today, their trucks) */
export function currentJobId(jobs: Pick<Job, 'id' | 'status' | 'truck_id' | 'day'>[], trucks: string[], day: string): string | null {
  const mine = jobs.filter((j) => j.day === day && !!j.truck_id && trucks.includes(j.truck_id));
  return (mine.find((j) => j.status === 'en_route') || mine.find((j) => j.status === 'on_site'))?.id ?? null;
}

/** « à l'instant », « il y a 3 min », « il y a 1 h 05 » */
export function agoText(at: number | string | null | undefined, now = Date.now()): string {
  const ms = at == null ? NaN : now - (typeof at === 'string' ? Date.parse(at) : at);
  if (!Number.isFinite(ms) || ms < 60_000) return t('today.ago.now');
  const min = Math.floor(ms / 60_000);
  if (min < 60) return t('today.ago.min', { n: min });
  return t('today.ago.long', { time: duration(min, lang.value) });
}

/* ---------- the sharing (browser) ---------- */
export type ShareStatus = 'off' | 'starting' | 'on' | 'denied' | 'unavailable' | 'unsupported';
/** what the indicator shows: the state, and when the last position reached the office (ms) */
export const sharing = signal<{ status: ShareStatus; sentAt: number | null }>({ status: 'off', sentAt: null });

let started = false;
let watchId: number | null = null;
let beat: ReturnType<typeof setInterval> | null = null;
let lastSent: Sent | null = null;
let lastFix: Fix | null = null;
let lastFailAt = 0;
let busy = false;
let jobNow: string | null = null;
let blocked = false;   // the phone said no: wait for the person (or the app coming back) before asking again
const visible = signal(typeof document === 'undefined' || document.visibilityState !== 'hidden');

const setStatus = (status: ShareStatus) => { if (sharing.value.status !== status) sharing.value = { ...sharing.value, status }; };
const num = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : x);

function readFix(p: GeolocationPosition): Fix {
  const ts = Number(p.timestamp);
  return {
    lat: p.coords.latitude, lng: p.coords.longitude, accuracy: num(p.coords.accuracy), heading: num(p.coords.heading), speed: num(p.coords.speed),
    // some phones give a time from another clock: then « now » is the honest answer
    at: Number.isFinite(ts) && Math.abs(Date.now() - ts) < 86_400_000 ? ts : Date.now()
  };
}

async function maybeSend(fix: Fix) {
  const now = Date.now();
  if (busy || !shouldSend(lastSent, fix, jobNow, now)) return;
  if (lastFailAt && now - lastFailAt < RULES.minGapMs) return;
  busy = true;
  const job = jobNow;
  try {
    const r = await reportPosition(fix.lat, fix.lng, fix.accuracy == null ? null : Math.round(fix.accuracy), fix.heading == null ? null : Math.round(fix.heading),
      fix.speed == null ? null : Math.round(fix.speed * 3.6), job);
    if (r && r.ok) {
      lastSent = { lat: fix.lat, lng: fix.lng, at: now, jobId: job };
      lastFailAt = 0;
      sharing.value = { status: 'on', sentAt: now };
    } else {
      lastFailAt = now;
      // the server closed the day (from another phone, or at night): the device learns it and stops
      if (r && r.reason === 'no_shift') void pull('shifts');
    }
  } catch {
    lastFailAt = now;
  } finally {
    busy = false;
  }
}

function onFix(p: GeolocationPosition) {
  const fix = readFix(p);
  lastFix = fix;
  if (sharing.value.status !== 'on') setStatus('on');
  void maybeSend(fix);
}
function onError(e: GeolocationPositionError) {
  if (e.code === 1) { blocked = true; stop(); setStatus('denied'); return; }
  if (e.code === 2) { setStatus('unavailable'); return; }
  // 3: too slow this time; the watch goes on
}
function heartbeat() {
  // standing still, the phone may stay silent: ask for a fresh reading so the office keeps seeing « il y a 1 min »
  if (!lastSent || Date.now() - lastSent.at < RULES.everyMs) return;
  try { navigator.geolocation.getCurrentPosition(onFix, () => undefined, { maximumAge: 30_000, timeout: 20_000, enableHighAccuracy: false }); } catch { /* the watch goes on */ }
}
function start() {
  if (watchId != null || blocked) return;
  const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
  if (!geo) { setStatus('unsupported'); return; }
  if (sharing.value.status !== 'on') setStatus('starting');
  try {
    watchId = geo.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 60_000 });
  } catch {
    setStatus('unsupported');
    return;
  }
  beat = setInterval(heartbeat, 30_000);
}
function stop() {
  if (watchId != null) { try { navigator.geolocation.clearWatch(watchId); } catch { /* ignore */ } }
  watchId = null;
  if (beat) clearInterval(beat);
  beat = null;
}

/** runs once for the whole app (the screens that need it call it; calling again does nothing) */
export function startPositionSharing() {
  if (started || typeof window === 'undefined' || typeof document === 'undefined') return;
  started = true;
  document.addEventListener('visibilitychange', () => {
    const v = document.visibilityState !== 'hidden';
    if (v && !visible.value) blocked = false;   // back from the phone's settings: ask again
    visible.value = v;
  });
  // the phone's own answer changed (allowed in its settings): start again without a reload
  try {
    void navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then((st) => {
      st.addEventListener('change', () => { if (st.state !== 'denied') retryPosition(); });
    }, () => undefined);
  } catch { /* old phones */ }
  effect(() => {
    const a = me.value;
    const shift = a ? openShift(a.id) : undefined;
    const on = !!a && !!shift && !preview.value && visible.value;
    const job = a ? currentJobId(allJobs.value, a.trucks || [], today()) : null;
    untracked(() => {
      const changed = job !== jobNow;
      jobNow = job;
      if (on) {
        start();
        // « Je pars », « Je suis arrivé »: the office sees the new job without waiting for the next minute
        if (changed && lastFix) void maybeSend(lastFix);
      } else {
        stop();
        if (!shift) { lastSent = null; if (sharing.value.status !== 'unsupported') sharing.value = { status: 'off', sentAt: null }; }
      }
    });
  });
}
/** « Réessayer » after a refusal of the phone */
export function retryPosition() {
  blocked = false;
  if (sharing.value.status === 'denied') setStatus('starting');
  stop();
  const a = me.value;
  if (a && openShift(a.id) && visible.value && !preview.value) start();
}

/** the position now, if the phone gives it quickly (for « Je pars »: the arrival time is worked out from it) */
export function quickPosition(ms = 3500): Promise<{ lat: number; lng: number } | undefined> {
  if (lastFix && Date.now() - lastFix.at < 60_000) return Promise.resolve({ lat: lastFix.lat, lng: lastFix.lng });
  const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
  if (!geo || blocked) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let done = false;
    const end = (v: { lat: number; lng: number } | undefined) => { if (!done) { done = true; clearTimeout(tm); resolve(v); } };
    const tm = setTimeout(() => end(undefined), ms);
    try {
      geo.getCurrentPosition((p) => { const f = readFix(p); lastFix = f; end({ lat: f.lat, lng: f.lng }); }, () => end(undefined),
        { maximumAge: 60_000, timeout: ms, enableHighAccuracy: false });
    } catch { end(undefined); }
  });
}

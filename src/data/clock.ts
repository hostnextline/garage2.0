/* Time as the server writes it. Postgres stamps rows in microseconds and trims trailing zeros, so string order and
   Date.parse (milliseconds) both get two stamps of the same millisecond wrong; `tsMicros` reads them exactly.
   The server's clock is estimated from the stamps it puts on our own writes: the pull's safety window and the
   visibility check use it, so a phone set to the wrong hour behaves like the others. Nothing is ever ordered by
   the phone's clock. */

const TS = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?\d*\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/** exact microseconds since 1970 of a Postgres / PostgREST / JavaScript timestamp; NaN when it cannot be read */
export function tsMicros(s: string | null | undefined): number {
  const m = TS.exec(String(s ?? '').trim());
  if (!m) return NaN;
  const frac = Number((m[7] || '').padEnd(6, '0'));
  let off = 0;
  if (m[8] && m[8] !== 'Z') {
    const z = /^([+-])(\d{2})(?::?(\d{2}))?$/.exec(m[8])!;
    off = (z[1] === '-' ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3] || 0));
  }
  // under 2^53 until the year 2255
  return (Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 - off * 60) * 1e6 + frac;
}

/** < 0 when a is earlier than b; a stamp that cannot be read counts as the oldest */
export function cmpTs(a: string | null | undefined, b: string | null | undefined): number {
  const x = tsMicros(a), y = tsMicros(b);
  return (Number.isNaN(x) ? -Infinity : x) - (Number.isNaN(y) ? -Infinity : y) || 0;
}

/** a promise that fails with « timeout » when it takes longer than `ms` (the work itself is not stopped: requests
    use client.ts `ask`, which really cancels them) */
export function withLimit<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((res, rej) => {
    const tm = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout', name: 'TimeoutError' })), ms);
    Promise.resolve(p).then((v) => { clearTimeout(tm); res(v); }, (e) => { clearTimeout(tm); rej(e); });
  });
}

/* ---------- the server's clock, estimated ---------- */
let offset = 0;
let bestRtt = Infinity;
let bestAt = 0;

/** a stamp the server wrote while we waited for its answer: keeps the estimate of the shortest round trip */
export function sampleServerTime(serverStamp: string | null | undefined, sentAt: number, receivedAt: number) {
  const us = tsMicros(serverStamp);
  if (Number.isNaN(us)) return;
  const rtt = receivedAt - sentAt;
  // an older sample stops counting after 10 minutes (the phone may have slept, its clock moved)
  if (rtt > bestRtt && receivedAt - bestAt < 600000) return;
  bestRtt = rtt; bestAt = receivedAt;
  offset = us / 1000 - (sentAt + receivedAt) / 2;
}
/** the server's time now, in ms (the phone's when nothing was sampled yet) */
export function serverNow(): number { return Date.now() + offset; }
/** for tests */
export function resetServerClock() { offset = 0; bestRtt = Infinity; bestAt = 0; }

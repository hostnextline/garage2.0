// Database tests: each test runs inside a transaction that is rolled back at the end (the database is left as it was).
// People are created for the test, then the test "becomes" one of them, exactly like a request from the app.
import pg from '../stack/node_modules/pg/lib/index.js';
import { randomUUID } from 'node:crypto';

export const pool = new pg.Pool({ host: '127.0.0.1', port: 54332, user: 'postgres', database: 'postgres', max: 6 });

export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const h = helpers(c);
    return await fn(h);
  } finally {
    await c.query('rollback').catch(() => {});
    c.release();
  }
}

function helpers(c) {
  const h = {
    c,
    async q(sql, params = []) { return (await c.query(sql, params)).rows; },
    async one(sql, params = []) { return (await c.query(sql, params)).rows[0]; },
    async val(sql, params = []) { const r = (await c.query(sql, params)).rows[0]; return r ? Object.values(r)[0] : undefined; },
    /** a person on the team (auth account + staff row) */
    async person(name, roles, extra = {}) {
      const id = randomUUID();
      await c.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
        values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`, [id, `${id.slice(0, 8)}@test.local`]);
      await c.query(`insert into public.staff (id, full_name, short_name, roles, rights, email) values ($1, $2, $3, $4, $5, $6)`,
        [id, name, extra.short_name ?? name.split(' ')[0], roles, extra.rights ?? {}, `${id.slice(0, 8)}@test.local`]);
      return id;
    },
    /** the following statements run as this person (or as the server itself with null) */
    async as(id) {
      await c.query('reset role');
      if (id) {
        await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: id, role: 'authenticated' }), id]);
        await c.query('set local role authenticated');
      } else {
        await c.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`);
      }
    },
    async truck(name, driver, week) {
      const id = randomUUID();
      await c.query(`insert into public.trucks (id, name, driver_id, active, sort) values ($1, $2, $3, true, 0)`, [id, name, driver ?? null]);
      for (const [dow, ranges] of Object.entries(week || {})) {
        await c.query(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, $3)`, [id, Number(dow), JSON.stringify(ranges)]);
      }
      return id;
    },
    async customer(first, lat, lng, extra = {}) {
      const id = randomUUID();
      await c.query(`insert into public.customers (id, first_name, last_name, phone, lat, lng, address, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, first, extra.last ?? 'Test', extra.phone ?? '5145550000', lat, lng, extra.address ?? '1 rue Test', extra.by ?? null]);
      return id;
    },
    async rpc(name, args) {
      const keys = Object.keys(args);
      const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
      return (await c.query(sql, keys.map((k) => (args[k] !== null && typeof args[k] === 'object' && !(args[k] instanceof Date) ? JSON.stringify(args[k]) : args[k])))).rows[0].r;
    },
    /** runs and returns the database error (or null) — inside a savepoint so the test can go on */
    async fails(fn) {
      await c.query('savepoint t');
      try { await fn(); await c.query('release savepoint t'); return null; }
      catch (e) { await c.query('rollback to savepoint t'); return e; }
    }
  };
  return h;
}
export const uuid = randomUUID;
/** a weekday at least 2 days from now (never "today", so no block has started) */
export async function futureDay(h, dow = 4, minAhead = 2) {
  return h.val(`select d::date::text from generate_series(public.local_today() + $1::int, public.local_today() + 14, interval '1 day') d where extract(dow from d) = $2 limit 1`, [minAhead, dow]);
}

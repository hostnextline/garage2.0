// End-to-end tests of the real app against the local copy of the server (real database, real sign-in, real rules;
// fake GoHighLevel and Stripe). Before: the database is saved; after: it is put back exactly as it was.
const { chromium, devices } = require('playwright');
const { execSync, spawn } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const K = require('../stack/keys.json');
const API = 'http://127.0.0.1:54331';
const APP = 'http://127.0.0.1:4173/';
const OUT = path.join(ROOT, 'tests/out');
const PSQL = 'psql -h 127.0.0.1 -p 54332 -U postgres -q -v ON_ERROR_STOP=1';
mkdirSync(OUT, { recursive: true });

const sql = (q) => execSync(`${PSQL} -At`, { input: q, encoding: 'utf8' }).trim();

/* ---------- the database: saved before, put back after ---------- */
function saveDb() {
  const file = path.join(OUT, 'avant.sql');
  execSync(`pg_dump -h 127.0.0.1 -p 54332 -U postgres --data-only --schema=public --exclude-table=public.local_migrations -f ${file}`);
  writeFileSync(path.join(OUT, 'avant-users.txt'), sql('select coalesce(string_agg(id::text, \',\'), \'\') from auth.users'));
  return file;
}
function restoreDb() {
  const tables = sql(`select string_agg(format('public.%I', tablename), ', ') from pg_tables where schemaname = 'public' and tablename <> 'local_migrations'`);
  const users = require('node:fs').readFileSync(path.join(OUT, 'avant-users.txt'), 'utf8').trim();
  execSync(PSQL, { input: `begin; set session_replication_role = replica; truncate ${tables} cascade; \\i ${path.join(OUT, 'avant.sql')}\n` +
    `delete from auth.users where ${users ? `id not in (${users.split(',').map((u) => `'${u}'`).join(',')})` : 'true'}; commit;`, encoding: 'utf8' });
}
function counts() {
  return sql(`select string_agg(t || '=' || n, ' ' order by t) from (select relname t, n_live_tup n from pg_stat_user_tables where schemaname = 'public') x`);
}
function rowCounts() {
  const tables = sql(`select string_agg(tablename, ' ') from pg_tables where schemaname = 'public' and tablename <> 'local_migrations'`).split(' ');
  return Object.fromEntries(tables.map((t) => [t, Number(sql(`select count(*) from public.${t}`))]));
}

/* ---------- the app, built for the local copy ---------- */
let preview = null;
function buildApp() {
  execSync('npx vite build --outDir tests/out/dist --emptyOutDir', {
    cwd: ROOT, stdio: 'pipe',
    env: { ...process.env, VITE_SUPABASE_URL: API, VITE_SUPABASE_KEY: K.anon, VITE_REALTIME: 'off', VITE_APP_VERSION: 'e2e' }
  });
}
async function startApp() {
  // the app is also opened under its old address (hostnextline.github.io, sent here by the test browser)
  preview = spawn('npx', ['vite', 'preview', '--outDir', 'tests/out/dist', '--port', '4173', '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', detached: true, env: { ...process.env, __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: 'hostnextline.github.io' } });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(APP); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('the app did not start on 4173');
}
function stopApp() { if (preview) { try { process.kill(-preview.pid); } catch { /* gone */ } preview = null; } }

/* ---------- people ---------- */
async function makePerson({ email, password, name, short, roles, lang = 'fr', truck = null }) {
  const r = await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: K.service, authorization: `Bearer ${K.service}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }) });
  const u = await r.json();
  if (!u.id) throw new Error('user: ' + JSON.stringify(u));
  sql(`insert into public.staff (id, full_name, short_name, email, roles, lang) values ('${u.id}', '${name}', '${short}', '${email}', '{${roles.join(',')}}', '${lang}')`);
  if (truck) sql(`update public.trucks set driver_id = '${u.id}' where name = '${truck}'`);
  return u.id;
}
function seed() { execSync(`${PSQL} -f ${path.join(ROOT, 'supabase/seed.sql')}`); }

/* ---------- browsers ---------- */
let browser = null;
async function open({ kind = 'phone', locale = 'fr-CA', scheme = 'light', offline = false } = {}) {
  browser ||= await chromium.launch();
  const base = kind === 'phone' ? { ...devices['iPhone 13'] } : { viewport: { width: 1366, height: 860 } };
  const ctx = await browser.newContext({ ...base, locale, colorScheme: scheme, timezoneId: 'America/Toronto', permissions: ['geolocation'], geolocation: { latitude: 45.5005, longitude: -73.6577 } });
  if (offline) await ctx.setOffline(true);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|tile\.openstreetmap|ERR_/.test(m.text())) page.errors.push(m.text()); });
  return { ctx, page };
}
async function closeAll() { if (browser) { await browser.close(); browser = null; } }
async function signIn(page, email, password) {
  await page.goto(APP);
  await page.getByTestId('login-email').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.getByTestId('login-submit').click();
  await page.getByTestId('app').waitFor({ timeout: 15000 });
}
async function shot(page, name) { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f }); return f; }
const mockLog = async () => (await fetch('http://127.0.0.1:8021/log')).json();
const clearMock = () => fetch('http://127.0.0.1:8021/log/clear', { method: 'POST' });

module.exports = { ROOT, API, APP, OUT, K, sql, saveDb, restoreDb, counts, rowCounts, buildApp, startApp, stopApp, makePerson, seed, open, closeAll, signIn, shot, mockLog, clearMock };

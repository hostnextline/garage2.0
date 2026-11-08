/* The files that deploy the app and the server agree with the code (Part 26):
   - supabase/config.toml names every server function with verify_jwt off (a normal CLI deploy of a function missing
     there would switch the platform's JWT check back on and break the public links and the booking page);
   - the page-security header (ops/vercel/vercel.json) allows exactly the two inline scripts of index.html and
     client.html, by their hash (the build keeps them byte for byte: a changed script needs its new hash here);
   - the functions listed by name in the workflows exist. */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const functions = () => readdirSync(resolve(ROOT, 'supabase/functions')).filter((d) => !d.startsWith('_') && statSync(resolve(ROOT, 'supabase/functions', d)).isDirectory()).sort();

describe('supabase/config.toml', () => {
  it('names every server function, each with verify_jwt = false', () => {
    const toml = read('supabase/config.toml');
    const named = [...toml.matchAll(/^\[functions\.([\w-]+)\]\s*\n\s*verify_jwt\s*=\s*false/gm)].map((m) => m[1]).sort();
    expect(named).toEqual(functions());
  });
});

describe('the page-security header (report-only)', () => {
  const headers = (JSON.parse(read('ops/vercel/vercel.json')) as { headers: { source: string; headers: { key: string; value: string }[] }[] }).headers;
  const csp = headers.find((h) => h.source === '/(.*)')!.headers.find((h) => h.key === 'Content-Security-Policy-Report-Only')!.value;
  const inlineHashes = (html: string) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  it('allows the inline scripts of both pages by their hash, and only those', () => {
    const want = [...inlineHashes(read('index.html')), ...inlineHashes(read('client.html'))];
    expect(want).toHaveLength(2);
    const scriptSrc = /script-src ([^;]+)/.exec(csp)![1];
    const listed = scriptSrc.match(/'sha256-[^']+'/g) || [];
    expect(listed.sort()).toEqual(want.sort());
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });
  it('names the services the pages talk to', () => {
    const connect = /connect-src ([^;]+)/.exec(csp)![1];
    for (const host of ['https://wyxvizxabqgvsiiemvfw.supabase.co', 'wss://wyxvizxabqgvsiiemvfw.supabase.co', 'https://photon.komoot.io', 'https://vpic.nhtsa.dot.gov']) expect(connect).toContain(host);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
  });
});

describe('the workflows', () => {
  it('pin every action to a commit', () => {
    for (const f of readdirSync(resolve(ROOT, '.github/workflows'))) {
      const uses = [...read(`.github/workflows/${f}`).matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
      for (const u of uses) expect(u, `${f}: ${u}`).toMatch(/@[0-9a-f]{40}(\s|$)/);
    }
  });
  it('publish only after the whole suite, and check the server before publishing', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/tests\/db\/\*\.test\.mjs tests\/api\/\*\.test\.mjs/);
    expect(deploy).toMatch(/tests\/e2e\/app\.test\.cjs/);
    expect(deploy).toMatch(/needs:\s*tests/);
    expect(deploy).toMatch(/ops\/pouls\.sh/);
  });
});

// The files of « ops » and of the publishing workflow, read as text: no server needed, runs anywhere
// (node --test ops/tests/fichiers.test.mjs). Each test names the mistake it keeps from coming back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// the repository's root: found from here, so the file may move
let ROOT = new URL('.', import.meta.url).pathname;
while (!existsSync(join(ROOT, 'package.json'))) ROOT = join(ROOT, '..');
const lire = (f) => readFileSync(join(ROOT, f), 'utf8');

test('Vercel: the app itself may use the microphone (the dictation of Hermes), the camera and the position; nobody else', () => {
  const v = JSON.parse(lire('ops/vercel/vercel.json'));
  const tous = v.headers.find((h) => h.source === '/(.*)').headers;
  const pp = tous.find((h) => h.key === 'Permissions-Policy').value.split(',').map((s) => s.trim()).sort();
  assert.deepEqual(pp, ['camera=(self)', 'geolocation=(self)', 'microphone=(self)']);
  // the rest of the file is what it was (same headers, same caches)
  assert.deepEqual(tous.map((h) => h.key), ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Permissions-Policy']);
  assert.equal(v.outputDirectory, 'public');
  assert.deepEqual(v.headers.map((h) => h.source), ['/(.*)', '/assets/(.*)', '/sw.js', '/version.json']);
});

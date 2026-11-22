// @vitest-environment node
/* The architecture test: the layers of src/ (docs/ARCHITECTURE.md, « Folders »), checked at every `npm test`.

   Every .ts / .tsx file under src is read with the TypeScript parser. Each import that names a file of src —
   `import … from`, `export … from`, `import('…')` and the type `import('…').X`, relative or '@/…' — is resolved to that
   file, then checked against the tables just below. A broken rule fails the test with one line per import:
   « file:line → what it imports — the rule » (paths under src). Test files (*.test.ts, *.test.tsx) may import anything:
   their own imports are not checked. CSS and pictures belong to the layer of their folder and follow the same tables.
   So that nothing escapes the check, it also fails on a code file outside the layers, a shared concept with no rank,
   a relative import that names no file, and an `import()` of a computed name. Known breaks go in ALLOWED (below). */
import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/* ———————————————————————————————— The rules ———————————————————————————————— */

type Layer = 'lib' | 'platform' | 'data' | 'domain' | 'ui' | 'services' | 'shared' | 'features' | 'app' | 'client' | 'dev' | 'i18n' | 'root';

/** What a file of each layer may import, bottom to top (lib < platform < data < domain < ui < services < shared <
    features < app; the customer's page and the demo on the side). Any other layer is refused. */
const MAY_IMPORT: Record<Layer, readonly Layer[]> = {
  lib:      ['lib'],
  platform: ['lib', 'platform'],
  data:     ['lib', 'platform', 'data'],
  domain:   ['lib', 'platform', 'data', 'domain'],
  ui:       ['lib', 'platform', 'ui'],                                                 // + data with `import type` (TYPE_ONLY)
  services: ['lib', 'platform', 'data', 'domain', 'services'],
  shared:   ['lib', 'platform', 'data', 'domain', 'ui', 'services', 'shared'],             // another concept: lower rank only
  features: ['lib', 'platform', 'data', 'domain', 'ui', 'services', 'shared', 'features'], // its OWN section only, never app
  app:      ['lib', 'platform', 'data', 'domain', 'ui', 'services', 'shared', 'features', 'app'],
  client:   ['lib', 'platform', 'domain', 'ui', 'shared', 'client'],                   // never data, features, app
  dev:      ['lib', 'platform', 'data', 'domain', 'ui', 'services', 'shared', 'features', 'app', 'client', 'i18n', 'dev'], // anything
  i18n:     ['i18n'],                                                                  // words only (en types itself from fr)
  root:     ['lib', 'platform', 'data', 'domain', 'ui', 'services', 'shared', 'features', 'app']  // main.tsx, test-setup.ts
};

/** Imports that bring only types (`import type`, `export type`, every name marked `type`, `import('…').X`) may also go here. */
const TYPE_ONLY: Partial<Record<Layer, readonly Layer[]>> = { ui: ['data'] };

/** src/shared/<concept>: a concept imports another one only when that one's rank is LOWER (equal is refused). */
const SHARED_RANK: Record<string, number> = {
  sign: 0, look: 0, export: 0, app: 0, places: 1, map: 2, charts: 2, vehicles: 3, customers: 4, stock: 4, moment: 5, jobs: 6, invoices: 7, guide: 8
};

/** src/domain holds the garage's rules and draws nothing: no JSX and none of these packages (`@preact/signals` is fine). */
const DOMAIN_NEVER_IMPORTS = [/^preact(\/|$)/, /^lucide-preact(\/|$)/];

/** The customer's page: no file it reaches from its entry (imports followed, `import()` too, types left out) lives here. */
const CLIENT_ENTRY = 'client/main.tsx';
const CLIENT_NEVER_REACHES: readonly Layer[] = ['data', 'features', 'app'];

/** Nothing imports src/dev but the boot of the team app, with `import()` (the demo, only with ?demo in development). */
const DEV_DOOR = 'main.tsx';

/** The dictionaries (src/i18n) are read by these two files only: t() / tl() for the team app, ct() for the customer's page. */
const DICTIONARY_READERS = ['lib/i18n.ts', 'client/i18n.ts'];

/** The only code files directly in src (layer « root »), besides tests. */
const ROOT_FILES = ['main.tsx', 'test-setup.ts'];

/** Known breaks still in the tree. Each entry names the importing file and what it imports (paths under src; `to` may
    also be a package, 'JSX' or '(folder)'), the package that owns the importing file (wave 1's package map) and why.
    Empty: at step 0 (tag w1-app-base) the tree breaks no rule. An entry that matches no offending import fails the
    test, so the list only shrinks: remove an entry once its package has fixed the import. */
const ALLOWED: readonly Allowed[] = [];

/* ——————————————————————————————— The checker ——————————————————————————————— */

interface Allowed { from: string; to: string; owner: string; why: string }
interface Broken { from: string; line: number; to: string; rule: string }
interface Spec { spec: string; line: number; typeOnly: boolean; dynamic: boolean }
interface Edge { to: string; line: number }

const CODE = /\.tsx?$/;
const FOLDERS = Object.keys(MAY_IMPORT).filter((k) => k !== 'root') as Layer[];
const isTest = (f: string) => /\.test\.tsx?$/.test(f);

/** The layer of a file (null: outside the layers) and its concept / section (shared/<concept>, features/<section>…). */
function placeOf(f: string): { layer: Layer | null; part: string } {
  const p = f.split('/');
  if (p.length === 1) return { layer: 'root', part: '' };
  return { layer: FOLDERS.includes(p[0] as Layer) ? (p[0] as Layer) : null, part: p.length > 2 ? p[1] : '' };
}

/** Every import of a file, and the line of its first JSX. */
function importsOf(file: string, text: string): { specs: Spec[]; jsx: number } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const specs: Spec[] = [];
  let jsx = 0;
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const add = (node: ts.Node, spec: string, typeOnly: boolean, dynamic = false) => specs.push({ spec, line: lineOf(node), typeOnly, dynamic });
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const c = node.importClause;
      const named = c?.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : null;
      add(node, node.moduleSpecifier.text, !!c && (c.isTypeOnly || (!c.name && named !== null && named.length > 0 && named.every((e) => e.isTypeOnly))));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const c = node.exportClause;
      add(node, node.moduleSpecifier.text, node.isTypeOnly || (!!c && ts.isNamedExports(c) && c.elements.length > 0 && c.elements.every((e) => e.isTypeOnly)));
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      add(node, node.moduleReference.expression.text, node.isTypeOnly);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const a = node.arguments[0];
      add(node, a && ts.isStringLiteralLike(a) ? a.text : '(computed)', false, true);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      add(node, node.argument.literal.text, true);
    } else if (!jsx && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))) {
      jsx = lineOf(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { specs, jsx };
}

/** The file of src an import names (path under src); undefined for a package, null when no such file exists. */
function resolveIn(names: Set<string>, from: string, spec: string): string | null | undefined {
  const s = spec.replace(/[?#].*$/, '');
  let base: string;
  if (s.startsWith('@/')) base = posix.normalize(s.slice(2));
  else if (s === '.' || s === '..' || s.startsWith('./') || s.startsWith('../')) base = posix.join(posix.dirname(from), s);
  else return undefined;
  const stem = base.replace(/\.jsx?$/, '');
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, `${stem}.ts`, `${stem}.tsx`]) if (names.has(c)) return c;
  return null;
}

const mayList = (l: Layer) => MAY_IMPORT[l].join(', ') + (TYPE_ONLY[l] ? ` (${TYPE_ONLY[l]!.join(', ')}: types only)` : '');

/** The rule an import breaks, or null. */
function ruleOf(from: string, to: string, s: Spec): string | null {
  const a = placeOf(from), b = placeOf(to);
  if (a.layer === null || a.layer === 'dev') return null;                     // outside: reported once for the file; dev: anything
  if (b.layer === null) return 'imports a file outside the layers';
  if (b.layer === 'dev') return from === DEV_DOOR && s.dynamic ? null : 'nothing imports src/dev (but `import()` in main.tsx)';
  if (b.layer === 'i18n') return a.layer === 'i18n' || DICTIONARY_READERS.includes(from) ? null
    : `the dictionaries are read only by ${DICTIONARY_READERS.join(' and ')} (t(), ct())`;
  if (a.layer === 'features' && b.layer === 'app') return 'a feature never imports src/app';
  if (a.layer === 'features' && b.layer === 'features' && a.part !== b.part) return 'a feature imports only its own section';
  if (!MAY_IMPORT[a.layer].includes(b.layer) && !(s.typeOnly && TYPE_ONLY[a.layer]?.includes(b.layer)))
    return TYPE_ONLY[a.layer]?.includes(b.layer) ? `src/${a.layer} imports ${b.layer} only with \`import type\``
      : `${a.layer === 'root' ? from : `src/${a.layer}`} imports only ${mayList(a.layer)}`;
  if (a.layer === 'shared' && b.layer === 'shared' && a.part !== b.part && !(SHARED_RANK[b.part] < SHARED_RANK[a.part]))
    return `shared « ${a.part} » (rank ${SHARED_RANK[a.part]}) imports only lower ranks: « ${b.part} » is ${SHARED_RANK[b.part] ?? 'unranked'}`;
  return null;
}

/** Every import of the tree (path under src → text; '' for files that are not code) that breaks a rule. */
function check(files: Map<string, string>): { broken: Broken[]; code: number; imports: number } {
  const names = new Set(files.keys());
  const broken: Broken[] = [];
  const runtime = new Map<string, Edge[]>();                                    // what each file pulls into the built app
  let code = 0, imports = 0;
  for (const [from, text] of files) {
    if (!CODE.test(from)) continue;
    code++;
    const a = placeOf(from);
    const out = (to: string, line: number, rule: string) => broken.push({ from, line, to, rule });
    if (a.layer === null || ((a.layer === 'shared' || a.layer === 'features') && !a.part)
      || (a.layer === 'root' && !ROOT_FILES.includes(from) && !isTest(from) && !from.endsWith('.d.ts'))) {
      out('(folder)', 1, `lives outside the layers (${FOLDERS.join(', ')}; shared/<concept>/, features/<section>/)`);
      continue;
    }
    if (a.layer === 'shared' && SHARED_RANK[a.part] === undefined) out('(folder)', 1, `shared « ${a.part} » has no rank: add it to SHARED_RANK and to docs/ARCHITECTURE.md`);
    if (isTest(from)) continue;
    const { specs, jsx } = importsOf(from, text);
    if (a.layer === 'domain' && jsx) out('JSX', jsx, 'domain draws nothing: no JSX');
    const edges: Edge[] = [];
    runtime.set(from, edges);
    for (const s of specs) {
      const to = resolveIn(names, from, s.spec);
      if (to === undefined) {                                                   // a package
        if (s.spec === '(computed)' && a.layer !== 'dev') out(s.spec, s.line, 'import() of a computed name cannot be checked: name the file');
        if (a.layer === 'domain' && DOMAIN_NEVER_IMPORTS.some((r) => r.test(s.spec))) out(s.spec, s.line, 'domain draws nothing: no preact (but @preact/signals), no lucide-preact');
        continue;
      }
      if (to === null) { out(s.spec, s.line, 'not found under src'); continue; }
      imports++;
      if (!s.typeOnly) edges.push({ to, line: s.line });
      const rule = ruleOf(from, to, s);
      if (rule) out(to, s.line, rule);
    }
  }
  // the customer's page: walk what it pulls in from its entry, and stop at the first file of a refused layer
  const via = new Map<string, string>([[CLIENT_ENTRY, '']]);
  const queue = files.has(CLIENT_ENTRY) ? [CLIENT_ENTRY] : [];
  const pathTo = (f: string) => { const p = [f]; while (via.get(p[0])) p.unshift(via.get(p[0])!); return p.join(' → '); };
  while (queue.length) {
    const f = queue.shift()!;
    for (const e of runtime.get(f) ?? []) {
      const layer = placeOf(e.to).layer;
      if (layer && CLIENT_NEVER_REACHES.includes(layer)) {
        if (!broken.some((b) => b.from === f && b.to === e.to)) broken.push({ from: f, line: e.line, to: e.to, rule: `the customer's page reaches ${layer}: ${pathTo(f)}` });
      } else if (!via.has(e.to)) { via.set(e.to, f); queue.push(e.to); }
    }
  }
  return { broken, code, imports };
}

/** The breaks not in the allow-list, and the allow-list entries that match no break any more. */
function sortOut(broken: Broken[], allowed: readonly Allowed[]) {
  const same = (b: Broken, a: Allowed) => b.from === a.from && b.to === a.to;
  return { left: broken.filter((b) => !allowed.some((a) => same(b, a))), stale: allowed.filter((a) => !broken.some((b) => same(b, a))) };
}

const say = (b: Broken) => `${b.from}:${b.line} → ${b.to} — ${b.rule}`;

/* ——————————————————————————————— The tests ———————————————————————————————— */

/** Every file under src: path under src → text (code) or '' (CSS, pictures, data). */
function readTree(): Map<string, string> {
  const root = dirname(fileURLToPath(import.meta.url));
  const files = new Map<string, string>();
  const walk = (dir: string, rel: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(join(dir, d.name), r);
      else files.set(r, CODE.test(d.name) ? readFileSync(join(dir, d.name), 'utf8') : '');
    }
  };
  walk(root, '');
  return files;
}

describe('the layers of src (docs/ARCHITECTURE.md, « Folders »)', () => {
  let found: ReturnType<typeof check>;
  /* every file of src parsed once (about 7 s measured on a machine under heavy load): vitest's 10 s for a hook was cut on a
     busy machine (tests-05, S66), and a cut hook fails the tests below for nothing. A real failure is a broken rule. */
  beforeAll(() => { found = check(readTree()); }, 30000);

  it('reads the whole tree', () => {
    expect(found.code).toBeGreaterThan(200);
    expect(found.imports).toBeGreaterThan(1000);
  });
  it('no import breaks a rule (but the known ones in ALLOWED)', () => {
    expect(sortOut(found.broken, ALLOWED).left.map(say), 'imports that break the layers').toEqual([]);
  });
  it('every entry of ALLOWED still matches an import (remove the ones fixed)', () => {
    expect(sortOut(found.broken, ALLOWED).stale.map((a) => `${a.from} → ${a.to} (${a.owner})`), 'stale entries of ALLOWED').toEqual([]);
  });
});

describe('the checker, on small made-up trees', () => {
  const keys = (tree: Record<string, string>) => check(new Map(Object.entries(tree))).broken.map((b) => `${b.from} -> ${b.to}`).sort();
  it.each<[string, Record<string, string>, string[]]>([
    ['a layer imports only its own and the ones its row lists', {
      'lib/a.ts': "import { b } from '../platform/b';", 'platform/b.ts': '',
      'services/s.ts': "import { Button } from '../ui/Button';",                // ui is lower in the order, but not in the row of services
      'ui/Button.tsx': "import { may } from '../domain/rights';", 'domain/rights.ts': ''
    }, ['lib/a.ts -> platform/b.ts', 'services/s.ts -> ui/Button.tsx', 'ui/Button.tsx -> domain/rights.ts']],
    ['ui imports data only with import type', {
      'ui/kit.tsx': "import type { Job } from '../data/types';\nimport { type Row } from '../data/select';\nimport { save } from '../data/api';\ntype S = import('../data/store').S;",
      'data/types.ts': '', 'data/select.ts': '', 'data/api.ts': '', 'data/store.ts': ''
    }, ['ui/kit.tsx -> data/api.ts']],
    ['a feature imports only its own section, never src/app', {
      'features/jobs/JobScreen.tsx': "import { x } from './x';\nimport { y } from '../invoices/y';\nimport { routes } from '../../app/routes';",
      'features/jobs/x.ts': '', 'features/invoices/y.ts': '', 'app/routes.ts': "const load = () => import('../features/jobs/JobScreen');"
    }, ['features/jobs/JobScreen.tsx -> app/routes.ts', 'features/jobs/JobScreen.tsx -> features/invoices/y.ts']],
    ['a shared concept imports only concepts of a lower rank', {
      'shared/customers/a.ts': "import { p } from '../places/p';\nimport { s } from '../stock/s';\nimport { b } from './b';",
      'shared/places/p.ts': "import type { C } from '../customers/b';", 'shared/stock/s.ts': '', 'shared/customers/b.ts': ''
    }, ['shared/customers/a.ts -> shared/stock/s.ts', 'shared/places/p.ts -> shared/customers/b.ts']],
    ['src/domain draws nothing', {
      'domain/oil/a.ts': "import { signal } from '@preact/signals';\nimport { useState } from 'preact/hooks';",
      'domain/oil/b.tsx': 'export const B = () => <b>oil</b>;',
      'domain/oil/c.ts': "import type { VNode } from 'preact';\nimport { Car } from 'lucide-preact';"
    }, ['domain/oil/a.ts -> preact/hooks', 'domain/oil/b.tsx -> JSX', 'domain/oil/c.ts -> lucide-preact', 'domain/oil/c.ts -> preact']],
    ['the customer’s page never imports nor reaches data, features or app', {
      'client/main.tsx': "import { Page } from './Page';\nconst demo = () => import('./demo');",
      'client/Page.tsx': "import type { Job } from '../data/types';\nimport { pin } from '../shared/places/pin';",
      'client/demo.ts': "import { money } from '../lib/money';", 'lib/money.ts': '',
      'shared/places/pin.ts': "import { store } from '../../data/store';\nimport type { Row } from '../../data/types';",
      'data/store.ts': '', 'data/types.ts': ''
    }, ['client/Page.tsx -> data/types.ts', 'shared/places/pin.ts -> data/store.ts']],
    ['nothing imports src/dev but import() in main.tsx', {
      'main.tsx': "const go = () => import('./dev/demo');", 'dev/demo.ts': "import { App } from '../app/App';",
      'app/App.tsx': "import { fake } from '../dev/fake';", 'dev/fake.ts': ''
    }, ['app/App.tsx -> dev/fake.ts']],
    ['main.tsx opens src/dev only with import()', { 'main.tsx': "import { startDemo } from './dev/demo';", 'dev/demo.ts': '' }, ['main.tsx -> dev/demo.ts']],
    ['tests may import anything', {
      'lib/a.test.ts': "import { x } from '../features/jobs/x';\nimport { d } from '../dev/demo';", 'features/jobs/x.ts': '', 'dev/demo.ts': ''
    }, []],
    ['the dictionaries are read by lib/i18n.ts and client/i18n.ts only', {
      'lib/i18n.ts': "import { fr } from '../i18n/fr';", 'client/i18n.ts': "import { client } from '../i18n/fr/client';",
      'i18n/fr/index.ts': "import { client } from './client';\nexport const fr = { client };", 'i18n/fr/client.ts': '',
      'features/jobs/x.ts': "import { jobs } from '../../i18n/fr/jobs';", 'i18n/fr/jobs.ts': ''
    }, ['features/jobs/x.ts -> i18n/fr/jobs.ts']],
    ['@/ paths, export … from and CSS are checked too', {
      'lib/a.ts': "export { b } from '@/data/b';", 'data/b.ts': '',
      'shared/places/p.tsx': "import '../../features/map/map.css';\nimport './places.css';", 'features/map/map.css': '', 'shared/places/places.css': ''
    }, ['lib/a.ts -> data/b.ts', 'shared/places/p.tsx -> features/map/map.css']],
    ['every file sits in a layer, every import is found', {
      'stuff/a.ts': '', 'shared/receipts/r.ts': '', 'features/loose.ts': '', 'helpers.ts': '',
      'lib/b.ts': "import { q } from './missing';\nconst m = (n: string) => import(n);"
    }, ['features/loose.ts -> (folder)', 'helpers.ts -> (folder)', 'lib/b.ts -> (computed)', 'lib/b.ts -> ./missing', 'shared/receipts/r.ts -> (folder)', 'stuff/a.ts -> (folder)']]
  ])('%s', (_name, tree, expected) => {
    expect(keys(tree)).toEqual(expected);
  });

  it('the allow-list hides its breaks, and an entry that matches none is stale', () => {
    const broken: Broken[] = [
      { from: 'ui/a.tsx', line: 3, to: 'data/api.ts', rule: '' }, { from: 'shared/jobs/j.ts', line: 1, to: 'shared/invoices/i.ts', rule: '' }
    ];
    const allowed: Allowed[] = [
      { from: 'ui/a.tsx', to: 'data/api.ts', owner: 'app-shell', why: '' }, { from: 'lib/x.ts', to: 'data/y.ts', owner: 'lib-temps', why: '' }
    ];
    const { left, stale } = sortOut(broken, allowed);
    expect(left.map((b) => b.from)).toEqual(['shared/jobs/j.ts']);
    expect(stale.map((a) => a.from)).toEqual(['lib/x.ts']);
  });
});

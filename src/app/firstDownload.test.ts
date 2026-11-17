// @vitest-environment node
/* The first download (the entry the build makes from main.tsx) carries only what every start needs. Code asked with
   `import()` comes in a file of its own; a plain import pulls the whole file, and everything it imports, into the entry.
   This test follows the plain imports from main.tsx (as the build does: `import()` and imports of types only are left
   out) and checks that the code only « Me déconnecter » needs stays out: the sign-out flow and the push service
   (app-shell-r2-1: main.tsx → app/signOutCleanup → shared/app/signOut → services/push brought them in, +2.8 kB). */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = posix.normalize(spec.slice(2));
  else if (spec.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else return null; // a package
  for (const f of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.tsx?$/.test(f) && existsSync(join(SRC, f))) return f;
  }
  return null; // CSS, pictures
}

/** the files a plain import of `file` brings (paths under src) */
function staticImports(file: string): string[] {
  const text = readFileSync(join(SRC, file), 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  for (const st of sf.statements) {
    let spec: string | null = null;
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const c = st.importClause;
      const typesOnly = !!c && (c.isTypeOnly || (!c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings)
        && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((e) => e.isTypeOnly)));
      if (!typesOnly) spec = st.moduleSpecifier.text;
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) && !st.isTypeOnly) {
      spec = st.moduleSpecifier.text;
    }
    const to = spec ? resolveSpec(file, spec) : null;
    if (to) out.push(to);
  }
  return out;
}

/** every file of src in the entry, with the chain that brings it */
function entryFiles(start: string): Map<string, string[]> {
  const seen = new Map<string, string[]>([[start, [start]]]);
  const todo = [start];
  while (todo.length) {
    const f = todo.shift()!;
    for (const to of staticImports(f)) {
      if (seen.has(to)) continue;
      seen.set(to, [...seen.get(f)!, to]);
      todo.push(to);
    }
  }
  return seen;
}

describe('the first download', () => {
  const entry = entryFiles('main.tsx');
  it('is followed from main.tsx (the frame and the sign-out list are in it)', () => {
    expect(entry.has('app/App.tsx')).toBe(true);
    expect(entry.has('app/signOutCleanup.ts')).toBe(true);
    expect(entry.has('shared/app/signOutHooks.ts')).toBe(true);
  });
  it('does not carry the sign-out flow nor the push service (asked only when « Plus » or « Mon compte » opens)', () => {
    for (const f of ['shared/app/signOut.ts', 'services/push.ts']) {
      expect(entry.get(f)?.join(' → ') ?? null, f).toBeNull();
    }
  });
});

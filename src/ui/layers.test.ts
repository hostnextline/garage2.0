/* The order of the kit's layers: the tap shield (a moment after a sheet closes) takes the second tap of a double tap
   meant for the screen and its bars, never a tap on what opens right after it (a sheet, a question, a toast's
   « Annuler », the agenda's menu). */
import { describe, it, expect } from 'vitest';

// the test runner empties CSS imports (even ?raw): the files are read from the disk
const disk = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync: (p: URL, enc: 'utf8') => string };
const here = import.meta.url.replace(/[^/]*$/, '');
const read = (name: string) => disk.readFileSync(new URL(here + 'styles/' + name), 'utf8');
const components = read('components.css');
const menu = read('menu.css');

const z = (css: string, sel: string): number => {
  const m = new RegExp(`(^|\\n)\\${sel}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(css);
  if (!m) throw new Error(`no z-index for ${sel}`);
  return Number(m[2]);
};

describe('the tap shield’s place among the layers', () => {
  it('above the bars, under sheets, toasts and the menu', () => {
    const shield = z(components, '.tap-shield');
    expect(shield).toBeGreaterThan(50);   // the bars, Hermes and the text heads (30–50)
    expect(shield).toBeLessThan(z(components, '.sheet-back'));
    expect(shield).toBeLessThan(z(components, '.toasts'));
    expect(shield).toBeLessThan(z(menu, '.agenda-menu-shade'));
  });
});

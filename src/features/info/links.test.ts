/* « Info »: every article's « Ouvrir cet écran » goes to a real screen, only for a reader who may open it, and the help
   covers what the app does today (comms-guide-21, comms-guide-23). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTICLES } from './articles';
import { mayOpen, type Rights } from './links';

const all = (v: boolean, but: Partial<Record<keyof Rights, boolean>> = {}) =>
  new Proxy({}, { get: (_, k: string) => () => (k in but ? but[k as keyof Rights]! : v) }) as Rights;
const routes = [...readFileSync(join(__dirname, '..', '..', 'app', 'routes.ts'), 'utf8').matchAll(/pattern: '([^']+)'/g)].map((m) => m[1]);
const matches = (path: string) => routes.some((p) => {
  const re = new RegExp('^' + p.replace(/\/:[a-z]+\?/g, '(?:/[^/]+)?').replace(/:[a-z]+/g, '[^/]+') + '$');
  return re.test(path);
});

describe('« Info »: the screens the articles open', () => {
  it('every link is a real route (the windows and texts articles used to open the settings menu)', () => {
    for (const a of ARTICLES) if (a.link) expect(matches(a.link.replace(/^#/, '').split('?')[0]), `${a.id}: ${a.link}`).toBe(true);
    expect(ARTICLES.find((a) => a.id === 'windows')?.link).toBe('#/settings/booking');
    expect(ARTICLES.find((a) => a.id === 'texts-settings')?.link).toBe('#/settings/texts');
  });
  it('« Ouvrir cet écran » only for a reader who may open it', () => {
    expect(mayOpen('#/team', all(true))).toBe(true);
    expect(mayOpen('#/team', all(true, { team: false }))).toBe(false);
    expect(mayOpen('#/treasury', all(false))).toBe(false);
    expect(mayOpen('#/book', all(false, { walkIn: true }))).toBe(true);
    expect(mayOpen('#/customer/new', all(true, { newCustomer: false }))).toBe(false);
    expect(mayOpen('#/', all(false))).toBe(true);
    expect(mayOpen('#/guide', all(false))).toBe(true);
    expect(mayOpen('#/settings/booking', all(false, { settings: true }))).toBe(true);
  });
});

describe('« Info »: the help describes the app of today', () => {
  const fr = (id: string) => { const a = ARTICLES.find((x) => x.id === id); expect(a, id).toBeTruthy(); return JSON.stringify(a!.fr); };
  it('has the features added since the first help: incoming calls and texts, oil reminders, too much driving, « Modifier la facture »', () => {
    expect(fr('call')).toContain('Appel entrant');
    expect(fr('texts-in')).toContain('Recevoir les textos dans mon compte');
    expect(fr('oil')).toContain('À appeler');
    expect(fr('far')).toContain('Beaucoup de route ce jour-là');
    expect(fr('invoice-edit')).toContain('Modifier la facture');
  });
  it('no longer gives the old instructions', () => {
    expect(fr('invoice-cancel')).not.toMatch(/annule-la.*refais-la/);
    expect(fr('pay-later')).not.toContain('Payer plus tard');
    expect(fr('pay-later')).toContain('Le client paiera plus tard');
    expect(fr('coffre')).not.toContain('Le propriétaire et le mécano du camion peuvent');
    expect(fr('team')).not.toContain('dans « Réglages »');
    expect(fr('offline')).not.toContain('sera envoyé');
    expect(fr('install')).not.toContain('Ferme complètement');
    expect(fr('job-flow')).toContain('NIV');
    expect(fr('job-flow')).toContain('Pièces utilisées');
    expect(fr('move')).toContain('Modifier');
    expect(fr('move')).toContain('Changer de camion');
    expect(fr('inventory')).toContain('pièces à l’inventaire');
  });
  it('the English text uses the English quotes', () => {
    for (const a of ARTICLES) expect(JSON.stringify(a.en), a.id).not.toMatch(/[«»]/);
  });
});

/* Réglages, the frame of the sections: what is typed stays as typed (settings-team-st-1), the dot of the list follows the
   saved value even when the section is closed (st-5), a text of a hidden kind leaves the draft (st-4), and no form is
   drawn before the settings row is on this device (settings-team-03, st-6). */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const calls: { name: string; args: unknown[] }[] = [];
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return { ...real, saveSettings: async (part: string, value: unknown) => { calls.push({ name: 'saveSettings', args: [part, value] }); } };
});
vi.mock('../../shared/app/UpdatePanel', () => ({ UpdatePanel: () => null }));
import SettingsScreen from './SettingsScreen';
import { CompanySection } from './CompanySection';
import { TextsSection } from './TextsSection';
import { drafts, draftKey, hasDraft } from './SectionFrame';
import { companySaved } from './CompanySection';
import { replaceLocal } from '../../data/store';
import { access } from '../../data/auth';
import { wide } from '../../platform/media';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';

const owner = { id: 'u1', full_name: 'Test', short_name: 'Test', email: null, phone: null, roles: ['owner'], owner: true, lang: 'fr', prefs: {}, color: null,
  rights: { settings: true }, trucks: [], card_online: false, texts_online: false } as unknown as Access;
const seed = (x: Record<string, unknown> = {}) => replaceLocal('settings', [{ id: '1', company: { name: 'Garage' }, ...x } as never]);
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const show = async (el: preact.JSX.Element) => { await act(async () => { render(null, box); render(el, box); }); await wait(); };
const type = async (el: HTMLInputElement | HTMLTextAreaElement, v: string) => { await act(async () => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(); };
const screen = (section?: string) => <SettingsScreen params={section ? { section } : {}} query={new URLSearchParams()} />;

beforeEach(() => { lang.value = 'fr'; calls.length = 0; drafts.value = {}; access.value = owner; wide.value = true; seed(); });

describe('Réglages: what is typed stays as typed (settings-team-st-1)', () => {
  it('a space typed after the saved name stays in the box, and the next letter follows it', async () => {
    await show(<CompanySection />);
    const name = q('company-name') as HTMLInputElement;
    await type(name, 'Garage ');
    expect((q('company-name') as HTMLInputElement).value).toBe('Garage ');
    await type(q('company-name') as HTMLInputElement, 'Garage X');
    expect((q('company-name') as HTMLInputElement).value).toBe('Garage X');
  });
  it('the same with another field already changed (before: « GarageX »)', async () => {
    await show(<CompanySection />);
    const inputs = [...box.querySelectorAll('input')] as HTMLInputElement[];
    await type(inputs[1], 'Garage inc.');
    await type(q('company-name') as HTMLInputElement, 'Garage ');
    await type(q('company-name') as HTMLInputElement, 'Garage X');
    expect((q('company-name') as HTMLInputElement).value).toBe('Garage X');
    (q('settings-save') as HTMLButtonElement).click();
    await wait();
    const saved = calls.find((c) => c.name === 'saveSettings')!.args[1] as Record<string, unknown>;
    expect(saved.name).toBe('Garage X');
  });
});

describe('Réglages: the dot of the list (settings-team-st-5)', () => {
  it('a section left closed whose change was saved with the same value elsewhere no longer says « non enregistrés »', async () => {
    drafts.value = { [draftKey('company')]: { name: 'Garage X' } };
    expect(hasDraft('company', companySaved)).toBe(true);
    await show(screen('billing'));
    expect(q('settings-nav-company')!.textContent).toContain('Changements non enregistrés');
    await act(async () => { seed({ company: { name: 'Garage X' } }); });
    await wait();
    expect(hasDraft('company', companySaved)).toBe(false);
    expect(q('settings-nav-company')!.textContent).not.toContain('Changements non enregistrés');
  });
  it('only spaces around the saved value: no dot', () => {
    drafts.value = { [draftKey('company')]: { name: 'Garage ' } };
    expect(hasDraft('company', companySaved)).toBe(false);
  });
});

describe('Réglages → Textos: a text whose kind is hidden leaves the draft (settings-team-st-4)', () => {
  it('the window text edited, then windows off: nothing said unsaved, nothing about the window written', async () => {
    seed({ booking: { windows_on: false } });
    drafts.value = { [draftKey('texts')]: { 'fr.window': 'Votre plage…' } };
    await show(<TextsSection />);
    expect(q('settings-savebar')!.textContent).toContain('Tout est enregistré');
    expect(drafts.value[draftKey('texts')] || {}).toEqual({});
  });
});

describe('Réglages: no form before the settings row (settings-team-03, st-6)', () => {
  it('no row: a placeholder with a short line, no field; the row arriving draws the form', async () => {
    replaceLocal('settings', []);
    await show(screen('company'));
    expect(q('settings-company')!.getAttribute('aria-busy')).toBe('true');
    expect(q('settings-wait')!.textContent).toBe('Un instant…');
    expect(q('company-name')).toBeNull();
    await act(async () => { seed(); });
    await wait();
    expect(q('settings-wait')).toBeNull();
    expect((q('company-name') as HTMLInputElement).value).toBe('Garage');
  });
});

describe('Réglages: the guide’s anchor (R150)', () => {
  it('on a phone, a section page carries its data-tour (the menu rows are not drawn); on a computer only the menu row does', async () => {
    wide.value = false;
    await show(screen('company'));
    expect(box.querySelector('[data-testid="settings-nav"]')).toBeNull();
    const a = box.querySelectorAll('[data-tour="settings-company"]');
    expect(a.length).toBe(1);
    expect(a[0].querySelector('[data-testid="settings-company"]')).toBeTruthy();
    await show(screen());
    expect(box.querySelectorAll('[data-tour="settings-company"]').length).toBe(1);
    expect(box.querySelector('[data-tour="settings-company"]')?.getAttribute('data-testid')).toBe('settings-nav-company');
    wide.value = true;
    await show(screen('company'));
    const b = box.querySelectorAll('[data-tour="settings-company"]');
    expect(b.length).toBe(1);
    expect(b[0].getAttribute('data-testid')).toBe('settings-nav-company');
  });
});

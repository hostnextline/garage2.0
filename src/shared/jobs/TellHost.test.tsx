/* openTell(day) (Part 28, REARRANGE.md §3.3): the send list opens over any screen in its own root on document.body,
   mounted on first use (no screen mounts it); offline it says so and opens nothing. The sheet itself is pretended. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'preact/test-utils';

vi.mock('./TellSheet', () => ({ TellSheet: (p: { day: string; onClose: () => void }) => <button type="button" data-testid="fake-tell" data-day={p.day} onClick={p.onClose}>x</button> }));
import { openTell, tellOpen, closeTell } from './TellHost';
import { net } from '../../data/sync';
import { toasts } from '../../ui/toast';
import { lang } from '../../lib/i18n';

const q = () => document.querySelector<HTMLElement>('[data-testid="fake-tell"]');
beforeEach(() => { lang.value = 'fr'; toasts.value = []; net.value = { ...net.value, online: true }; act(() => closeTell()); });

describe('openTell', () => {
  it('mounts its own root on document.body once, shows that day; closing closes it; another day replaces it', async () => {
    expect(document.querySelector('[data-owner="tell"]')).toBeNull();
    await act(async () => { openTell('2026-11-25'); });
    expect(document.querySelectorAll('[data-owner="tell"]').length).toBe(1);
    expect(q()!.getAttribute('data-day')).toBe('2026-11-25');
    expect(tellOpen()).toBe('2026-11-25');
    await act(async () => { openTell('2026-11-26'); });
    expect(document.querySelectorAll('[data-owner="tell"]').length).toBe(1);
    expect(q()!.getAttribute('data-day')).toBe('2026-11-26');
    await act(async () => { q()!.click(); });
    expect(q()).toBeNull();
    expect(tellOpen()).toBeNull();
  });
  it('offline: « Pas de réseau … », nothing opens', async () => {
    net.value = { ...net.value, online: false };
    await act(async () => { openTell('2026-11-25'); });
    expect(q()).toBeNull();
    expect(toasts.value.map((x) => x.text)).toEqual(['Pas de réseau : les textos ne peuvent pas partir. Réessaie quand le réseau revient.']);
  });
});

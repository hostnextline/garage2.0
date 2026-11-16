import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../shared/invoices/share', async (orig) => {
  const real = await orig<typeof import('../../shared/invoices/share')>();
  return { ...real, copyText: async () => true };
});
import { LinkSheet } from './LinkSheet';
import { lang } from '../../lib/i18n';
import type { LinkResult } from '../../domain/team/teamApi';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const link = (name: string, url: string): LinkResult => ({ name, link: url, sent: 'none' });
const show = async (r: LinkResult | null) => { await act(async () => { render(<LinkSheet result={r} onClose={() => undefined} />, box); }); await wait(); };

beforeEach(() => { lang.value = 'fr'; });

describe('Équipe: the link to copy (settings-team-08)', () => {
  it('« Lien copié » never shows for a new link while the clipboard holds the previous person’s', async () => {
    await show(link('Saleh', 'https://x.test/#invite=AAA'));
    await act(async () => { q('link-copy')!.click(); });
    await wait();
    expect(q('link-copy')!.textContent).toContain('Lien copié');
    await show(null);
    await show(link('Adam', 'https://x.test/#invite=BBB'));
    expect(q('link-copy')!.textContent).toBe('Copier');
    expect((q('invite-link') as HTMLInputElement).value).toBe('https://x.test/#invite=BBB');
  });
});

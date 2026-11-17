/* « Texto entrant », the host: a tap on a text's alert opens that number's conversation even when the text came in while
   the app was hidden (comms-guide-14, comms-guide-r2-2), and the alert's address is repaired for an owner who takes the
   texts OR the calls (comms-guide-08, comms-guide-r2-6). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Access } from '../../data/types';
import type { IncomingText } from '../../shared/customers/texts';

const h = vi.hoisted(() => ({ texts: [] as IncomingText[], tap: null as ((phone: string) => void) | null, repaired: [] as string[] }));
// the texts as the server has them: the host's own loading reads them when asked (onCheckTexts), as useIncomingTexts does
vi.mock('./useIncomingTexts', async () => {
  const { useEffect, useState } = await import('preact/hooks');
  const { onCheckTexts } = await import('../../services/bubbles');
  const { nextChats } = await import('../../shared/customers/texts');
  const { chats, setChats, since } = await import('./store');
  return {
    useIncomingTexts: (on: boolean) => {
      const [list, setList] = useState<IncomingText[]>([]);
      useEffect(() => {
        if (!on) return;
        onCheckTexts(() => { const l = [...h.texts]; setList(l); setChats(nextChats(chats.value, l, since(), false)); });
        return () => onCheckTexts(null);
      }, [on]);
      return on ? list : [];
    }
  };
});
vi.mock('./fromAlert', () => ({ openFromAlert: (open: (phone: string) => void) => { h.tap = open; return () => { h.tap = null; }; } }));
vi.mock('./pushRepair', () => ({ repairPushOnce: async (who: string) => { h.repaired.push(who); } }));
vi.mock('../../data/api', () => ({
  conversation: vi.fn(async () => ({ ok: true, status: 'ok', messages: [] })),
  conversationPhone: vi.fn(async () => ({ ok: true, status: 'ok', messages: [] })),
  sendChat: vi.fn(async () => ({ ok: true, status: 'sent' })),
  sendChatPhone: vi.fn(async () => ({ ok: true, status: 'sent' }))
}));
import { TextHost } from './TextHost';
import { chats, setChats } from './store';
import { access } from '../../data/auth';
import { phoneId } from '../../shared/customers/texts';

const owner = (prefs: Record<string, boolean>, id = 'owner-1') => ({ id, roles: ['owner'], owner: true, prefs, rights: {}, trucks: [] }) as unknown as Access;
const box = document.createElement('div');
document.body.appendChild(box);
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const draw = () => act(() => render(<TextHost />, box));
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const chatOf = (phone: string) => chats.value.find((c) => phoneId(c.phone) === phoneId(phone));

beforeEach(() => { h.texts = []; h.tap = null; h.repaired = []; setChats([]); Element.prototype.scrollIntoView = () => undefined; });
afterEach(async () => { await act(() => render(null, box)); access.value = null; });

describe('a tap on a text alert', () => {
  it('the text came in while the app was hidden (no bubble yet): that number opens, and the texts read next keep it open', async () => {
    access.value = owner({ texts: true });
    await draw();
    expect(chats.value).toEqual([]);
    h.texts = [{ id: 't1', phone: '+15145550177', name: 'Lara', body: 'Une place demain ?', at: new Date().toISOString() }];
    await act(() => { h.tap!('+15145550177'); });
    await flush();
    expect(chatOf('+15145550177')?.state).toBe('open');
    expect(chatOf('+15145550177')?.name).toBe('Lara');
    expect(chats.value).toHaveLength(1);
    expect(q('text-window')).not.toBeNull();
    expect(q('text-heads')).toBeNull();
  });
  it('a bubble already there (a round head): it opens, the other window becomes a head', async () => {
    access.value = owner({ texts: true });
    setChats([{ phone: '+15145550188', name: null, state: 'open', seenAt: '2026-11-16T10:00:00Z' }, { phone: '+15145550177', name: 'Lara', state: 'min', seenAt: '2026-11-16T10:00:00Z' }]);
    await draw();
    await act(() => { h.tap!('+15145550177'); });
    await flush();
    expect(chatOf('+15145550177')?.state).toBe('open');
    expect(chatOf('+15145550188')?.state).toBe('min');
  });
});

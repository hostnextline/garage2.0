/* « Texto entrant »: the texts of the last week, read from incoming_texts (written by the server function « ring »).
   Told at once by realtime; the list is also checked every minute while realtime is up (a missed message), every 15 s
   while it is not, at once when the app comes back in view, and when Réglages → « Essayer » asks. Nothing is asked
   while the app is hidden. An answer that comes back after a newer one is dropped, and the same list is not drawn
   again. Each list read also wakes the bubbles (store.ts). */
import { useEffect, useState } from 'preact/hooks';
import { sb } from '../../data/auth';
import { REALTIME } from '../../lib/config';
import { wide } from '../../platform/media';
import { hermesOpen, onCheckTexts } from '../../services/bubbles';
import { nextChats, type IncomingText } from '../../shared/customers/texts';
import { chats, setChats, since } from './store';
import { askEvery, sameTexts } from './bubbles';

const WEEK_MS = 7 * 24 * 3600 * 1000, NEWEST = 200;

export function useIncomingTexts(on: boolean): IncomingText[] {
  const [texts, setTexts] = useState<IncomingText[]>([]);
  useEffect(() => {
    if (!on) return;
    let alive = true, live = false, asked = 0, shown: IncomingText[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      const mine = ++asked;
      const { data, error } = await sb.from('incoming_texts').select('id, phone, name, body, at')
        .gte('at', new Date(Date.now() - WEEK_MS).toISOString()).order('at', { ascending: false }).limit(NEWEST);
      // no signal or a refusal: the bubbles stay as they are until the next look
      if (!alive || mine !== asked || error || !data) return;
      const list = data as IncomingText[];
      if (!sameTexts(shown, list)) { shown = list; setTexts(list); }
      setChats(nextChats(chats.value, list, since(), wide.value && !hermesOpen.value));
    };
    const look = () => { load().catch(() => { /* no signal: the next look tries again */ }); };
    const later = () => { timer = setTimeout(() => { look(); later(); }, askEvery(live)); };
    const back = () => { if (document.visibilityState === 'visible') look(); };
    onCheckTexts(look);
    look();
    later();
    document.addEventListener('visibilitychange', back);
    const ch = REALTIME
      ? sb.channel('incoming-texts').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incoming_texts' }, look)
        .subscribe((status) => { live = status === 'SUBSCRIBED'; })
      : null;
    return () => {
      alive = false;
      onCheckTexts(null);
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', back);
      if (ch) void sb.removeChannel(ch);
    };
  }, [on]);
  return on ? texts : [];
}

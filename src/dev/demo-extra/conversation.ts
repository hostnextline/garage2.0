/* DEV ONLY — a pretend conversation with a customer (the real one comes from GoHighLevel: supabase/functions/conversation). */
import { registerFn, put, find } from '../fake-server';
import { checkTexts } from '../../services/bubbles';

/** « Plages d'arrivée » switched on in the pretend settings: the example says a window, never a block */
const windowsOn = () => (find('settings', '1')?.booking as { windows_on?: boolean } | undefined)?.windows_on === true;

const chats = new Map<string, { id: string; at: string; dir: 'in' | 'out'; body: string; kind: string; status: string | null }[]>();
export function load() {
  // ?demo&texto : an example of « Texto entrant » without touching Réglages: the texts come to the owner's account, Lara
  // writes a few seconds after the app opens, then again a little later
  if (/[?&]texto\b/.test(location.search)) {
    const me = find('staff', 'u-hassan');
    if (me) put('staff', { id: 'u-hassan', prefs: { ...((me.prefs as object) || {}), texts: true } });
    /* the demo has no realtime: it says « look now » itself, as the live socket would, so the bubble comes with the
       text instead of at the next look 15 s later (demo-22) */
    const lara = (body: string) => { put('incoming_texts', { phone: '+15145550177', name: 'Lara', body, at: new Date().toISOString() }); setTimeout(() => checkTexts(), 100); };
    setTimeout(() => lara('Bonjour, c’est Lara. Avez-vous une place demain matin pour un changement d’huile ?'), 4000);
    setTimeout(() => lara('C’est une Honda Civic 2019.'), 25000);
  }
  registerFn('conversation', (b) => {
    const id = String(b.customer_id || b.phone || '');
    if (!chats.has(id)) chats.set(id, b.phone ? [] : [
      { id: 'm1', at: new Date(Date.now() - 86400000).toISOString(), dir: 'out', body: windowsOn() ? 'Bonjour, votre rendez-vous est confirmé demain, entre 8 h et 12 h.' : 'Bonjour, votre rendez-vous est confirmé demain matin.', kind: 'SMS', status: 'delivered' },
      { id: 'm2', at: new Date(Date.now() - 80000000).toISOString(), dir: 'in', body: 'Parfait, merci! La voiture sera dans l’entrée.', kind: 'SMS', status: null }
    ]);
    const list = chats.get(id)!;
    if (b.action === 'send') { list.push({ id: 'm' + (list.length + 1), at: new Date().toISOString(), dir: 'out', body: String(b.message || ''), kind: 'SMS', status: 'delivered' }); return { ok: true, status: 'sent' }; }
    return { ok: true, status: 'ok', messages: list };
  });
  // « Essayer » in Réglages → Branchements: a pretend call or a pretend text (the bubble « Texto entrant »)
  registerFn('ring', (b) => {
    if (b.action === 'link') return { ok: true, url: 'https://example.com/functions/v1/ring?k=demo', text_url: 'https://example.com/functions/v1/ring?k=demo&t=sms' };
    if (b.kind === 'text') put('incoming_texts', { phone: String(b.phone || '+15145550100'), name: b.phone ? null : 'Client TEST', body: String(b.body || 'Bonjour, avez-vous une place demain matin pour un changement d’huile ?'), at: new Date().toISOString() });
    else put('incoming_calls', { phone: '+15145550100', name: 'Client TEST', at: new Date().toISOString() });
    return { ok: true };
  });
}

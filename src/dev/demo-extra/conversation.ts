/* DEV ONLY — a pretend conversation with a customer (the real one comes from GoHighLevel: supabase/functions/conversation). */
import { registerFn } from '../fake-server';

const chats = new Map<string, { id: string; at: string; dir: 'in' | 'out'; body: string; kind: string; status: string | null }[]>();
export function load() {
  registerFn('conversation', (b) => {
    const id = String(b.customer_id || '');
    if (!chats.has(id)) chats.set(id, [
      { id: 'm1', at: new Date(Date.now() - 86400000).toISOString(), dir: 'out', body: 'Bonjour, votre rendez-vous est confirmé demain matin.', kind: 'SMS', status: 'delivered' },
      { id: 'm2', at: new Date(Date.now() - 80000000).toISOString(), dir: 'in', body: 'Parfait, merci! La voiture sera dans l’entrée.', kind: 'SMS', status: null }
    ]);
    const list = chats.get(id)!;
    if (b.action === 'send') { list.push({ id: 'm' + (list.length + 1), at: new Date().toISOString(), dir: 'out', body: String(b.message || ''), kind: 'SMS', status: 'delivered' }); return { ok: true, status: 'sent' }; }
    return { ok: true, status: 'ok', messages: list };
  });
}

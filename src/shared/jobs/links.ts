/* The customer's own page (estimate, invoice, tracking): its link, from the last text the server sent for the job, else
   from a text already sent to that customer. After « Changer de client » the texts sent to the wrong customer carry a link
   the server revoked: they are never offered. */
import type { Job, Message } from '../../data/types';
import { messagesOf } from '../../data/select';

const LINK = /(https?:\/\/\S+client\.html#t=[A-Za-z0-9_-]+(?:&l=en)?)/;
/** the link each job's last answer carried, for the customer it was sent to */
const links = new Map<string, string>();
const keyOf = (j: Pick<Job, 'id' | 'customer_id'>) => `${j.id}|${j.customer_id ?? ''}`;

/** remember the link a text just carried (notify answers with it) */
export function rememberLink(j: Pick<Job, 'id' | 'customer_id'>, link: string | null | undefined) { if (link) links.set(keyOf(j), link); }

/** the link of the newest text sent to this customer (pure: tested) */
export function linkIn(msgs: Pick<Message, 'body' | 'customer_id'>[], customerId: string | null): string | null {
  for (const m of msgs) {
    // a text sent to another customer (before « Changer de client »): its link was revoked; one that names nobody is kept
    if (m.customer_id && m.customer_id !== customerId) continue;
    const found = LINK.exec(m.body || '');
    if (found) return found[1];
  }
  return null;
}
/** the customer's page link: from the last answer, else from a text already sent (newest first) */
export function clientLinkOf(j: Pick<Job, 'id' | 'customer_id'>): string | null {
  return links.get(keyOf(j)) ?? linkIn(messagesOf(j.id), j.customer_id);
}

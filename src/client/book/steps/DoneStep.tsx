/* « Réserver en ligne », the end: booked (when, the confirmation text, the button to the customer's own page) or, when
   the server answered without the customer's link, not confirmed: nothing was booked, call us. */
import { CircleCheck, TriangleAlert } from 'lucide-preact';
import { Button } from '../../../ui/Button';
import { longDay } from '../../../lib/dates';
import { formatPhone } from '../../../lib/text';
import type { Garage } from '../../api';
import { relDay } from '../../format';
import { ct, type CLang } from '../../i18n';
import { CallUs } from '../../ui';
import { bookedWhen, slotWindow, whenWords, type Booked, type WebInfo, type WebSlot } from '../book-state';

export function DoneStep(p: { l: CLang; done: Booked; slot: WebSlot | null; info: WebInfo; phone: string; garage: Garage | null; onAgain: () => void }) {
  const { l, done } = p;
  // a real booking always comes with its link; none means it was not kept (a field robots fill was filled, maybe by a
  // phone's autofill): never « C'est réservé » to someone nobody will come to see
  if (!done.link) {
    return (
      <section class="cl-panel glass cl-state" data-testid="book-unconfirmed">
        <span class="cl-state-icon" aria-hidden="true"><TriangleAlert /></span>
        <h1>{ct(l, 'book.unconfirmed.title')}</h1>
        <p>{ct(l, 'book.unconfirmed.text')}</p>
        <CallUs garage={p.garage} l={l} />
      </section>
    );
  }
  const when = bookedWhen(done, p.slot);
  const isFlex = when.block === 'day' && !slotWindow(when);
  const rel = relDay(done.day);
  const day = rel ? ct(l, rel).toLowerCase() : longDay(done.day, l);
  const sent = done.text === 'sent';
  return (
    <section class="cl-panel glass cl-state" data-testid="book-done">
      <span class="cl-state-icon is-ok" aria-hidden="true"><CircleCheck /></span>
      <h1>{ct(l, 'book.done.title')}</h1>
      <p class="bk-done-when" data-testid="book-done-when">{isFlex ? ct(l, 'book.done.leadFlex', { day }) : ct(l, 'book.done.lead', { day, slot: whenWords(when, p.info.blocks, l).toLowerCase() })}</p>
      <p>{sent ? ct(l, 'book.done.text', { phone: formatPhone(p.phone).replace(/ /g, '\u00a0') }) : ct(l, 'book.done.noText')}</p>
      <Button variant="primary" block href={done.link} data-testid="book-see">{ct(l, 'book.done.see')}</Button>
      <Button variant="ghost" block onClick={p.onAgain} data-testid="book-again">{ct(l, 'book.done.again')}</Button>
    </section>
  );
}

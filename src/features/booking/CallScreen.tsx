/* « Appel entrant » (#/call): the phone rings. Type the number: a customer we know shows right away (name, car, address,
   their next appointment) with « Réserver pour … », their file, their appointment. Somebody new: « Par quoi on commence ? »
   L'adresse (when can we be in their area), La voiture, or La job (what it costs, how long): the booking screen opens in
   that order, the number already typed, the name asked last (#/book?call=1&start=…&phone=…). */
import { useMemo, useState } from 'preact/hooks';
import { MapPin, Car, Wrench, CalendarPlus, UserRound, CalendarClock } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { t, lang } from '../../lib/i18n';
import { today, shortDate } from '../../lib/dates';
import { phoneDigits } from '../../lib/text';
import { customerName, vehiclesOf, vehicleLabel, jobsOfCustomer } from '../../data/select';
import type { Customer } from '../../data/types';
import { Page, Panel, Field, PhoneInput, Button, Avatar } from '../../ui';
import { recentFirst, searchIndex } from '../customers/facts';
import { searchList, type SearchDoc } from '../customers/search';
import { Bit } from '../customers/bits';
import './booking.css';

export type CallStart = 'address' | 'car' | 'job';
export const CALL_STARTS: CallStart[] = ['address', 'car', 'job'];
/** the booking screen for a new caller, starting with what they talk about first */
export const callHref = (start: CallStart, phone: string) => `#/book?call=1&start=${start}${phone.trim() ? `&phone=${encodeURIComponent(phone.trim())}` : ''}`;

/** the customers whose number has these digits (3 at least), the best first */
export function callMatches(all: Customer[], typed: string, docOf: (c: Customer) => SearchDoc | undefined): Customer[] {
  const d = phoneDigits(typed) || typed.replace(/\D/g, '');
  return d.length >= 3 ? searchList(all, d, docOf).slice(0, 5) : [];
}

export default function CallScreen(_p: ScreenProps) {
  const [phone, setPhone] = useState('');
  const found = useMemo(() => callMatches(recentFirst.value, phone, (c) => searchIndex.value.get(c.id)), [phone, recentFirst.value, searchIndex.value]);
  const ICON = { address: MapPin, car: Car, job: Wrench };
  return (
    <Page title={t('booking.call.title')} sub={t('booking.call.sub')} back="/agenda" data-testid="call-screen">
      <div class="stack call">
        <Panel>
          <Field label={t('booking.call.phone')} hint={t('booking.call.phoneHint')}>
            <PhoneInput value={phone} onValue={setPhone} autoFocus />
          </Field>
        </Panel>

        {found.length > 0 && (
          <Panel title={t('booking.call.known', { n: found.length })}>
            <div class="rows" role="list">
              {found.map((c) => <Known key={c.id} c={c} />)}
            </div>
          </Panel>
        )}

        <Panel title={found.length ? t('booking.call.notThem') : t('booking.call.newTitle')} sub={t('booking.call.newSub')}>
          <div class="call-starts">
            {CALL_STARTS.map((s) => {
              const Icon = ICON[s];
              return (
                <a key={s} class="call-start" href={callHref(s, phone)} data-testid={`call-start-${s}`}>
                  <span class="call-start-icon" aria-hidden="true"><Icon size={26} /></span>
                  <span class="call-start-txt"><b>{t(`booking.call.start.${s}`)}</b><span>{t(`booking.call.start.${s}Sub`)}</span></span>
                </a>
              );
            })}
          </div>
        </Panel>
      </div>
    </Page>
  );
}

/** a customer we know: who, which car, where, their next appointment; what to do next */
function Known(p: { c: Customer }) {
  const { c } = p;
  const l = lang.value;
  const cars = vehiclesOf(c.id);
  const now = today();
  const next = jobsOfCustomer(c.id).filter((j) => j.day >= now && !['done', 'cancelled', 'no_show'].includes(j.status)).sort((a, b) => a.day.localeCompare(b.day))[0];
  const first = (c.first_name || '').trim() || customerName(c);
  return (
    <div class="row-item call-known" role="listitem" data-testid="call-known">
      <Avatar name={customerName(c)} />
      <div class="grow stack" style={{ gap: '6px' }}>
        <div>
          <b>{customerName(c)}</b>
          <p class="small muted" style={{ margin: 0 }}>{[c.phone, cars.map(vehicleLabel).filter(Boolean).join(', '), c.address].filter(Boolean).join(', ')}</p>
          {next && <Bit icon={<CalendarClock size={14} aria-hidden="true" />}>{t('booking.call.next', { day: shortDate(next.day, l), block: t(`common.blocks.${next.block}`).toLowerCase() })}</Bit>}
        </div>
        <div class="row-wrap">
          <Button variant="primary" size="sm" icon={<CalendarPlus />} href={`#/book?customer=${c.id}`} data-testid="call-book">{t('booking.call.book', { name: first })}</Button>
          <Button size="sm" icon={<UserRound />} href={`#/customer/${c.id}`}>{t('booking.call.file')}</Button>
          {next && <Button size="sm" icon={<CalendarClock />} href={`#/job/${next.id}`}>{t('booking.call.appointment')}</Button>}
        </div>
      </div>
    </div>
  );
}

/* « Appel entrant » (#/call): the phone rings. Type the number: a customer we know shows right away (name, car, address,
   their next appointment) with « Réserver pour … », their file, their appointment. Somebody new: « Par quoi on commence ? »
   L'adresse (when can we be in their area), La voiture, or La job (what it costs, how long): the booking screen opens in
   that order, the number already typed, the name asked last (#/book?call=1&start=…&phone=…). The rules: calls.ts. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { MapPin, Car, Wrench, CalendarPlus, UserRound, CalendarClock } from 'lucide-preact';
import type { ScreenProps } from '../../platform/router';
import { t, lang } from '../../lib/i18n';
import { today, shortDate } from '../../lib/dates';
import { formatPhone } from '../../lib/text';
import { customerName, vehiclesOf, vehicleLabel, jobsOfCustomer } from '../../data/select';
import type { Customer } from '../../data/types';
import { Page, Panel, Field, PhoneInput, Button, Avatar, Rows, RowItem } from '../../ui';
import { recentFirst, searchIndex } from '../../shared/customers/facts';
import { Bit } from '../../shared/customers/bits';
import { CALL_STARTS, callHref, callMatches, nextWhen } from './calls';
import '../../shared/moment/booking.css';

const ICON = { address: MapPin, car: Car, job: Wrench };
const OVER = ['done', 'cancelled', 'no_show'];

export default function CallScreen(p: ScreenProps) {
  // #/call?phone=…&name=… (the « Appel entrant » banner of a call on the GoHighLevel number): the number already typed
  const qPhone = p.query.get('phone') || '';
  const name = p.query.get('name') || '';
  const [phone, setPhone] = useState(() => (qPhone ? formatPhone(qPhone) : ''));
  useEffect(() => { if (qPhone) setPhone(formatPhone(qPhone)); }, [qPhone]);
  const found = useMemo(() => callMatches(recentFirst.value, phone, (c) => searchIndex.value.get(c.id)), [phone, recentFirst.value, searchIndex.value]);
  return (
    <Page title={t('booking.call.title')} sub={t('booking.call.sub')} back="/agenda" data-testid="call-screen">
      <div class="stack">
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

        <Panel flush title={found.length ? t('booking.call.notThem') : t('booking.call.newTitle')} sub={name && !found.length ? t('booking.ring.newNamed', { name }) : t('booking.call.newSub')}>
          {/* three big rows, one per line: a finger finds them while the other hand holds the phone */}
          <Rows>
            {CALL_STARTS.map((s) => {
              const Icon = ICON[s];
              return <RowItem key={s} href={callHref(s, phone, name)} start={<Icon size={24} aria-hidden="true" />} title={t(`booking.call.start.${s}`)}
                sub={t(`booking.call.start.${s}Sub`)} chevron data-testid={`call-start-${s}`} />;
            })}
          </Rows>
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
  const next = jobsOfCustomer(c.id).filter((j) => j.day >= now && !OVER.includes(j.status)).sort((a, b) => a.day.localeCompare(b.day))[0];
  const first = (c.first_name || '').trim() || customerName(c);
  return (
    <div class="row-item" role="listitem" data-testid="call-known">
      <Avatar name={customerName(c)} />
      <div class="grow stack" style={{ gap: '6px' }}>
        <div>
          <b>{customerName(c)}</b>
          <p class="small muted" style={{ margin: 0 }}>{[c.phone, cars.map(vehicleLabel).filter(Boolean).join(', '), c.address].filter(Boolean).join(', ')}</p>
          {next && <Bit icon={<CalendarClock size={14} aria-hidden="true" />}>{t('booking.call.next', { day: shortDate(next.day, l), block: nextWhen(next, l) })}</Bit>}
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

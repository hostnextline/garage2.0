/* #/customer/:id (?do=edit | text | car): the top (name, flags, Appeler, Texter, Itinéraire, Conversation, Réserver),
   then the panels. Not on the device: a skeleton while the data comes, then « Cette fiche n'est pas sur ce téléphone ». */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Phone, MessageSquareText, MessagesSquare, Navigation, CalendarPlus, Pencil, Users } from 'lucide-preact';
import { ConversationSheet } from '../../shared/customers/ConversationSheet';
import { may, isField } from '../../domain/rights';
import { navigate, setQuery } from '../../platform/router';
import { t } from '../../lib/i18n';
import { e164 } from '../../lib/text';
import { customer, customerName, jobsOfCustomer } from '../../data/select';
import { net } from '../../data/sync';
import { Page, Panel, Button, BigStep, Empty, Skeleton } from '../../ui';
import { factsOf, isUpcoming } from '../../shared/customers/facts';
import { currentDay } from '../../domain/oil/clock';
import { directionsUrl } from '../../shared/places/address';
import { Flags } from '../../shared/customers/bits';
import { NotesPanel } from './NotesPanel';
import { ContactPanel } from './ContactPanel';
import { CarsPanel } from './CarsPanel';
import { JobsPanel } from './JobsPanel';
import { InvoicesPanel } from './InvoicesPanel';
import { QuotesPanel } from './QuotesPanel';
import { EditSheet } from './EditSheet';

export function CustomerFile(p: { id: string; wanted?: string | null }) {
  const [editing, setEditing] = useState(false);
  const [chat, setChat] = useState(false);
  const [addCar, setAddCar] = useState(false);
  // ?do=text (the conversation), ?do=car (add a vehicle) or ?do=edit, from a shortcut menu: cleared first, then opened
  useEffect(() => {
    if (!p.wanted) return;
    const w = p.wanted;
    setQuery({ do: null });
    if (w === 'text') setChat(true);
    else if (w === 'car' && isField()) setAddCar(true);
    else if (w === 'edit' && isField()) setEditing(true);
  }, [p.wanted]);
  // set BEFORE the file is deleted: the row leaves the device at once, and this screen must not show « not on this
  // phone » for the moment before it goes back to the list
  const leaving = useRef(false);
  const c = customer(p.id);
  if (!c) {
    if (leaving.current) return null;
    return (
      <Page class="customers-page" title={t('customers.title')} back="/customers">
        {net.value.ready
          ? <Panel><Empty icon={<Users />} title={t('customers.file.notFound.title')} text={t('customers.file.notFound.text')} action={<Button variant="primary" href="#/customers">{t('customers.file.notFound.action')}</Button>} /></Panel>
          : <Panel><div aria-busy="true"><Skeleton h={22} lines={5} /></div></Panel>}
      </Page>
    );
  }
  const f = factsOf(c.id);
  const canEdit = isField();
  const name = customerName(c);
  const tel = e164(c.phone) || (c.phone ? c.phone.replace(/[^\d+]/g, '') : '');
  const dir = directionsUrl(c);
  // (the day is a signal: « Réserver » changes at midnight on an office computer left open overnight)
  const next = jobsOfCustomer(c.id).some((j) => isUpcoming(j, currentDay.value));
  return (
    <Page class="customers-page" title={name} back="/customers" data-testid="customer-file"
      sub={<Flags c={c} owed={f.owed} noSms />}
      actions={canEdit && <Button icon={<Pencil size={18} />} onClick={() => setEditing(true)} data-testid="customer-edit">{t('common.edit')}</Button>}>
      <div class="customers-top">
      <div class="customers-quick">
        <Button icon={<Phone size={18} />} href={tel ? `tel:${tel}` : undefined} disabled={!tel} title={tel ? undefined : t('customers.file.noPhone')} data-testid="customer-call">{t('common.call')}</Button>
        <Button icon={<MessageSquareText size={18} />} href={tel && c.sms_ok !== false ? `sms:${tel}` : undefined} disabled={!tel || c.sms_ok === false}
          title={!tel ? t('customers.file.noPhone') : c.sms_ok === false ? t('customers.file.noSms') : undefined} data-testid="customer-text">{t('common.text')}</Button>
        <Button icon={<Navigation size={18} />} href={dir || undefined} target="_blank" disabled={!dir} title={dir ? undefined : t('customers.file.noAddress')} data-testid="customer-directions">{t('common.directions')}</Button>
        <Button icon={<MessagesSquare size={18} />} onClick={() => setChat(true)} data-testid="customer-conversation">{t('conversation.open')}</Button>
      </div>
      <ConversationSheet customerId={c.id} open={chat} onClose={() => setChat(false)} />
      {may.book() && (
        <BigStep icon={<CalendarPlus />} label={t('customers.file.book')} href={`#/book?customer=${c.id}`} data-tour="customer-book" data-testid="customer-book"
          sub={next ? t('customers.file.bookSubNext', { name: c.first_name || name }) : t('customers.file.bookSub', { name: c.first_name || name })} />
      )}
      </div>
      <div class="customers-file">
        <div class="customers-side">
          <ContactPanel c={c} canEdit={canEdit} />
          <CarsPanel c={c} cars={f.cars} canEdit={canEdit} adding={addCar} onAdding={setAddCar} />
          <NotesPanel customerId={c.id} canEdit={canEdit} />
        </div>
        <div class="customers-main">
          <JobsPanel c={c} />
          <InvoicesPanel c={c} />
          <QuotesPanel c={c} canEdit={canEdit} />
        </div>
      </div>
      {editing && <EditSheet c={c} onClose={() => setEditing(false)}
        onLeaving={(on) => { leaving.current = on; }}
        onDeleted={() => { setEditing(false); setTimeout(() => navigate('/customers', { replace: true }), 0); }} />}
    </Page>
  );
}

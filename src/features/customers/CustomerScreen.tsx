/* A customer's file (#/customer/:id), and the new customer form (#/customer/new).
   The top says who it is and what to know (flags in words), with Appeler, Texter, Itinéraire and the one next step:
   Réserver. Then the contact details, the cars, the notes; the appointments, the invoices (what is owed stands out)
   and the estimates. Changes are made in a sheet; the duplicate check warns when the phone is already on a file. */
import type { ComponentChildren } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { Phone, MessageSquareText, Navigation, CalendarPlus, Pencil, Plus, Car, Trash2, UserPlus, MapPin, Gauge, Users } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { may, isField } from '../../app/routes';
import { navigate } from '../../app/router';
import { touch } from '../../app/media';
import { useFocusOnMount } from './hooks';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { e164 } from '../../lib/text';
import { today, monthName } from '../../lib/dates';
import { customer, customerName, jobsOfCustomer, invoicesList, invoiceNumber, quotesList, settings, vehicleLabel, vehicle } from '../../data/select';
import { saveCustomer, deleteCustomer } from '../../data/api';
import { can } from '../../data/auth';
import { net } from '../../data/sync';
import type { Customer, Invoice, Quote, Vehicle } from '../../data/types';
import { Page, Panel, Rows, RowItem, Kv, Button, BigStep, Sheet, Switch, Banner, Empty, Skeleton, Pill, Money, InvoicePill, Form, ask, attempt, run, toast, whenHistorySettled, type Tone } from '../../ui';
import { JobTicket } from '../jobs/JobTicket';
import { quoteNumber } from '../invoices/select';
import { quoteTotals } from '../quotes/logic';
import { factsOf, owedOn, isUpcoming, jobOrder } from './facts';
import { draftFromQuery } from './search';
import { CustomerFields, emptyDraft, draftOf, customerPatch, checkDraft, hasErrors, changed, type Draft, type DraftErrors } from './CustomerFields';
import { NotesPanel } from './NotesPanel';
import { VehicleAddSheet } from './VehicleBits';
import { searchPlaces } from './AddressField';
import type { Suggestion } from './photon';
import { oneLine, directionsUrl } from './address';
import { Flags, Plate, Bit, carName, stampDay, dayOfIso } from './bits';
import { km } from './vehicleText';
import './customers.css';

export default function CustomerScreen({ params, query }: ScreenProps) {
  if (params.id === 'new') return <NewCustomer query={query} />;
  return <CustomerFile id={params.id} />;
}

/* ---------- #/customer/new ---------- */
function NewCustomer(p: { query: URLSearchParams }) {
  const [d, setD] = useState<Draft>(() => {
    const typed = draftFromQuery(p.query.get('name') || '');
    return emptyDraft({ first_name: typed.first_name, last_name: typed.last_name, phone: p.query.get('phone') || typed.phone });
  });
  const [errors, setErrors] = useState<DraftErrors>({});
  const [tried, setTried] = useState(false);
  const busy = useRef(false);
  const [saving, setSaving] = useState<'' | 'file' | 'book'>('');
  const set = (patch: Partial<Draft>) => { const n = { ...d, ...patch }; setD(n); if (tried) setErrors(checkDraft(n)); };
  useFocusOnMount(!touch.value, () => document.querySelector<HTMLInputElement>(d.first_name ? '.customers-new input[type=tel]' : '.customers-new [data-testid=cf-first]'));
  const save = async (thenBook: boolean) => {
    if (busy.current) return;
    setTried(true);
    const e = checkDraft(d);
    setErrors(e);
    if (hasErrors(e)) { document.querySelector<HTMLElement>('.customers-new [aria-invalid="true"]')?.focus(); return; }
    busy.current = true;
    setSaving(thenBook ? 'book' : 'file');
    try {
      const id = await run(() => saveCustomer(customerPatch(d)), { ok: t('customers.file.created') });
      if (id) navigate(thenBook ? `/book?customer=${id}` : `/customer/${id}`, { replace: true });
    } finally { busy.current = false; setSaving(''); }
  };
  if (!may.newCustomer()) {
    return <Page class="customers-page" title={t('customers.form.newTitle')} back="/customers"><Panel><Empty title={t('customers.form.noRight')} text={t('common.notAllowed')} /></Panel></Page>;
  }
  return (
    <Page class="customers-page" title={t('customers.form.newTitle')} sub={t('customers.form.newSub')} back="/customers" data-testid="customer-new">
      <Panel class="customers-new">
        <Form onSubmit={() => save(false)} class="stack-lg">
          {tried && hasErrors(errors) && <Banner kind="bad">{t('customers.form.fix')}</Banner>}
          <CustomerFields draft={d} set={set} errors={tried ? errors : {}}
            dupAction={(c) => <Button size="sm" href={`#/customer/${c.id}`} data-testid="dup-open">{t('customers.dup.open')}</Button>} />
          <div class="customers-actions">
            <Button type="submit" variant="primary" icon={<UserPlus size={18} />} busy={saving === 'file'} data-testid="customer-create">{t('customers.form.create')}</Button>
            {may.book() && <Button icon={<CalendarPlus size={18} />} busy={saving === 'book'} onClick={() => save(true)} data-testid="customer-create-book">{t('customers.form.createBook')}</Button>}
          </div>
        </Form>
      </Panel>
    </Page>
  );
}

/* ---------- #/customer/:id ---------- */
function CustomerFile(p: { id: string }) {
  const [editing, setEditing] = useState(false);
  const gone = useRef(false);
  const c = customer(p.id);
  if (!c) {
    if (gone.current) return null;
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
  const upcoming = jobsOfCustomer(c.id).filter((j) => isUpcoming(j)).sort(jobOrder);
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
      </div>
      {may.book() && (
        <BigStep icon={<CalendarPlus />} label={t('customers.file.book')} href={`#/book?customer=${c.id}`} data-tour="customer-book" data-testid="customer-book"
          sub={upcoming[0] ? t('customers.file.bookSubNext', { name: c.first_name || name }) : t('customers.file.bookSub', { name: c.first_name || name })} />
      )}
      </div>
      <div class="customers-file">
        <div class="customers-side">
          <ContactPanel c={c} canEdit={canEdit} />
          <CarsPanel c={c} cars={f.cars} canEdit={canEdit} />
          <NotesPanel customerId={c.id} canEdit={canEdit} />
        </div>
        <div class="customers-main">
          <JobsPanel c={c} />
          <InvoicesPanel c={c} />
          <QuotesPanel c={c} canEdit={canEdit} />
        </div>
      </div>
      {editing && <EditSheet c={c} onClose={() => setEditing(false)} onDeleted={() => { gone.current = true; setEditing(false); setTimeout(() => navigate('/customers', { replace: true }), 0); }} />}
    </Page>
  );
}

/* ---------- Coordonnées ---------- */
function ContactPanel(p: { c: Customer; canEdit: boolean }) {
  const c = p.c;
  const [places, setPlaces] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const addr = oneLine(c, t('customers.address.unitWord'));
  const since = dayOfIso(c.created_at);
  const find = async () => {
    setBusy(true);
    const r = await searchPlaces(oneLine({ address: c.address, postal_code: c.postal_code }));
    setBusy(false);
    if (r.error) toast(t('customers.contact.positionOffline'), { kind: 'bad' });
    else if (!r.places.length) toast(t('customers.contact.positionNone'), { kind: 'bad' });
    else setPlaces(r.places);
  };
  const usePlace = async (s: Suggestion) => {
    if (s.place.lat == null) { toast(t('customers.contact.positionNone'), { kind: 'bad' }); return; }
    const ok = await attempt(() => saveCustomer({ id: c.id, lat: s.place.lat, lng: s.place.lng, ...(c.postal_code ? {} : { postal_code: s.place.postal_code }), ...(c.city ? {} : { city: s.place.city ?? null }) }), { ok: t('customers.contact.positionSaved') });
    if (ok) setPlaces(null);
  };
  const toggle = (k: 'sms_ok' | 'card_on_file', v: boolean) => attempt(() => saveCustomer({ id: c.id, [k]: v }));
  const items: [ComponentChildren, ComponentChildren][] = [
    [t('customers.form.phone'), c.phone && <a href={`tel:${e164(c.phone) || c.phone}`} class="customers-link">{c.phone}</a>],
    [t('customers.form.email'), c.email && <a href={`mailto:${c.email}`} class="customers-link">{c.email}</a>],
    [t('customers.contact.address'), addr && (
      <span class="stack customers-addr">
        <span>{addr}</span>
        {c.lat == null && (
          <span class="customers-hint is-warn">
            <MapPin size={16} aria-hidden="true" /><span class="grow">{t('customers.contact.noPosition')}</span>
            {p.canEdit && <Button size="sm" busy={busy} onClick={find} data-testid="find-position">{t('customers.address.find')}</Button>}
          </span>
        )}
      </span>
    )],
    [t('customers.contact.lang'), c.lang === 'en' ? t('customers.form.langEn') : t('customers.form.langFr')],
    [t('customers.form.notes'), c.notes && <span class="customers-prewrap">{c.notes}</span>]
  ];
  if (!p.canEdit) items.push([t('customers.form.sms'), c.sms_ok !== false ? t('common.yes') : t('common.no')], [t('customers.form.card'), c.card_on_file ? t('common.yes') : t('common.no')]);
  const empty = !c.phone && !c.email && !addr;
  return (
    <Panel title={t('customers.contact.title')} data-testid="contact-panel">
      <div class="stack">
        {empty && <p class="muted" style={{ margin: 0 }}>{t('customers.contact.none')}</p>}
        <Kv items={items} class="customers-kv" />
        {p.canEdit && (
          <div class="customers-switches">
            <Switch checked={c.sms_ok !== false} onChange={(v) => void toggle('sms_ok', v)} label={t('customers.form.sms')} hint={t('customers.form.smsHint')} data-testid="sw-sms" />
            <Switch checked={!!c.card_on_file} onChange={(v) => void toggle('card_on_file', v)} label={t('customers.form.card')} hint={t('customers.form.cardHint')} data-testid="sw-card" />
          </div>
        )}
        {since && <p class="faint small" style={{ margin: 0 }}>{t('customers.contact.since', { month: monthName(since, lang.value) })}</p>}
      </div>
      {places && (
        <Sheet open onClose={() => setPlaces(null)} title={t('customers.contact.pickPosition')} sub={addr}>
          <Rows>
            {places.map((s) => (
              <RowItem key={s.key} start={<MapPin size={20} aria-hidden="true" />} title={s.label} sub={s.sub} onClick={() => void usePlace(s)}
                end={!s.exact ? <Pill tone="warn" dot={false}>{t('customers.contact.streetOnly')}</Pill> : undefined} />
            ))}
          </Rows>
        </Sheet>
      )}
    </Panel>
  );
}

/* ---------- Véhicules ---------- */
function CarsPanel(p: { c: Customer; cars: Vehicle[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <Panel title={t('customers.cars.title')} flush data-testid="cars-panel"
      action={p.canEdit && <Button icon={<Plus size={18} />} onClick={() => setAdding(true)} data-testid="car-add">{t('common.add')}</Button>}>
      {p.cars.length
        ? <Rows>{p.cars.map((v) => (
            <RowItem key={v.id} href={`#/vehicle/${v.id}`} chevron start={<span class="customers-car-icon"><Car size={20} aria-hidden="true" /></span>} title={carName(v)} data-testid="car-row"
              sub={<span class="customers-line"><Plate plate={v.plate} />{v.engine && <Bit>{v.engine}</Bit>}{v.odometer_km != null && <Bit icon={<Gauge size={14} aria-hidden="true" />}>{km(v.odometer_km, lang.value)}</Bit>}</span>} />
          ))}</Rows>
        : <p class="customers-panel-empty muted">{t('customers.cars.none')}</p>}
      {adding && <VehicleAddSheet customerId={p.c.id} onClose={() => setAdding(false)} onAdded={() => setAdding(false)} />}
    </Panel>
  );
}

/* ---------- Rendez-vous ---------- */
function JobsPanel(p: { c: Customer }) {
  const [all, setAll] = useState(false);
  const jobs = jobsOfCustomer(p.c.id);
  const now = today();
  const upcoming = jobs.filter((j) => isUpcoming(j, now)).sort(jobOrder);
  const past = jobs.filter((j) => !isUpcoming(j, now)).sort((a, b) => jobOrder(b, a));
  const shown = all ? past : past.slice(0, 5);
  return (
    <Panel title={t('customers.jobs.title')} sub={jobs.length ? t('customers.jobs.count', { n: jobs.length }) : undefined} data-testid="jobs-panel">
      {!jobs.length && <p class="muted" style={{ margin: 0 }}>{t('customers.jobs.none')}</p>}
      {upcoming.length > 0 && (
        <section class="customers-jobs">
          <h3 class="divider-title">{t('customers.jobs.upcoming')}</h3>
          <div class="stack">{upcoming.map((j) => <JobTicket key={j.id} job={j} showDay />)}</div>
        </section>
      )}
      {past.length > 0 && (
        <section class="customers-jobs">
          <h3 class="divider-title">{t('customers.jobs.past')}</h3>
          <div class="stack">{shown.map((j) => <JobTicket key={j.id} job={j} showDay />)}</div>
          {past.length > shown.length && <Button variant="ghost" onClick={() => setAll(true)} class="customers-showall">{t('customers.jobs.showAll', { n: past.length - shown.length })}</Button>}
        </section>
      )}
    </Panel>
  );
}

/* ---------- Factures ---------- */
const when = (v: Invoice) => v.issued_at || v.created_at || '';
function InvoicesPanel(p: { c: Customer }) {
  const list = invoicesList.value.filter((v) => v.customer_id === p.c.id).sort((a, b) => Number(owedOn(b) > 0) - Number(owedOn(a) > 0) || when(b).localeCompare(when(a)));
  if (!list.length && !can('invoices')) return null;
  const owed = list.reduce((n, v) => n + owedOn(v), 0);
  const unpaid = list.filter((v) => owedOn(v) > 0).length;
  return (
    <Panel title={t('customers.invoices.title')} flush data-testid="invoices-panel">
      {owed > 0 && (
        <div class="customers-owed">
          <Banner kind="bad" title={t('customers.invoices.owed', { amount: money(owed, lang.value) })} data-testid="owed-banner">{t('customers.invoices.owedText', { n: unpaid })}</Banner>
        </div>
      )}
      {list.length
        ? <Rows>{list.map((v) => {
            const left = owedOn(v);
            return (
              <RowItem key={v.id} href={`#/invoice/${v.id}`} chevron class={left > 0 ? 'customers-row-owed' : ''} data-testid="invoice-row"
                title={invoiceNumber(v) || t('customers.invoices.draft')}
                sub={<span class="customers-line"><span>{stampDay(when(v))}</span>{left > 0 && <b class="customers-left">{t('customers.invoices.left', { amount: money(left, lang.value) })}</b>}</span>}
                end={<span class="customers-amount"><Money cents={v.total_cents} /><InvoicePill status={v.status} paidCents={v.paid_cents} /></span>} />
            );
          })}</Rows>
        : <p class="customers-panel-empty muted">{t('customers.invoices.none')}</p>}
    </Panel>
  );
}

/* ---------- Estimations ---------- */
const QUOTE_TONE: Record<Quote['status'], Tone> = { open: 'draft', sent: 'booked', accepted: 'ok', declined: 'cancelled', converted: 'paid' };
function QuotesPanel(p: { c: Customer; canEdit: boolean }) {
  const list = quotesList.value.filter((q) => q.customer_id === p.c.id);
  if (!list.length && !may.quotes()) return null;
  return (
    <Panel title={t('customers.quotes.title')} flush data-testid="quotes-panel"
      action={may.quotes() && p.canEdit && <Button icon={<Plus size={18} />} href={`#/quote/new?customer=${p.c.id}`} data-testid="quote-new">{t('customers.quotes.new')}</Button>}>
      {list.length
        ? <Rows>{list.map((q) => {
            const car = vehicle(q.vehicle_id);
            return (
              <RowItem key={q.id} href={`#/quote/${q.id}`} chevron title={quoteNumber(q) || t('customers.quotes.noNumber')} data-testid="quote-row"
                sub={<span class="customers-line"><span>{stampDay(q.created_at)}</span>{(car || q.vehicle_text) && <Bit icon={<Car size={14} aria-hidden="true" />}>{car ? vehicleLabel(car) : q.vehicle_text}</Bit>}</span>}
                end={<span class="customers-amount"><Money cents={quoteTotals(q.items, settings.value.taxes).total} /><Pill tone={QUOTE_TONE[q.status] || 'muted'}>{t(`customers.quotes.status.${q.status}`)}</Pill></span>} />
            );
          })}</Rows>
        : <p class="customers-panel-empty muted">{t('customers.quotes.none')}</p>}
    </Panel>
  );
}

/* ---------- « Modifier » ---------- */
function EditSheet(p: { c: Customer; onClose: () => void; onDeleted: () => void }) {
  const [d, setD] = useState<Draft>(() => draftOf(p.c));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [tried, setTried] = useState(false);
  const before = useMemo(() => customerPatch(draftOf(p.c)), []);
  const set = (patch: Partial<Draft>) => { const n = { ...d, ...patch }; setD(n); if (tried) setErrors(checkDraft(n)); };
  const diff = changed(before, customerPatch(d));
  const dirty = Object.keys(diff).length > 0;
  const close = async () => {
    if (dirty && !(await ask({ title: t('customers.file.leave.title'), text: t('customers.file.leave.text'), ok: t('customers.file.leave.ok'), danger: true }))) return;
    whenHistorySettled(p.onClose);
  };
  const save = async () => {
    setTried(true);
    const e = checkDraft(d);
    setErrors(e);
    if (hasErrors(e)) return;
    if (!dirty) { p.onClose(); return; }
    if (await attempt(() => saveCustomer({ id: p.c.id, ...diff }), { ok: t('customers.file.saved') })) p.onClose();
  };
  return (
    <Sheet open onClose={() => void close()} title={t('customers.file.editTitle')} data-testid="customer-edit-sheet"
      footer={<>
        <Button onClick={() => void close()}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={save} data-testid="customer-save">{t('common.save')}</Button>
      </>}>
      <div class="stack-lg">
        {tried && hasErrors(errors) && <Banner kind="bad">{t('customers.form.fix')}</Banner>}
        <CustomerFields draft={d} set={set} errors={tried ? errors : {}} exceptId={p.c.id}
          dupAction={(o) => <Button size="sm" href={`#/customer/${o.id}`} data-testid="dup-open">{t('customers.dup.open')}</Button>} />
        <DeleteZone c={p.c} onDeleted={p.onDeleted} />
      </div>
    </Sheet>
  );
}

function DeleteZone(p: { c: Customer; onDeleted: () => void }) {
  if (!can('clients')) return null;
  const upcoming = jobsOfCustomer(p.c.id).some((j) => isUpcoming(j));
  const owed = factsOf(p.c.id).owed;
  const blocked = upcoming ? t('customers.file.deleteBlockedJobs') : owed > 0 ? t('customers.file.deleteBlockedOwed', { amount: money(owed, lang.value) }) : null;
  return (
    <div class="customers-danger">
      <p class="small muted" style={{ margin: 0 }}>{blocked || t('customers.file.deleteHint')}</p>
      <Button variant="danger" icon={<Trash2 size={18} />} disabled={!!blocked} confirm={t('common.confirmDelete')} data-testid="customer-delete"
        onClick={async () => { if (await attempt(() => deleteCustomer(p.c.id), { ok: t('customers.file.deleted') })) p.onDeleted(); }}>{t('customers.file.delete')}</Button>
    </div>
  );
}

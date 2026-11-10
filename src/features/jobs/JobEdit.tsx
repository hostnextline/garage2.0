/* « Modifier le rendez-vous »: every part of a booked appointment can be fixed in place — never delete and book again.
   One list: the customer (booked with the wrong one: job_customer, Part 24 nonies), the car, the address of the
   appointment, the day and block, the truck, the services and prices, the problem and notes. Each row opens its own way
   of changing it (the ones that already existed are reused: MoveSheet, TruckSheet, NotesSheet, the work panel). */
import { useEffect, useState } from 'preact/hooks';
import { User, Car, MapPin, CalendarClock, Truck, Wrench, NotebookPen } from 'lucide-preact';
import type { Job } from '../../data/types';
import { Sheet, Rows, RowItem, Button, Banner, attempt } from '../../ui';
import { t } from '../../lib/i18n';
import { vehicle, vehicleLabel, truckLabel, invoiceOf, itemsOf, customer as customerRow, vehiclesOf } from '../../data/select';
import { updateJob, changeJobCustomer } from '../../data/api';
import { may } from '../../app/routes';
import { CustomerPicker } from '../customers/CustomerPicker';
import { VehiclePicker } from '../customers/VehiclePicker';
import { AddressField, EMPTY_PLACE, type PlaceValue } from '../customers/AddressField';
import { jobCustomer, jobName, dayInSentence, type JobRights } from './select';
import { mayChangeTruck } from './JobParts';

type View = 'list' | 'customer' | 'car' | 'address';
const live = (j: Job) => j.status === 'booked' || j.status === 'en_route' || j.status === 'on_site';
const invoiceDone = (j: Job) => { const v = invoiceOf(j.id); return !!v && v.status !== 'draft' && v.status !== 'void'; };

/** who may fix what (the server checks the same) */
export function editRights(j: Job, r: JobRights) {
  const anyone = r.act || may.book();
  return {
    customer: j.status === 'booked' && (may.book() || r.mine) && !invoiceDone(j),
    car: live(j) && anyone,
    address: (j.status === 'booked' || j.status === 'en_route') && anyone,
    move: j.status === 'booked' && r.move,
    truck: mayChangeTruck(j, r),
    work: live(j) && r.act && !invoiceDone(j),
    notes: r.editNotes
  };
}
export function mayEditJob(j: Job, r: JobRights): boolean { return Object.values(editRights(j, r)).some(Boolean); }

export function EditSheet(p: { job: Job; rights: JobRights; open: boolean; onClose: () => void; onMove: () => void; onTruck: () => void; onNotes: () => void; onWork: () => void }) {
  const j = p.job;
  const r = editRights(j, p.rights);
  const [view, setView] = useState<View>('list');
  const [who, setWho] = useState<string | null>(null);
  const [car, setCar] = useState<string | null>(null);
  const [place, setPlace] = useState<PlaceValue>(EMPTY_PLACE);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (p.open) { setView('list'); setWho(null); setCar(null); } }, [p.open]);
  const c = jobCustomer(j);
  const v = vehicle(j.vehicle_id);
  const items = itemsOf(j.id).filter((i) => !['declined', 'removed'].includes(i.status));
  const go = (fn: () => void) => () => { p.onClose(); fn(); };
  const signed = !!(j.waiver_signed_at || j.estimate_signed_at);

  const saveCustomer = async () => {
    if (!who) return;
    setBusy(true);
    const ok = await attempt(() => changeJobCustomer(j.id, who, car), { ok: t('jobs.edit.customerDone', { name: jobName({ ...j, customer_id: who }) }) });
    setBusy(false);
    if (ok) p.onClose();
  };
  const saveAddress = async () => {
    setBusy(true);
    const ok = await attempt(() => updateJob(j.id, { address: place.address.trim() || null, unit: place.unit, postal_code: place.postal_code, lat: place.lat, lng: place.lng }),
      { ok: place.lat != null ? t('jobs.edit.addressDone') : t('jobs.edit.addressNoPos') });
    setBusy(false);
    if (ok) p.onClose();
  };

  const title = view === 'customer' ? t('jobs.edit.customerTitle') : view === 'car' ? t('jobs.head.carTitle') : view === 'address' ? t('jobs.edit.addressTitle') : t('jobs.edit.title');
  const footer = view === 'customer'
    ? <><Button onClick={() => setView('list')}>{t('common.back')}</Button><Button variant="primary" disabled={!who || who === j.customer_id} busy={busy} onClick={saveCustomer} data-testid="edit-customer-ok">{t('jobs.edit.customerOk')}</Button></>
    : view === 'address'
      ? <><Button onClick={() => setView('list')}>{t('common.back')}</Button><Button variant="primary" disabled={!place.address.trim()} busy={busy} onClick={saveAddress} data-testid="edit-address-ok">{t('jobs.edit.addressOk')}</Button></>
      : view === 'car' ? <Button onClick={() => setView('list')}>{t('common.back')}</Button> : undefined;

  return (
    <Sheet open={p.open} onClose={p.onClose} title={title} sub={jobName(j)} footer={footer} data-testid="job-edit-sheet">
      {view === 'list' && (
        <Rows>
          {r.customer && <RowItem start={<span class="quick-icon"><User size={20} /></span>} title={t('jobs.edit.customer')} sub={c ? jobName(j) : t('jobs.noCustomer')} chevron
            onClick={() => { setWho(null); setCar(null); setView('customer'); }} data-testid="edit-customer" />}
          {r.car && c && <RowItem start={<span class="quick-icon"><Car size={20} /></span>} title={t('jobs.edit.car')} sub={vehicleLabel(v) || t('jobs.head.noCar')} chevron onClick={() => setView('car')} data-testid="edit-car" />}
          {r.address && <RowItem start={<span class="quick-icon"><MapPin size={20} /></span>} title={t('jobs.edit.address')} sub={(j.address || c?.address || t('jobs.head.noAddress'))} chevron
            onClick={() => { setPlace({ ...EMPTY_PLACE, address: j.address || c?.address || '', unit: j.unit ?? c?.unit ?? null, postal_code: j.postal_code ?? c?.postal_code ?? null, lat: j.lat ?? c?.lat ?? null, lng: j.lng ?? c?.lng ?? null }); setView('address'); }} data-testid="edit-address" />}
          {r.move && <RowItem start={<span class="quick-icon"><CalendarClock size={20} /></span>} title={t('jobs.edit.when')} sub={`${dayInSentence(j.day)}, ${t(`common.blocks.${j.block}`).toLowerCase()}`} chevron onClick={go(p.onMove)} data-testid="edit-move" />}
          {r.truck && <RowItem start={<span class="quick-icon"><Truck size={20} /></span>} title={t('jobs.edit.truck')} sub={truckLabel(j.truck_id) || t('jobs.truck.noneYet')} chevron onClick={go(p.onTruck)} data-testid="edit-truck" />}
          {r.work && <RowItem start={<span class="quick-icon"><Wrench size={20} /></span>} title={t('jobs.edit.work')} sub={items.length ? items.map((i) => i.description).join(', ') : t('jobs.edit.noWork')} chevron onClick={go(p.onWork)} data-testid="edit-work" />}
          {r.notes && <RowItem start={<span class="quick-icon"><NotebookPen size={20} /></span>} title={t('jobs.edit.notes')} sub={j.problem || t('jobs.problem.none')} chevron onClick={go(p.onNotes)} data-testid="edit-notes" />}
        </Rows>
      )}
      {view === 'customer' && (
        <div class="stack">
          <p class="muted small" style={{ margin: 0 }}>{t('jobs.edit.customerLead')}</p>
          {signed && <Banner kind="warn">{t('jobs.edit.customerSigned')}</Banner>}
          <CustomerPicker value={who} onPick={(id) => { setWho(id); setCar(null); }} allowCreate autoFocus />
          {who && who === j.customer_id && <Banner kind="info">{t('jobs.edit.customerSame')}</Banner>}
          {who && who !== j.customer_id && vehiclesOf(who).length > 0 && (
            <>
              <h3 class="divider-title">{t('jobs.edit.carOfNew', { name: customerRow(who)?.first_name || '' })}</h3>
              <VehiclePicker customerId={who} value={car} onPick={setCar} />
            </>
          )}
        </div>
      )}
      {view === 'car' && c && (
        <VehiclePicker customerId={c.id} value={j.vehicle_id} onPick={(id) => { if (id && id !== j.vehicle_id) { void attempt(() => updateJob(j.id, { vehicle_id: id }), { ok: t('jobs.head.carSaved') }).then((ok) => { if (ok) p.onClose(); }); } }} />
      )}
      {view === 'address' && (
        <div class="stack">
          <p class="muted small" style={{ margin: 0 }}>{t('jobs.edit.addressLead')}</p>
          <AddressField value={place} onValue={setPlace} autoFocus />
        </div>
      )}
    </Sheet>
  );
}

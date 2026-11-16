/* « Modifier le rendez-vous »: every part of a booked appointment can be fixed in place — never delete and book again.
   One list: the customer (booked with the wrong one: job_customer, Part 24 nonies), the car, the address of the
   appointment, the day and block, the truck, the services and prices, the problem and notes. Each row opens its own way
   of changing it (the ones that already existed are reused: MoveSheet, TruckSheet, NotesSheet, the work panel). */
import { useEffect, useState } from 'preact/hooks';
import { User, Car, MapPin, CalendarClock, Truck, Wrench, NotebookPen } from 'lucide-preact';
import type { Job } from '../../data/types';
import { Sheet, Rows, RowItem, Button, Banner, attempt } from '../../ui';
import { t } from '../../lib/i18n';
import { vehicle, vehicleLabel, truckLabel, itemsOf, customer as customerRow, vehiclesOf } from '../../data/select';
import { updateJob, changeJobCustomer } from '../../data/api';
import { outboxList } from '../../data/sync';
import { CustomerPicker } from '../../shared/customers/CustomerPicker';
import { VehiclePicker } from '../../shared/vehicles/VehiclePicker';
import { AddressField, EMPTY_PLACE, type PlaceValue } from '../../shared/places/AddressField';
import { jobCustomer, jobName, dayInSentence, momentWord, wt } from '../../shared/jobs/select';
import { editRights, type JobRights } from '../../domain/jobs/rights';

type View = 'list' | 'customer' | 'car' | 'address';

/** a row made on this phone a moment ago has reached the server (its insert left the outbox), or `ms` went by: the
    customer just created in the sheet must exist on the server before « Changer de client » names it. Never throws: the
    phone's storage refusing to be read (blocked, full) only means not waiting (the server then says what is missing). */
export async function reached(table: string, id: string, ms = 10000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (!(await outboxList()).some((e) => e.state === 'pending' && e.table === table && e.id === id)) return;
    } catch { return; }
    await new Promise((r) => setTimeout(r, 300));
  }
}
/** the address of the appointment as the form starts: its own (all its fields), else the customer's; never one field of
    each (a unit or a position of the home under another address) */
function placeOf(j: Job, c: ReturnType<typeof jobCustomer>): PlaceValue {
  const own = (j.address || '').trim() ? j : c;
  return { ...EMPTY_PLACE, address: own?.address || '', unit: own?.unit ?? null, postal_code: own?.postal_code ?? null, lat: own?.lat ?? null, lng: own?.lng ?? null };
}

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
    let ok = false;
    try {
      await reached('customers', who);
      if (car) await reached('vehicles', car);
      ok = await attempt(() => changeJobCustomer(j.id, who, car), { ok: t('jobs.edit.customerDone', { name: jobName({ ...j, customer_id: who }) }) });
    } finally { setBusy(false); }
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
            onClick={() => { setPlace(placeOf(j, c)); setView('address'); }} data-testid="edit-address" />}
          {r.move && <RowItem start={<span class="quick-icon"><CalendarClock size={20} /></span>} title={wt(j, 'jobs.edit.when')} sub={`${dayInSentence(j.day)}, ${momentWord(j)}`} chevron onClick={go(p.onMove)} data-testid="edit-move" />}
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
        // never the only car by itself: the view may have been opened to add another one
        <VehiclePicker customerId={c.id} value={j.vehicle_id} autoPick={false}
          onPick={(id) => { if (id && id !== j.vehicle_id) void attempt(() => updateJob(j.id, { vehicle_id: id }), { ok: t('jobs.head.carSaved') }).then((ok) => { if (ok) p.onClose(); }); }} />
      )}
      {view === 'address' && (
        // room kept for the suggestions: when they close (a tap on « Garder cette adresse »), the window does not shrink
        // under the finger and the tap is not lost
        <div class="stack jobs-edit-address">
          <p class="muted small" style={{ margin: 0 }}>{t('jobs.edit.addressLead')}</p>
          <AddressField value={place} onValue={setPlace} autoFocus />
        </div>
      )}
    </Sheet>
  );
}

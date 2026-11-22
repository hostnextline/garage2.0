/* « Qui, quoi, où » of the job sheet: the car (with its km at this visit), the address (and whether it is on the map),
   the truck, the four ways to reach the customer (call, text, directions, the conversation), the customer's note, the
   problem and the team's notes. */
import { useState } from 'preact/hooks';
import { Phone, MessageSquareText, Navigation, Car, MapPin, MapPinOff, Truck, Pencil, MessagesSquare, Gauge } from 'lucide-preact';
import type { Job } from '../../data/types';
import { Panel, Button, IconButton, Sheet, Pill, attempt, run, toast } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { e164, formatPhone } from '../../lib/text';
import { truckLabel, truckColor, vehicle, vehicleLabel } from '../../data/select';
import { updateJob } from '../../data/api';
import { may } from '../../domain/rights';
import { isOpen } from '../../domain/jobs/billing';
import { mapsHref } from '../../domain/jobs/directions';
import type { JobRights } from '../../domain/jobs/rights';
import { ConversationSheet } from '../../shared/customers/ConversationSheet';
import { VehiclePicker } from '../../shared/vehicles/VehiclePicker';
import { locateMissing } from '../../shared/customers/locator';
import { km } from '../../shared/vehicles/vehicleText';
import { jobCustomer, jobName } from '../../shared/jobs/select';
import { askCar, saveCar } from '../../shared/jobs/CarCheckSheet';

/** the km of a visit is noted once the truck is there (and fixed after) */
const KM_STATUS = ['on_site', 'done'];

export function HeadPanel(p: { job: Job; rights: JobRights; onEditNotes: () => void }) {
  const [chat, setChat] = useState(false);
  const [pickCar, setPickCar] = useState(false);
  const mayCar = p.rights.act || may.book();
  const { job: j } = p;
  const c = jobCustomer(j);
  const v = vehicle(j.vehicle_id);
  const car = vehicleLabel(v);
  const addr = (j.address || c?.address || '').trim();
  const unit = (j.unit || c?.unit || '').trim();
  const tel = e164(c?.phone);
  const maps = mapsHref(j, c);
  const truckName = truckLabel(j.truck_id);
  const pickTheCar = (id: string | null) => {
    if (!id || id === j.vehicle_id) return;
    setPickCar(false);
    return attempt(() => updateJob(j.id, { vehicle_id: id }), { ok: t('jobs.head.carSaved') });
  };
  return (
    <Panel class="jobs-head" data-testid="job-head">
      <div class="jobs-lines">
        <div class="jobs-line">
          <Car aria-hidden="true" />
          {v && may.customers()
            ? <a href={`#/vehicle/${v.id}`} class="jobs-link">{car || t('jobs.head.car')}</a>
            : <span class={car ? '' : 'faint'}>{car || t('jobs.head.noCar')}</span>}
          {v?.plate && <span class="jobs-plate" title={t('jobs.head.plate', { plate: v.plate })} aria-label={t('jobs.head.plate', { plate: v.plate })}>{v.plate}</span>}
          {mayCar && c && j.status !== 'done' && j.status !== 'cancelled' && <Button size="sm" variant="ghost" onClick={() => setPickCar(true)} data-testid="job-car-pick">{v ? t('jobs.head.carChange') : t('jobs.head.carAdd')}</Button>}
        </div>
        {/* the km read at this visit (asked at « Je suis arrivé »): noted, or to note once the truck is there */}
        {v && (j.odometer_km != null || (mayCar && KM_STATUS.includes(j.status))) && (
          <div class="jobs-line">
            <Gauge aria-hidden="true" />
            {j.odometer_km != null && <span data-testid="job-km">{t('jobs.car.kmVisit', { km: km(j.odometer_km, lang.value) })}</span>}
            {mayCar && KM_STATUS.includes(j.status) && (
              // the sheet is the answer: the button is free at once (the question is drawn over it)
              <Button size="sm" variant="ghost" onClick={() => { void askCar(j, v).then((a) => a && saveCar(j, v, a)); }} data-testid="job-km-edit">
                {j.odometer_km != null ? t('jobs.car.kmFix') : t('jobs.car.kmAdd')}
              </Button>
            )}
          </div>
        )}
        <div class="jobs-line">
          <MapPin aria-hidden="true" />
          <span class={addr ? '' : 'faint'}>{addr || t('jobs.head.noAddress')}{unit && <span class="muted"> ({t('jobs.head.unit', { unit })})</span>}</span>
        </div>
        <PlaceHint job={j} />
        {truckName && (
          <div class="jobs-line">
            <Truck aria-hidden="true" />
            <span><span class="jobs-dot" style={{ background: truckColor(j.truck_id) }} aria-hidden="true" />{truckName}</span>
          </div>
        )}
      </div>
      <div class="jobs-contacts">
        <Button class="jobs-contact" href={tel ? `tel:${tel}` : undefined} disabled={!tel} icon={<Phone />} title={tel ? formatPhone(c?.phone) : t('jobs.head.noPhone')} data-testid="job-call">{t('common.call')}</Button>
        <Button class="jobs-contact" href={tel ? `sms:${tel}` : undefined} disabled={!tel} icon={<MessageSquareText />} title={tel ? formatPhone(c?.phone) : t('jobs.head.noPhone')}>{t('common.text')}</Button>
        <Button class="jobs-contact" href={maps || undefined} target="_blank" disabled={!maps} icon={<Navigation />} data-testid="job-maps">{t('common.directions')}</Button>
        <Button class="jobs-contact" onClick={() => setChat(true)} disabled={!c} icon={<MessagesSquare />} data-testid="job-conversation">{t('conversation.open')}</Button>
      </div>
      <ConversationSheet customerId={c?.id} open={chat} onClose={() => setChat(false)} />
      {c && <Sheet open={pickCar} onClose={() => setPickCar(false)} title={t('jobs.head.carTitle')} sub={jobName(j)} data-testid="job-car-sheet">
        {/* never the only car by itself: the sheet may have been opened to add another one */}
        <VehiclePicker customerId={c.id} value={j.vehicle_id} onPick={pickTheCar} autoPick={false} />
      </Sheet>}
      {(c?.notes || c?.card_on_file || (c?.no_shows || 0) > 0) && (
        <div class="jobs-note">
          {c?.notes && <p><span class="jobs-note-label">{t('jobs.head.customerNote')}</span>{c.notes}</p>}
          <div class="row-wrap">
            {c?.card_on_file && <Pill tone="ok">{t('jobs.head.cardOnFile')}</Pill>}
            {(c?.no_shows || 0) > 0 && <Pill tone="bad">{t('jobs.head.noShows', { n: c!.no_shows })}</Pill>}
          </div>
        </div>
      )}
      <div class="jobs-problem">
        <div class="between row">
          <h3 class="jobs-h">{t('jobs.problem.title')}</h3>
          {p.rights.editNotes && <IconButton icon={<Pencil />} label={t('jobs.problem.edit')} onClick={p.onEditNotes} data-testid="job-edit-notes" />}
        </div>
        <p class={j.problem ? 'jobs-problem-text' : 'faint'}>{j.problem || t('jobs.problem.none')}</p>
        {j.notes && <p class="jobs-team-notes"><span class="jobs-note-label">{t('jobs.problem.notes')}</span>{j.notes}</p>}
      </div>
    </Panel>
  );
}

/** the address has no position yet (typed without choosing a suggestion, or saved with no network): not on the map, not
    in the route. The appointment's own address is judged by its own position: the customer's home position says nothing
    about it (the planner would send the truck to the home). « Chercher » finds it now (the locator also does it by itself). */
export function placeMissing(j: Pick<Job, 'address' | 'lat'>, c: { address?: string | null; lat?: number | null } | undefined): boolean {
  const own = !!(j.address || '').trim();
  const addr = own ? j.address : c?.address;
  return !!(addr || '').trim() && (own ? j.lat : c?.lat) == null;
}
function PlaceHint(p: { job: Job }) {
  const j = p.job;
  if (!placeMissing(j, jobCustomer(j)) || !may.book() || !isOpen(j.status)) return null;
  const find = async () => {
    const r = await run(() => locateMissing({ only: { jobs: [j.id] }, force: true }));
    if (!r) return;
    if (r.offline) toast(t('customers.contact.positionOffline'), { kind: 'bad' });
    else if (r.found) toast(t('customers.contact.positionSaved'), { kind: 'ok' });
    else toast(t('jobs.head.positionNone'), { kind: 'bad' });
  };
  return (
    <div class="jobs-line jobs-nopos" data-testid="job-no-position">
      <MapPinOff aria-hidden="true" />
      <span class="grow">{t('jobs.head.noPosition')}</span>
      <Button size="sm" onClick={find} data-testid="job-find-position">{t('customers.address.find')}</Button>
    </div>
  );
}

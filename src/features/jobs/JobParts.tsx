/* The pieces of the job sheet around the red button: who and where (with call, text, directions), the problem, the
   authorization, the state once closed, the appointment (length, move), the texts and the live trip, the « … » sheet. */
import { useEffect, useState } from 'preact/hooks';
import { Phone, MessageSquareText, Navigation, Car, MapPin, MapPinOff, Truck, Pencil, Signature, Eye, CalendarClock, Send, Link2, Undo2, UserX, Ban, RotateCcw, CircleCheckBig, Vault, MessagesSquare, ListOrdered, ChevronsUp } from 'lucide-preact';
import type { Job } from '../../data/types';
import { Panel, Button, IconButton, Sheet, Field, Textarea, Stepper, Kv, Rows, RowItem, Banner, Stamp, Pill, Help, attempt, toast, whenHistorySettled, jobStatusWord } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { e164, formatPhone } from '../../lib/text';
import { duration, stamp, clock } from '../../lib/dates';
import { money } from '../../lib/money';
import { truckLabel, truckColor, vehicle, vehicleLabel, messagesOf, activeTrip, settings, invoiceOf, jobsOn, jobTotals } from '../../data/select';
import { updateJob, setJobDuration, moveJob, errorMessage } from '../../data/api';
import { may } from '../../app/routes';
import { ConversationSheet } from '../conversation/ConversationSheet';
import { VehiclePicker } from '../customers/VehiclePicker';
import { locateMissing } from '../../app/locator';
import { BlockPicker, type BlockChoice } from '../booking/BlockPicker';
import type { NextStep } from './nextStep';
import { jobCustomer, jobName, dayWord, dayInSentence, blockRange, clockOf, driverName, clientLinkOf, type JobRights } from './select';
import { stopFirst } from './StopOrderSheet';
import { sendText, sendTracking, trackingSent, doBack, doCancel, doNoShow, doReopen } from './flow';
import { signedWhen } from './WaiverSheet';
import { copyText } from './TextOutcome';
import { JobTicket } from './JobTicket';

/** opens something after a closing sheet gave back its history step (else the step back would close the new one) */
export function afterSheet(fn: () => void) { setTimeout(() => whenHistorySettled(fn), 0); }

function mapsHref(j: Job): string | null {
  const c = jobCustomer(j);
  const addr = (j.address || c?.address || '').trim();
  const lat = j.lat ?? c?.lat, lng = j.lng ?? c?.lng;
  const dest = addr || (lat != null && lng != null ? `${lat},${lng}` : '');
  return dest ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving` : null;
}

/* ---------- who, what car, where; call, text, directions; the problem ---------- */
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
  const maps = mapsHref(j);
  const truckName = truckLabel(j.truck_id);
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
        <VehiclePicker customerId={c.id} value={j.vehicle_id} onPick={(id) => { if (id && id !== j.vehicle_id) { void attempt(() => updateJob(j.id, { vehicle_id: id }), { ok: t('jobs.head.carSaved') }); setPickCar(false); } }} />
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

/* the address has no position yet (typed without choosing a suggestion, or saved with no network): not on the map,
   not in the route; « Chercher » finds it now (the locator also does it by itself) */
function PlaceHint(p: { job: Job }) {
  const j = p.job;
  const c = jobCustomer(j);
  const [busy, setBusy] = useState(false);
  const addr = (j.address || c?.address || '').trim();
  if (!addr || (j.lat ?? c?.lat) != null || !may.book() || !['booked', 'en_route', 'on_site'].includes(j.status)) return null;
  const find = async () => {
    setBusy(true);
    try {
      const r = await locateMissing({ only: { jobs: [j.id] }, force: true });
      if (r.offline) toast(t('customers.contact.positionOffline'), { kind: 'bad' });
      else if (r.found) toast(t('customers.contact.positionSaved'), { kind: 'ok' });
      else toast(t('jobs.head.positionNone'), { kind: 'bad' });
    } finally { setBusy(false); }
  };
  return (
    <div class="jobs-line jobs-nopos" data-testid="job-no-position">
      <MapPinOff aria-hidden="true" />
      <span class="grow">{t('jobs.head.noPosition')}</span>
      <Button size="sm" busy={busy} onClick={() => void find()} data-testid="job-find-position">{t('customers.address.find')}</Button>
    </div>
  );
}

export function NotesSheet(p: { job: Job; open: boolean; onClose: () => void }) {
  const [problem, setProblem] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => { if (p.open) { setProblem(p.job.problem || ''); setNotes(p.job.notes || ''); } }, [p.open]);
  const save = async () => {
    if (await attempt(() => updateJob(p.job.id, { problem: problem.trim() || null, notes: notes.trim() || null }), { ok: t('jobs.problem.saved') })) p.onClose();
  };
  return (
    <Sheet open={p.open} onClose={p.onClose} title={t('jobs.problem.editTitle')}
      footer={<><Button onClick={p.onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save}>{t('common.save')}</Button></>}>
      <div class="stack">
        <Field label={t('jobs.problem.problemLabel')}><Textarea value={problem} onValue={setProblem} rows={3} maxLength={2000} /></Field>
        <Field label={t('jobs.problem.notesLabel')} hint={t('jobs.problem.notesHint')} optional><Textarea value={notes} onValue={setNotes} rows={3} maxLength={2000} /></Field>
      </div>
    </Sheet>
  );
}

/* ---------- the authorization ---------- */
export function WaiverPanel(p: { job: Job; rights: JobRights; onSign: () => void; onSee: () => void }) {
  const { job: j } = p;
  if (!j.waiver_signed_at && (j.status === 'cancelled' || j.status === 'no_show')) return null;
  const signed = !!j.waiver_signed_at;
  // the estimate the customer signed online, and whether the work changed since
  const estimate = j.estimate_signed_at && j.estimate_cents != null ? (() => {
    const now = jobTotals(j.id).total;
    return { signed: money(j.estimate_cents!, lang.value), now: money(now, lang.value), changed: now !== j.estimate_cents && !['done', 'cancelled', 'no_show'].includes(j.status) };
  })() : null;
  return (
    <Panel class={`jobs-waiver${signed ? ' is-signed' : ''}`} data-tour="job-waiver" data-testid="job-waiver">
      <div class="jobs-waiver-row">
        <span class="jobs-waiver-icon" aria-hidden="true">{signed ? <CircleCheckBig /> : <Signature />}</span>
        <div class="grow">
          <h3 class="jobs-h">{t('jobs.waiver.panel')} <Help text={t('jobs.waiver.help')} /></h3>
          <p class="small muted" style={{ margin: 0 }} data-testid="waiver-state">
            {signed ? `${t(j.waiver_via === 'online' ? 'jobs.waiver.signedOnline' : 'jobs.waiver.signedBy', { name: j.waiver_signer || '' })}, ${signedWhen(j.waiver_signed_at)}`
              : j.status === 'on_site' ? t('jobs.waiver.notYet')
                : j.status === 'booked' || j.status === 'en_route' ? t('jobs.waiver.atArrival') : t('jobs.waiver.missing')}
          </p>
          {estimate && (
            <p class={`small ${estimate.changed ? 'jobs-warn-text' : 'muted'}`} style={{ margin: '2px 0 0' }} data-testid="estimate-state">
              {estimate.changed ? t('jobs.waiver.estimateChanged', { signed: estimate.signed, now: estimate.now }) : t('jobs.waiver.estimateSigned', { amount: estimate.signed })}
            </p>
          )}
        </div>
        {signed && j.waiver_attachment && <Button size="sm" variant="ghost" icon={<Eye />} onClick={p.onSee}>{t('jobs.waiver.see')}</Button>}
        {!signed && j.status === 'on_site' && p.rights.act && <Button size="sm" icon={<Signature />} onClick={p.onSign} data-testid="waiver-open">{t('jobs.waiver.sign')}</Button>}
      </div>
    </Panel>
  );
}

/* ---------- when there is no button: done, closed, later, nothing for this person ---------- */
export function StepState(p: { job: Job; step: NextStep; rights: JobRights; onCollect: () => void }) {
  const { job: j, step: s } = p;
  if (s.kind === 'done') {
    const inv = invoiceOf(j.id);
    const next = p.rights.mine ? jobsOn(j.day).find((o) => o.id !== j.id && o.truck_id === j.truck_id && ['on_site', 'en_route', 'booked'].includes(o.status)) : undefined;
    return (
      <div class="stack">
        {/* the PAYÉ stamp is on the invoice (one stamp per screen): here, the words */}
        <section class={`panel glass jobs-state${s.paid ? ' is-paid' : ''}`} data-testid="job-done">
          <CircleCheckBig class="jobs-state-icon" aria-hidden="true" />
          <div class="grow">
            <h2 class="jobs-state-title">{t('jobs.done.title')}</h2>
            {j.finished_at && <p class="muted" style={{ margin: 0 }}>{t('jobs.done.at', { time: clockOf(j.finished_at) })}</p>}
            {j.pay_later && !s.paid && <p class="small" style={{ margin: '6px 0 0' }}>{j.pay_later_reason ? t('jobs.done.laterReason', { reason: j.pay_later_reason }) : t('jobs.done.later')}</p>}
            {!!s.due && <p class="jobs-due">{t('jobs.done.due', { amount: money(s.due, lang.value) })}</p>}
          </div>
          {!!s.due && p.rights.invoice && inv?.status === 'issued' && <Button onClick={p.onCollect} data-testid="job-collect">{t('jobs.done.collect')}</Button>}
        </section>
        {next && <div class="stack jobs-next"><h3 class="jobs-h">{t('jobs.done.next')}</h3><JobTicket job={next} /></div>}
      </div>
    );
  }
  if (s.kind === 'closed') {
    return (
      <section class="panel glass jobs-state" data-testid="job-closed">
        <Stamp kind={j.status === 'no_show' ? 'no_show' : 'cancelled'} class="jobs-stamp" />
        <div class="grow">
          <h2 class="jobs-state-title">{j.status === 'no_show' ? t('jobs.done.no_show') : t('jobs.done.cancelled')}</h2>
          {j.lost_reason && <p class="muted" style={{ margin: 0 }}>{t('jobs.done.reason', { reason: j.lost_reason })}</p>}
        </div>
        {p.rights.reopen && <Button icon={<RotateCcw />} onClick={() => doReopen(j)} data-testid="job-reopen">{t('jobs.done.reopen')}</Button>}
      </section>
    );
  }
  if (s.kind === 'later') {
    return (
      <section class="panel glass jobs-state" data-testid="job-later">
        <CalendarClock class="jobs-state-icon" aria-hidden="true" />
        <div class="grow">
          <h2 class="jobs-state-title">{t('jobs.step.later', { when: dayInSentence(j.day) })}</h2>
          <p class="muted" style={{ margin: 0 }}>{blockRange(j)}. {t('jobs.step.laterSub')}</p>
        </div>
      </section>
    );
  }
  if (s.kind === 'none' && ['booked', 'en_route', 'on_site'].includes(j.status)) {
    const d = driverName(j);
    return <p class="muted jobs-none">{d ? t('jobs.step.none', { name: d }) : t('jobs.step.noneNoDriver')}</p>;
  }
  return null;
}

/* ---------- the appointment ---------- */
function DurationEditor(p: { job: Job }) {
  const { job: j } = p;
  const [v, setV] = useState(j.duration_min);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setV(j.duration_min); setErr(null); }, [j.duration_min]);
  const save = async () => {
    try {
      const r = await setJobDuration(j.id, v);
      toast((r as { queued?: boolean }).queued ? t('shell.queued') : t('jobs.moment.durationSaved', { time: duration(v, lang.value) }), { kind: 'ok' });
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <Field label={t('jobs.moment.durationLabel')} error={err} group>
      <div class="row-wrap">
        <Stepper value={v} onValue={(x) => { setV(x); setErr(null); }} step={15} min={15} max={720} format={(x) => duration(x, lang.value)} label={t('jobs.moment.durationLabel')} />
        {v !== j.duration_min && <Button size="sm" variant="primary" onClick={save} data-testid="duration-save">{t('jobs.moment.keep', { time: duration(v, lang.value) })}</Button>}
      </div>
    </Field>
  );
}
export function MomentPanel(p: { job: Job; rights: JobRights; onMove: () => void; onOrder: () => void }) {
  const { job: j, rights } = p;
  const l = lang.value;
  const booked = j.status === 'booked';
  const stop = j.stop_order != null && !['cancelled', 'no_show'].includes(j.status)
    ? (j.eta_min != null && booked ? t('jobs.moment.stopValue', { n: j.stop_order, time: clock(j.eta_min, l) }) : String(j.stop_order)) : null;
  return (
    <Panel title={t('jobs.moment.title')} help={booked && rights.duration ? t('jobs.moment.help') : undefined} class="jobs-moment" data-testid="job-moment">
      <div class="stack">
        <Kv items={[
          [t('jobs.moment.day'), dayWord(j.day)],
          [t('jobs.moment.block'), t('jobs.moment.blockValue', { block: t(`common.blocks.${j.block}`), range: blockRange(j) })],
          [t('jobs.moment.stop'), stop],
          [t('jobs.moment.truck'), truckLabel(j.truck_id) || null],
          [t('jobs.moment.duration'), booked && rights.duration ? null : duration(j.duration_min, l)],
          [t('jobs.moment.left'), clockOf(j.started_at) || null],
          [t('jobs.moment.arrived'), clockOf(j.arrived_at) || null],
          [t('jobs.moment.finished'), clockOf(j.finished_at) || null]
        ]} />
        {booked && rights.duration && <DurationEditor job={j} />}
        {booked && (rights.move || (rights.order && !!j.truck_id)) && (
          <div class="row-wrap">
            {rights.move && <Button icon={<CalendarClock />} onClick={p.onMove} data-testid="job-move">{t('jobs.moment.move')}</Button>}
            {rights.order && !!j.truck_id && <Button icon={<ListOrdered />} onClick={p.onOrder} data-testid="job-order">{t('jobs.order.open')}</Button>}
          </div>
        )}
      </div>
    </Panel>
  );
}
export function MoveSheet(p: { job: Job; open: boolean; onClose: () => void }) {
  const { job: j } = p;
  const [choice, setChoice] = useState<BlockChoice | null>(null);
  useEffect(() => { if (p.open) setChoice(null); }, [p.open]);
  const c = jobCustomer(j);
  const textOn = !!settings.value.messages?.on?.moved;
  const same = !!choice && choice.day === j.day && choice.block === j.block && !choice.truck_id;
  const move = async () => {
    if (!choice) return;
    try {
      const r = await moveJob(j.id, choice.day, choice.block, choice.truck_id ?? null);
      const d = r.data as { changed?: boolean; unchanged?: boolean } | undefined;
      if (r.queued) toast(t('shell.queued'));
      else if (d?.unchanged) toast(t('jobs.moment.same'));
      else toast(t('jobs.moment.moved', { when: `${dayInSentence(choice.day)}, ${t(`common.blocks.${choice.block}`).toLowerCase()}` }), { kind: 'ok' });
      p.onClose();
      if (!r.queued && !d?.unchanged && textOn) afterSheet(() => { void sendText('moved', j); });
    } catch (e) {
      toast(errorMessage(e), { kind: 'bad' });
    }
  };
  return (
    <Sheet open={p.open} onClose={p.onClose} title={t('jobs.moment.moveTitle')} sub={textOn ? t('jobs.moment.moveLeadText') : t('jobs.moment.moveLead')} wide data-testid="move-sheet"
      footer={<><Button onClick={p.onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!choice || same} onClick={move} data-testid="move-ok">{t('jobs.moment.moveOk')}</Button></>}>
      <BlockPicker lat={j.lat ?? c?.lat ?? null} lng={j.lng ?? c?.lng ?? null} duration={j.duration_min} excludeJob={j.id} value={choice} onPick={setChoice} />
    </Sheet>
  );
}

/* ---------- texts to the customer, the live trip ---------- */
export function TextsPanel(p: { job: Job; rights: JobRights }) {
  const { job: j } = p;
  const msgs = messagesOf(j.id);
  const trip = activeTrip(j.id);
  const l = lang.value;
  const noTracking = j.status === 'en_route' && !trip && !trackingSent.value.has(j.id) && !msgs.some((m) => m.kind === 'en_route') && p.rights.act;
  // arrived without signal (or the text could not go): the invoice to pay during the work is offered again
  const noInvoiceText = j.status === 'on_site' && p.rights.act && !invoiceIssued(j.id) && settings.value.messages?.on?.arrived !== false
    && !msgs.some((m) => m.kind === 'arrived');
  return (
    <Panel title={t('jobs.text.title')} class="jobs-texts" data-testid="job-texts">
      <div class="stack">
        {trip && (
          <div class="jobs-trip" data-testid="job-trip">
            <Navigation aria-hidden="true" />
            <div class="grow">
              <b>{trip.eta_at ? t('jobs.text.tripEta', { time: clockOf(trip.eta_at) }) : t('jobs.text.tripNoEta')}</b>
              <span class="small muted">{t('jobs.text.trip')}{trip.km != null ? `, ${t('jobs.text.tripKm', { km: Number(trip.km).toLocaleString(l === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 1 }) })}` : ''}</span>
            </div>
          </div>
        )}
        {noTracking && (
          <Banner kind="warn" action={<Button size="sm" icon={<Send />} onClick={() => sendTracking(j, { resend: true })} data-testid="send-tracking">{t('jobs.text.sendTracking')}</Button>}>
            {t('jobs.text.noTracking')}
          </Banner>
        )}
        {noInvoiceText && (
          <Banner kind="info" action={<Button size="sm" icon={<Send />} onClick={() => sendText('arrived', j, { okText: t('jobs.did.arriveInvoice', { name: jobName(j) }) })} data-testid="send-arrived">{t('jobs.text.sendArrived')}</Button>}>
            {t('jobs.text.noArrived')}
          </Banner>
        )}
        {msgs.length ? (
          <ul class="jobs-msgs">
            {msgs.map((m) => (
              <li key={m.id}>
                <div class="row between">
                  <b class="small">{t(`jobs.text.kinds.${m.kind}`) === `jobs.text.kinds.${m.kind}` ? m.kind : t(`jobs.text.kinds.${m.kind}`)}</b>
                  <Pill tone={m.status === 'sent' ? 'ok' : m.status === 'failed' ? 'bad' : 'muted'}>{t(`jobs.text.status.${m.status}`) === `jobs.text.status.${m.status}` ? m.status : t(`jobs.text.status.${m.status}`)}</Pill>
                </div>
                <span class="small faint">{stamp(m.created_at, l)}</span>
                {m.body && <p class="jobs-msg-body">{m.body}</p>}
              </li>
            ))}
          </ul>
        ) : <p class="muted" style={{ margin: 0 }}>{t('jobs.text.none')}</p>}
      </div>
    </Panel>
  );
}

/* ---------- « … » ---------- */
const invoiceIssued = (jobId: string) => { const v = invoiceOf(jobId); return !!v && v.status !== 'draft'; };
export function MenuSheet(p: { job: Job; rights: JobRights; open: boolean; onClose: () => void; onMove: () => void; onOrder: () => void; onCoffre?: () => void }) {
  const { job: j, rights } = p;
  const s = j.status;
  const link = clientLinkOf(j.id);
  const then = (fn: () => unknown) => () => { p.onClose(); afterSheet(() => { void fn(); }); };
  const backTo = s === 'en_route' ? 'booked' : s === 'on_site' ? 'en_route' : s === 'done' ? 'on_site' : null;
  const canBack = (s === 'en_route' || s === 'on_site') ? rights.act : s === 'done' ? rights.backFromDone : false;
  const items = [
    s === 'booked' && rights.text && <RowItem key="b" start={<span class="quick-icon"><Send size={20} /></span>} title={t('jobs.menu.resendBooking')} sub={t('jobs.menu.resendBookingSub')} onClick={then(() => sendText('booking', j, { resend: true }))} data-testid="menu-resend" />,
    s === 'en_route' && rights.act && <RowItem key="t" start={<span class="quick-icon"><Navigation size={20} /></span>} title={t('jobs.menu.sendTracking')} sub={t('jobs.menu.sendTrackingSub')} onClick={then(() => sendTracking(j, { resend: true }))} />,
    s === 'on_site' && rights.act && !invoiceIssued(j.id) && <RowItem key="a" start={<span class="quick-icon"><Send size={20} /></span>} title={t('jobs.menu.sendArrived')} sub={t('jobs.menu.sendArrivedSub')} onClick={then(() => sendText('arrived', j, { resend: true, okText: t('jobs.did.arriveInvoice', { name: jobName(j) }) }))} data-testid="menu-send-arrived" />,
    link && <RowItem key="l" start={<span class="quick-icon"><Link2 size={20} /></span>} title={t('jobs.menu.copyLink')} sub={t('jobs.menu.copyLinkSub')}
      onClick={async () => { const ok = await copyText(link); toast(ok ? t('jobs.text.linkCopied') : t('jobs.text.copyFail'), { kind: ok ? 'ok' : 'bad' }); if (ok) p.onClose(); }} data-testid="menu-link" />,
    s === 'booked' && rights.order && !!j.truck_id && <RowItem key="f" start={<span class="quick-icon"><ChevronsUp size={20} /></span>} title={t('jobs.order.firstMenu')} sub={t('jobs.order.firstMenuSub')} onClick={then(() => { void stopFirst(j); })} data-testid="menu-first" />,
    s === 'booked' && rights.order && !!j.truck_id && <RowItem key="o" start={<span class="quick-icon"><ListOrdered size={20} /></span>} title={t('jobs.order.open')} sub={t('jobs.order.openSub')} onClick={then(p.onOrder)} data-testid="menu-order" />,
    s === 'booked' && rights.move && <RowItem key="m" start={<span class="quick-icon"><CalendarClock size={20} /></span>} title={t('jobs.menu.move')} sub={t('jobs.menu.moveSub')} onClick={then(p.onMove)} />,
    canBack && backTo && <RowItem key="u" start={<span class="quick-icon"><Undo2 size={20} /></span>} title={t('jobs.menu.back')} sub={t('jobs.menu.backSub', { status: jobStatusWord(backTo as Job['status']) })} onClick={then(() => doBack(j))} data-testid="menu-back" />,
    (s === 'booked' || s === 'en_route' || s === 'on_site') && rights.act && <RowItem key="n" class="jobs-danger" start={<span class="quick-icon"><UserX size={20} /></span>} title={t('jobs.menu.noShow')} sub={t('jobs.menu.noShowSub')} onClick={then(() => doNoShow(j))} data-testid="menu-noshow" />,
    (s === 'booked' || s === 'en_route') && rights.act && <RowItem key="c" class="jobs-danger" start={<span class="quick-icon"><Ban size={20} /></span>} title={t('jobs.menu.cancel')} sub={t('jobs.menu.cancelSub')} onClick={then(() => doCancel(j))} data-testid="menu-cancel" />,
    p.onCoffre && !j.coffre_id && s !== 'cancelled' && s !== 'no_show' && invoiceOf(j.id)?.status !== 'paid' && <RowItem key="k" start={<span class="quick-icon"><Vault size={20} /></span>} title={t('coffre.job.menu')} sub={t('coffre.job.menuSub')} onClick={then(p.onCoffre)} data-testid="menu-coffre" />,
    (s === 'cancelled' || s === 'no_show') && rights.reopen && <RowItem key="r" start={<span class="quick-icon"><RotateCcw size={20} /></span>} title={t('jobs.menu.reopen')} sub={t('jobs.menu.reopenSub')} onClick={then(() => doReopen(j))} data-testid="menu-reopen" />
  ].filter(Boolean);
  return (
    <Sheet open={p.open} onClose={p.onClose} title={t('jobs.menu.title')} sub={jobName(j)} data-testid="job-menu-sheet">
      {items.length ? <Rows>{items}</Rows> : <p class="muted">{t('jobs.menu.nothing')}</p>}
    </Sheet>
  );
}


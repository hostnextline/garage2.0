/* The sheet of a line of « Rappels d’huile »: call, text, book (the customer and the car already chosen), what to note
   after the call (call back in a week / a month / 3 months, or stop calling for this car), and the corrections of the
   app's reading: « L’huile a été changée à cette visite », « Pas de changement d’huile à cette visite », « Effacer cette
   date ». Everything is kept on the car (followup.ts); each save starts from the car as it is now on the device. */
import { Phone, MessageSquareText, CalendarPlus, UserRound, Droplet, BellOff, RotateCcw, Undo2 } from 'lucide-preact';
import { may } from '../../domain/rights';
import { t } from '../../lib/i18n';
import { addDays, addMonths, type Day } from '../../lib/dates';
import { e164 } from '../../lib/text';
import { customer, customerName, vehicle, staffName } from '../../data/select';
import { saveVehicle } from '../../data/api';
import { me } from '../../data/auth';
import type { Vehicle } from '../../data/types';
import { Button, Pill, Sheet, Kv, Banner, Field, attempt } from '../../ui';
import { whenText } from '../../shared/customers/when';
import { dateShort, dayOfIso } from '../../domain/moment/dayWords';
import type { OilRow } from '../../domain/oil/due';
import { AFTER_OIL_MONTHS } from '../../domain/oil/due';
import { currentDay } from '../../domain/oil/clock';
import { stored, withCall, withNotOil, withoutNotOil, type OilCall } from '../../domain/oil/followup';
import { carOf, dueWords, tone } from './rowWords';

export function OilSheet(p: { row: OilRow | null; onClose: () => void }) {
  const r = p.row;
  if (!r) return null;
  const c = customer(r.customerId);
  const tel = e164(c?.phone);
  const now = currentDay.value;
  const carId = r.vehicleId;
  // the car as it is at the moment of saving (a note made meanwhile on another phone is kept)
  const save = async (patch: (v: Vehicle | undefined) => Partial<Vehicle>, ok: string) => {
    if (!carId) return;
    if (await attempt(() => saveVehicle({ id: carId, ...patch(vehicle(carId)) }), { ok })) p.onClose();
  };
  const call = (o: Pick<OilCall, 'again_on' | 'stop'>): OilCall => ({ at: new Date().toISOString(), by: me.value?.id || null, ...o });
  const again = (day: Day) => save((v) => ({ oil_followup: stored(withCall(v, call({ again_on: day }))) }), t('oil.toast.again', { day: dateShort(day) }));
  const fixedToast = (day: Day) => t('oil.toast.fixed', { day: dateShort(addMonths(day, AFTER_OIL_MONTHS)) });
  // the app read the last visit as « no oil change »: one tap says it had one (a line worded in a way the app did not
  // know, or a « no oil change » said before by mistake: then that word is taken back)
  const missed = carId && r.lastVisit && (!r.lastOil || r.lastOil < r.lastVisit) ? r.lastVisit : null;
  const fix = (day: Day) => (r.lastVisitDenied && r.lastVisitJob
    ? save((v) => ({ oil_followup: stored(withoutNotOil(v, r.lastVisitJob as string)) }), fixedToast(day))
    : save(() => ({ last_oil_on: day }), fixedToast(day)));
  // the app counted an oil change at one of our visits and it was not one (a top-up, a line worded like one)
  const deny = () => (r.oilJob ? save((v) => ({ oil_followup: stored(withNotOil(v, r.oilJob as string)) }), t('oil.toast.denied')) : undefined);
  // the day the customer gave (or « the oil was changed at this visit ») was wrong
  const forget = () => save(() => ({ last_oil_on: null }), t('oil.toast.forgot'));
  const m = r.mark;
  const who = m ? staffName(m.by) : '';
  const said = !m ? null
    : m.stop ? t(who ? 'oil.sheet.saidStop' : 'oil.sheet.saidStopNoName', { at: dateShort(dayOfIso(m.at) || now), name: who })
      : m.again_on ? t(who ? 'oil.sheet.saidAgain' : 'oil.sheet.saidAgainNoName', { at: dateShort(dayOfIso(m.at) || now), name: who, day: dateShort(m.again_on) }) : null;
  const bookHref = `#/book?customer=${r.customerId}${carId ? `&vehicle=${carId}` : ''}`;
  return (
    <Sheet open onClose={p.onClose} title={customerName(c)} sub={carOf(r)} data-testid="oil-sheet">
      <div class="stack-lg">
        <Kv items={[
          [t('oil.sheet.phone'), c?.phone || <span class="muted">{t('oil.sheet.noPhone')}</span>],
          [t('oil.sheet.lastOil'), r.lastOil ? dateShort(r.lastOil) : t('oil.sheet.never')],
          [t('oil.sheet.lastVisit'), r.lastVisit && r.lastOil !== r.lastVisit ? dateShort(r.lastVisit) : null],
          [t('oil.sheet.due'), <Pill tone={tone(r)} dot={false}>{r.late >= 0 || r.state === 'stopped' ? `${dateShort(r.due)} (${dueWords(r).toLowerCase()})` : dateShort(r.due)}</Pill>],
          [t('oil.sheet.next'), r.next ? <a href={`#/job/${r.next.jobId}`}>{whenText(r.next.day, r.next.block, r.next)}</a> : null],
          [t('oil.sheet.said'), said]
        ]} />
        {r.next && <Banner kind="info">{t('oil.sheet.nextHint')}</Banner>}
        {carId && r.oilJob && r.lastOil && (
          <div class="oil-missed" data-testid="oil-counted">
            <p class="small muted" style={{ margin: 0 }}>{t('oil.sheet.countedHint', { day: dateShort(r.lastOil) })}</p>
            <Button icon={<Undo2 size={18} />} confirm={t('oil.sheet.denyConfirm')} onClick={deny} data-testid="oil-deny">{t('oil.sheet.deny')}</Button>
          </div>
        )}
        {carId && r.saidOn && (
          <div class="oil-missed" data-testid="oil-said">
            <p class="small muted" style={{ margin: 0 }}>{t('oil.sheet.saidOnHint', { day: dateShort(r.saidOn) })}</p>
            <Button icon={<Undo2 size={18} />} confirm={t('oil.sheet.forgetConfirm')} onClick={forget} data-testid="oil-forget">{t('oil.sheet.forget')}</Button>
          </div>
        )}
        {missed && (
          <div class="oil-missed" data-testid="oil-missed">
            <p class="small muted" style={{ margin: 0 }}>{t('oil.sheet.missedHint', { day: dateShort(missed) })}</p>
            <Button icon={<Droplet size={18} />} onClick={() => fix(missed)} data-testid="oil-missed-fix">{t('oil.sheet.missedFix')}</Button>
          </div>
        )}
        <div class="oil-actions">
          {tel && <Button variant="primary" icon={<Phone size={18} />} href={`tel:${tel}`} data-testid="oil-call">{t('oil.sheet.call')}</Button>}
          {tel && may.customers() && <Button icon={<MessageSquareText size={18} />} href={`#/customer/${r.customerId}?do=text`} data-testid="oil-text">{t('oil.sheet.text')}</Button>}
          {may.book() && <Button icon={<CalendarPlus size={18} />} href={r.next ? `#/job/${r.next.jobId}?do=edit` : bookHref} data-testid="oil-book">{t('oil.sheet.book')}</Button>}
          <Button variant="ghost" icon={<UserRound size={18} />} href={`#/customer/${r.customerId}`} data-testid="oil-file">{t('oil.sheet.file')}</Button>
        </div>
        {carId ? (
          <Field label={t('oil.sheet.after')} hint={t('oil.sheet.afterHint')} group>
            <div class="oil-after">
              <Button onClick={() => again(addDays(now, 7))} data-testid="oil-in1w">{t('oil.sheet.in1w')}</Button>
              <Button onClick={() => again(addMonths(now, 1))} data-testid="oil-in1m">{t('oil.sheet.in1m')}</Button>
              <Button onClick={() => again(addMonths(now, 3))} data-testid="oil-in3m">{t('oil.sheet.in3m')}</Button>
              {r.state !== 'stopped' && <Button variant="ghost" icon={<BellOff size={18} />} confirm={t('oil.sheet.stopConfirm')}
                onClick={() => save((v) => ({ oil_followup: stored(withCall(v, call({ stop: true }))) }), t('oil.toast.stop'))} data-testid="oil-stop">{t('oil.sheet.stop')}</Button>}
              {m && <Button variant="ghost" icon={<RotateCcw size={18} />} onClick={() => save((v) => ({ oil_followup: stored(withCall(v, null)) }), t('oil.toast.clear'))} data-testid="oil-clear">{t('oil.sheet.clear')}</Button>}
            </div>
          </Field>
        ) : <p class="muted small" style={{ margin: 0 }}>{t('oil.sheet.needCar')}</p>}
      </div>
    </Sheet>
  );
}

/* The summary (who, when, what, which vehicle, the total) and the red button « Réserver » with what it still needs. */
import type { ComponentChildren } from 'preact';
import { CalendarCheck, Wrench } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { duration, today as todayOf } from '../../lib/dates';
import { money } from '../../lib/money';
import { customerName, vehicle as vehicleRow, vehicleLabel, truckLabel } from '../../data/select';
import { Panel, Kv, Money, BigStep } from '../../ui';
import { carDraftLabel } from '../../domain/moment/logic';
import { choiceWords } from '../../domain/moment/choice';
import { blockPhrase } from '../../domain/moment/words';
import { showsFix } from './check';
import { carName } from './CarPanels';
import type { Booking } from './useBooking';

/** the line under « Réserver »: what is missing, else when and how much */
function stepSub(b: Booking): string {
  const { miss, bt, l, d } = b;
  if (miss === 'caller') return t('booking.call.missing');
  if (miss === 'cars') return t('booking.call.missingCar');
  if (miss === 'block') return bt('missing.block');
  if (miss) return t(`booking.missing.${miss}`);
  const total = b.allTotal > 0 ? money(b.allTotal, l) : '';
  if (b.a.walkIn) return [t('booking.walkInSub'), total].filter(Boolean).join(', ');
  const c = d.choice!;
  return [c.block === 'day' ? choiceWords(c, l) : blockPhrase(c.day, c.block, todayOf(), l), total].filter(Boolean).join(', ');
}

export function BookStep(p: { b: Booking; onClick: () => Promise<void> }) {
  const { b } = p;
  const walkIn = b.a.walkIn;
  return (
    <BigStep icon={walkIn ? <Wrench /> : <CalendarCheck />} label={walkIn ? t('booking.confirmWalkIn') : t('booking.confirm')} sub={stepSub(b)}
      disabled={!!b.miss && !showsFix(b.miss)} onClick={p.onClick} data-tour="book-confirm" data-testid="book-confirm" />
  );
}

export function SummaryPanel(p: { b: Booking; step: ComponentChildren }) {
  const { b } = p;
  const { d, l } = b;
  const work = (n: number, minutes: number) => `${t('booking.summary.services', { n })}, ${t('booking.summary.work', { d: duration(minutes, l) })}`;
  const callCar = d.callCars.find((c) => c.id === d.car) || d.callCars[0];
  const who = b.cust ? [customerName(b.cust), vehicleLabel(vehicleRow(d.car))].filter(Boolean).join(', ')
    : b.needNew && d.caller.first.trim() ? [`${d.caller.first} ${d.caller.last}`.trim(), (callCar && carDraftLabel(callCar.draft)) || (d.callCars.length > 1 ? carName(d.car, d.callCars) : '')].filter(Boolean).join(', ')
    : null;
  return (
    <Panel title={t('booking.summary.title')} class="book-summary">
      <Kv items={[
        [t('booking.summary.customer'), who],
        [t('booking.summary.when'), b.a.walkIn ? t('booking.walkInSub') : d.choice ? choiceWords(d.choice, l) : b.bt('summary.noBlock')],
        [t('booking.services.title'), b.cur.items.length ? work(b.cur.items.length, b.sum.minutes) : b.cur.problem.trim() ? t('booking.summary.problemOnly') : t('booking.summary.noWork')],
        ...b.others.map((o) => [carName(o.key, d.callCars), o.work.items.length ? work(o.work.items.length, o.sum.minutes) : t('booking.summary.problemOnly')] as [string, string]),
        [t('booking.summary.truckLabel'), b.effTruck ? truckLabel(b.effTruck) : null]
      ]} />
      <div class="book-total">
        <Money cents={b.allTotal} large />
        <span class="muted small">{t('booking.summary.taxesLabel')}{b.toConfirm ? `, ${t('booking.summary.toConfirm')}` : ''}</span>
      </div>
      {p.step}
    </Panel>
  );
}

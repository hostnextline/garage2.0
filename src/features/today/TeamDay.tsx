/* « La journée » (owner, office): the jobs left open on a past day, each truck now, the money to collect, the proposals
   waiting for the customer, tomorrow's appointments to confirm, the week's needs.
   The treasurer: today's payments and the treasury. */
import { CalendarPlus, CalendarDays, MapIcon, Wallet } from 'lucide-preact';
import { Panel, Rows, RowItem, Button, BigStep, Money, Empty, Banner, Skeleton } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { windowsOn } from '../../data/select';
import { can, hasRole, myTrucks } from '../../data/auth';
import { net } from '../../data/sync';
import { may } from '../../domain/rights';
import { wide } from '../../platform/media';
import { clockOf } from '../../shared/jobs/select';
import { NeedsCard } from '../../shared/stock/needsView';
import { trucksNow, unplacedOn, paymentsOn } from './select';
import { useTick, useToday } from './hooks';
import { ShiftCard } from './ShiftCard';
import { TruckCard } from './TruckCard';
import { OpenBefore } from './OpenBefore';
import { CollectPanel, ProposalsPanel, ConfirmPanel } from './TeamPanels';

export function OfficeDay() {
  const now = useTick(30_000);
  const day = useToday();
  const trucks = trucksNow(day);
  const unplaced = unplacedOn(day);
  const loading = !net.value.ready && !trucks.length;
  const drives = hasRole('mechanic') && myTrucks().length > 0;
  return (
    <div class="today-office">
      {drives && <ShiftCard compact />}
      <div class="today-quick">
        {may.book() && !wide.value && <BigStep icon={<CalendarPlus size={24} />} label={t('today.book')} sub={t(windowsOn.value ? 'today.win.bookSub' : 'today.bookSub')} href="#/book" data-testid="today-book" />}
        <div class="today-quick-links">
          {may.book() && wide.value && <Button variant="primary" icon={<CalendarPlus />} href="#/book">{t('today.book')}</Button>}
          {may.agenda() && <Button icon={<CalendarDays />} href={`#/agenda/${day}`}>{t('today.agenda')}</Button>}
          {may.map() && <Button icon={<MapIcon />} href="#/map">{t('today.map')}</Button>}
        </div>
      </div>
      <OpenBefore day={day} mineOnly={false} />
      <section class="today-section" aria-labelledby="today-trucks">
        <h2 class="today-h" id="today-trucks">{t('today.trucks.title')}</h2>
        {loading ? <div class="today-trucks"><Skeleton h={150} /><Skeleton h={150} /></div>
          : trucks.length ? <div class="today-trucks">{trucks.map((x) => <TruckCard key={x.truck.id} x={x} now={now} day={day} />)}</div>
            : <Panel><Empty title={t('today.trucks.none')} text={t('today.trucks.noneText')} /></Panel>}
        {unplaced.length > 0 && (
          <Banner kind="warn" action={may.agenda() ? <Button size="sm" href={`#/agenda/${day}`}>{t('today.agenda')}</Button> : undefined}>
            {t('today.trucks.unplaced', { n: unplaced.length })}
          </Banner>
        )}
      </section>
      <div class="today-lists">
        {can('invoices') || can('edit_invoices') || can('book') ? <CollectPanel /> : null}
        <ProposalsPanel />
        {can('book') && <ConfirmPanel day={day} />}
        {may.inventory() && <NeedsCard />}
      </div>
    </div>
  );
}

/* ---------- the treasurer ---------- */
export function TreasurerDay() {
  const day = useToday();
  const list = paymentsOn(day);
  const total = list.reduce((n, x) => n + x.payment.amount_cents, 0);
  const l = lang.value;
  return (
    <div class="today-office">
      <Panel title={t('today.payments.title')} flush sub={list.length ? t('today.payments.totalLine', { amount: money(total, l) }) : undefined}
        action={may.treasury() ? <Button size="sm" icon={<Wallet />} href="#/treasury">{t('today.payments.treasury')}</Button> : undefined} data-testid="today-payments">
        {list.length ? (
          <Rows>
            {list.map(({ payment: p, name, jobId }) => (
              <RowItem key={p.id} href={jobId ? `#/job/${jobId}` : undefined} title={name || t('today.payments.unknown')}
                sub={`${t(`today.payments.methods.${p.method}`)}, ${clockOf(p.paid_at)}`} end={<Money cents={p.amount_cents} />} chevron={!!jobId} />
            ))}
          </Rows>
        ) : <p class="muted today-none">{t('today.payments.none')}</p>}
      </Panel>
      {(can('invoices') || can('edit_invoices')) && <div class="today-lists"><CollectPanel /></div>}
    </div>
  );
}

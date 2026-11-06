/* « La journée » (owner, office): each truck now (where, progress, next arrival), the money to collect, the proposals
   waiting for the customer, tomorrow's appointments to confirm (« Envoyer »).
   The treasurer: today's payments and the treasury. */
import { CalendarPlus, CalendarDays, MapIcon, Send, Wallet } from 'lucide-preact';
import { Panel, Rows, RowItem, Button, BigStep, Money, Avatar, Empty, Banner, Skeleton } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { today, addDays, clock } from '../../lib/dates';
import { money } from '../../lib/money';
import { formatPhone } from '../../lib/text';
import { staff, staffName, truckColor, invoiceNumber, activeTrip } from '../../data/select';
import { can, hasRole, myTrucks } from '../../data/auth';
import { net } from '../../data/sync';
import { may } from '../../app/routes';
import { wide } from '../../app/media';
import type { Job } from '../../data/types';
import { sendText } from '../jobs/flow';
import { jobName, jobFirstName, jobCustomer, shortDayWord, blockRange, clockOf, minuteOf } from '../jobs/select';
import { agoText } from './position';
import { trucksNow, unplacedOn, toCollect, proposalsWaiting, toConfirm, paymentsOn, useTick, type TruckNow } from './select';
import { ShiftCard } from './MechanicDay';
import { NeedsCard } from '../inventory/needsView';

/* ---------- each truck, now ---------- */
function nowLine(x: TruckNow): string {
  const c = x.current;
  if (c && x.state === 'en_route') {
    const trip = activeTrip(c.id);
    const eta = minuteOf(trip?.eta_at) ?? c.eta_min;
    return eta != null ? t('today.trucks.enRouteEta', { name: jobFirstName(c), time: clock(eta, lang.value) }) : t('today.trucks.enRoute', { name: jobFirstName(c) });
  }
  if (c && x.state === 'on_site') return c.arrived_at ? t('today.trucks.onSiteSince', { name: jobFirstName(c), time: clockOf(c.arrived_at) }) : t('today.trucks.onSite', { name: jobFirstName(c) });
  if (x.state === 'waiting') return t('today.trucks.waiting');
  if (x.state === 'not_started') return t('today.trucks.notStarted');
  if (x.state === 'finished') return t('today.trucks.finished');
  return t('today.trucks.empty');
}
function TruckCard(p: { x: TruckNow; now: number }) {
  const { x } = p;
  const driver = staff(x.truck.driver_id);
  const target = x.current || x.next;
  const href = target ? `#/job/${target.id}` : may.agenda() ? `#/agenda/${today()}` : undefined;
  const next = x.next && x.next.id !== x.current?.id
    ? (x.next.eta_min != null ? t('today.trucks.next', { name: jobFirstName(x.next), time: clock(x.next.eta_min, lang.value) }) : t('today.trucks.nextNoTime', { name: jobFirstName(x.next) }))
    : '';
  const inner = (
    <>
      <span class="today-truck-top">
        <span class="today-truck-dot" style={{ background: truckColor(x.truck.id) }} aria-hidden="true" />
        <span class="today-truck-name">{x.truck.name}</span>
        <span class="today-truck-driver">
          {driver ? <><Avatar name={driver.full_name} color={driver.color} size="sm" /><span>{staffName(driver.id)}</span></> : <span class="faint">{t('today.trucks.noDriver')}</span>}
        </span>
      </span>
      <span class={`today-truck-now is-${x.state}`}>{nowLine(x)}</span>
      {x.total > 0 && (
        <span class="today-progress" role="img" aria-label={t('today.trucks.progressLabel', { done: x.done, total: x.total })}>
          {x.jobs.map((j) => <span key={j.id} class={`is-${j.status}`} />)}
        </span>
      )}
      {(x.total > 0 || next) && (
        <span class="today-truck-foot">
          {x.total > 0 && <span class="num">{t('today.trucks.progress', { done: x.done, total: x.total })}</span>}
          {next && <span class="ellipsis">{next}</span>}
        </span>
      )}
      <span class="small faint">{x.posAt ? t('today.trucks.position', { ago: agoText(x.posAt, p.now) }) : x.shiftOpen ? t('today.trucks.noPosition') : ''}</span>
    </>
  );
  return href
    ? <a class="today-truck" href={href} data-testid="today-truck">{inner}</a>
    : <div class="today-truck" data-testid="today-truck">{inner}</div>;
}

/* ---------- money to collect ---------- */
function CollectPanel() {
  const list = toCollect();
  const total = list.reduce((n, x) => n + x.due, 0);
  const l = lang.value;
  return (
    <Panel title={t('today.collect.title')} help={t('today.collect.help')} flush sub={list.length ? t('today.collect.total', { amount: money(total, l) }) : undefined} data-testid="today-collect">
      {list.length ? (
        <Rows>
          {list.map((x) => (
            <RowItem key={x.job.id} href={`#/job/${x.job.id}`} title={jobName(x.job)} chevron
              sub={x.job.pay_later ? (x.job.pay_later_reason ? t('today.collect.laterReason', { reason: x.job.pay_later_reason }) : t('today.collect.later'))
                : [x.invoice?.number != null ? t('today.collect.invoice', { number: invoiceNumber(x.invoice) }) : '', shortDayWord(x.job.day)].filter(Boolean).join(', ')}
              end={<Money cents={x.due} />} />
          ))}
        </Rows>
      ) : <p class="muted today-none">{t('today.collect.none')}</p>}
    </Panel>
  );
}
/* ---------- proposals waiting for an answer ---------- */
function ProposalsPanel() {
  const list = proposalsWaiting();
  return (
    <Panel title={t('today.proposals.title')} help={t('today.proposals.help')} flush data-testid="today-proposals">
      {list.length ? (
        <Rows>
          {list.map(({ item, job }) => (
            <RowItem key={item.id} href={`#/job/${job.id}?do=answer&item=${item.id}`} title={jobName(job)} sub={item.description} chevron
              end={<Money cents={Math.round(Number(item.qty) * item.unit_cents)} />} />
          ))}
        </Rows>
      ) : <p class="muted today-none">{t('today.proposals.none')}</p>}
    </Panel>
  );
}
/* ---------- tomorrow's confirmations ---------- */
function ConfirmPanel() {
  const day = addDays(today(), 1);
  const list = toConfirm(day);
  return (
    <Panel title={t('today.confirm.title')} help={t('today.confirm.help')} flush data-testid="today-confirm">
      {list.length ? (
        <Rows>
          {list.map((j: Job) => {
            const c = jobCustomer(j);
            return (
              <RowItem key={j.id}
                title={<a href={`#/job/${j.id}`} class="today-rowlink">{jobName(j)}</a>}
                sub={[blockRange(j), c?.phone ? formatPhone(c.phone) : t('today.confirm.noPhone')].join(', ')}
                end={<Button size="sm" icon={<Send />} label={t('today.confirm.sendLabel', { name: jobName(j) })} onClick={() => sendText('booking', j)} data-testid="confirm-send">{t('today.confirm.send')}</Button>} />
            );
          })}
        </Rows>
      ) : <p class="muted today-none">{t('today.confirm.none')}</p>}
    </Panel>
  );
}

export function OfficeDay() {
  const now = useTick(30_000);
  const trucks = trucksNow();
  const unplaced = unplacedOn();
  const loading = !net.value.ready && !trucks.length;
  const drives = hasRole('mechanic') && myTrucks().length > 0;
  return (
    <div class="today-office">
      {drives && <ShiftCard compact />}
      <div class="today-quick">
        {may.book() && !wide.value && <BigStep icon={<CalendarPlus size={24} />} label={t('today.book')} sub={t('today.bookSub')} href="#/book" data-testid="today-book" />}
        <div class="today-quick-links">
          {may.book() && wide.value && <Button variant="primary" icon={<CalendarPlus />} href="#/book">{t('today.book')}</Button>}
          {may.agenda() && <Button icon={<CalendarDays />} href={`#/agenda/${today()}`}>{t('today.agenda')}</Button>}
          {may.map() && <Button icon={<MapIcon />} href="#/map">{t('today.map')}</Button>}
        </div>
      </div>
      <section class="today-section" aria-labelledby="today-trucks">
        <h2 class="today-h" id="today-trucks">{t('today.trucks.title')}</h2>
        {loading ? <div class="today-trucks"><Skeleton h={150} /><Skeleton h={150} /></div>
          : trucks.length ? <div class="today-trucks">{trucks.map((x) => <TruckCard key={x.truck.id} x={x} now={now} />)}</div>
            : <Panel><Empty title={t('today.trucks.none')} text={t('today.trucks.noneText')} /></Panel>}
        {unplaced.length > 0 && (
          <Banner kind="warn" action={may.agenda() ? <Button size="sm" href={`#/agenda/${today()}`}>{t('today.agenda')}</Button> : undefined}>
            {t('today.trucks.unplaced', { n: unplaced.length })}
          </Banner>
        )}
      </section>
      <div class="today-lists">
        {can('invoices') || can('edit_invoices') || can('book') ? <CollectPanel /> : null}
        <ProposalsPanel />
        {can('book') && <ConfirmPanel />}
        {may.inventory() && <NeedsCard />}
      </div>
    </div>
  );
}

/* ---------- the treasurer ---------- */
export function TreasurerDay() {
  const list = paymentsOn();
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

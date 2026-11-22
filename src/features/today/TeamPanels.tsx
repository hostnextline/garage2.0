/* The lists of « La journée »: the money to collect, the proposals waiting for the customer, and « Demain » (Part 28,
   REARRANGE.md §3.2, C9: in place of « À confirmer pour demain »): tomorrow's appointments, « Réorganiser demain », its
   customers who do not have their hours yet (new or changed) and the ONE button that texts them all (no per-row
   « Envoyer »: two send doors would text a customer twice the same evening). */
import { Send, ListOrdered } from 'lucide-preact';
import { Panel, Rows, RowItem, Button, Money, Pill } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { addDays, longDay } from '../../lib/dates';
import { money } from '../../lib/money';
import { invoiceNumber, jobsOn } from '../../data/select';
import { can } from '../../data/auth';
import { jobName, shortDayWord } from '../../shared/jobs/select';
import { openTell } from '../../shared/jobs/TellHost';
import { openDayOrder } from '../../shared/jobs/DayOrderHost';
import { mayOrderDay } from '../../domain/jobs/dayOrder';
import { phoneTellRows, nameOf, nowWords, wasWords, reasonOf } from '../../shared/jobs/TellSheet';
import { toCollect, proposalsWaiting } from './select';
import type { Collect } from './rules';

/** under a line to collect: « payer plus tard » (and why), else the invoice and the day */
function collectSub(x: Collect): string {
  if (x.job.pay_later) return x.job.pay_later_reason ? t('today.collect.laterReason', { reason: x.job.pay_later_reason }) : t('today.collect.later');
  return [x.invoice?.number != null ? t('today.collect.invoice', { number: invoiceNumber(x.invoice) }) : '', shortDayWord(x.job.day)].filter(Boolean).join(', ');
}

export function CollectPanel() {
  const list = toCollect();
  const total = list.reduce((n, x) => n + x.due, 0);
  const l = lang.value;
  return (
    <Panel title={t('today.collect.title')} help={t('today.collect.help')} flush sub={list.length ? t('today.collect.total', { amount: money(total, l) }) : undefined} data-testid="today-collect">
      {list.length ? (
        <Rows>
          {list.map((x) => <RowItem key={x.job.id} href={`#/job/${x.job.id}`} title={jobName(x.job)} chevron sub={collectSub(x)} end={<Money cents={x.due} />} />)}
        </Rows>
      ) : <p class="muted today-none">{t('today.collect.none')}</p>}
    </Panel>
  );
}

export function ProposalsPanel() {
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

/** « Demain, mardi 25 novembre »: shown when tomorrow has a booked stop (owner / « Réserver »). `day` = today. */
export function TomorrowPanel(p: { day: string }) {
  if (!can('book')) return null;
  const l = lang.value;
  const tomorrow = addDays(p.day, 1);
  const booked = jobsOn(tomorrow).filter((j) => j.status === 'booked');
  if (!booked.length) return null;
  const trucks = new Set(booked.map((j) => j.truck_id).filter(Boolean)).size;
  const rows = phoneTellRows(tomorrow).filter((r) => r.state !== 'drift');
  const n = new Set(rows.map((r) => r.customer_id ?? `job:${r.id}`)).size;
  return (
    <Panel title={t('tell.tomorrowTitle', { day: longDay(tomorrow, l) })} help={t('tell.tomorrowHelp')} flush data-testid="today-tomorrow"
      sub={t('tell.tomorrowSub', { n: booked.length, trucks: t('tell.trucks', { n: trucks }) })}>
      {/* the buttons under the title, not beside it: on a phone the title keeps the whole width */}
      <div class="stack today-none" style={{ paddingBottom: n > 0 ? 0 : undefined }}>
        {n > 0 ? <p class="small" style={{ margin: 0 }} data-testid="today-tomorrow-line"><b>{t('tell.line', { n })}</b></p>
          : <p class="muted" style={{ margin: 0 }} data-testid="today-tomorrow-none">{t('tell.allTomorrow')}</p>}
        <div class="row-wrap">
          {mayOrderDay(tomorrow) && <Button size="sm" icon={<ListOrdered size={16} />} onClick={() => openDayOrder(tomorrow)} data-testid="today-tomorrow-order">{t('reorg.openTomorrow')}</Button>}
          {n > 0 && <Button size="sm" variant="primary" icon={<Send size={16} />} onClick={() => openTell(tomorrow)} data-testid="today-tomorrow-send">{t('tell.button', { n })}</Button>}
        </div>
      </div>
      {n > 0 && (
        <Rows>
          {rows.map((r) => {
            const why = reasonOf(r);
            return (
              <RowItem key={r.id} href={`#/job/${r.id}`} title={nameOf(r)} data-testid="today-tomorrow-row"
                sub={<span style={{ display: 'block', whiteSpace: 'normal' }}><b>{nowWords(r, tomorrow)}</b> <span class="muted">{[wasWords(r), why].filter(Boolean).join(', ')}</span></span>}
                end={r.state === 'new' ? <Pill tone="booked">{t('tell.new')}</Pill> : undefined} chevron />
            );
          })}
        </Rows>
      )}
    </Panel>
  );
}

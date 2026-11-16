/* The lists of « La journée »: the money to collect, the proposals waiting for the customer, tomorrow's appointments to
   confirm (« Envoyer »). */
import { Send } from 'lucide-preact';
import { Panel, Rows, RowItem, Button, Money } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { addDays } from '../../lib/dates';
import { money } from '../../lib/money';
import { formatPhone } from '../../lib/text';
import { invoiceNumber, windowsOn } from '../../data/select';
import { sendText } from '../../shared/jobs/flow';
import { jobName, jobCustomer, shortDayWord, blockRange } from '../../shared/jobs/select';
import { toCollect, proposalsWaiting, toConfirm } from './select';
import type { Collect } from './rules';

/** under a line to collect: « payer plus tard » (and why), else the invoice and the day; work never billed says so */
function collectSub(x: Collect): string {
  if (x.job.pay_later) return x.job.pay_later_reason ? t('today.collect.laterReason', { reason: x.job.pay_later_reason }) : t('today.collect.later');
  if (x.noInvoice) return [t('today.collect.noInvoice'), shortDayWord(x.job.day)].join(', ');
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

export function ConfirmPanel(p: { day: string }) {
  const list = toConfirm(addDays(p.day, 1));
  return (
    <Panel title={t('today.confirm.title')} help={t(windowsOn.value ? 'today.win.confirmHelp' : 'today.confirm.help')} flush data-testid="today-confirm">
      {list.length ? (
        <Rows>
          {list.map((j) => {
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

/* « Factures »: what is owed first (a red banner with the total), then the newest. */
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { invoicesList, invoiceNumber } from '../../data/select';
import { can } from '../../data/auth';
import type { Customer, Invoice } from '../../data/types';
import { Panel, Rows, RowItem, Banner, Money, InvoicePill } from '../../ui';
import { owedOn } from '../../shared/customers/facts';
import { stampDay } from '../../domain/moment/dayWords';

const when = (v: Invoice) => v.issued_at || v.created_at || '';
export function InvoicesPanel(p: { c: Customer }) {
  const list = invoicesList.value.filter((v) => v.customer_id === p.c.id).sort((a, b) => Number(owedOn(b) > 0) - Number(owedOn(a) > 0) || when(b).localeCompare(when(a)));
  if (!list.length && !can('invoices')) return null;
  const owed = list.reduce((n, v) => n + owedOn(v), 0);
  const unpaid = list.filter((v) => owedOn(v) > 0).length;
  return (
    <Panel title={t('customers.invoices.title')} flush data-testid="invoices-panel">
      {owed > 0 && (
        <div class="customers-owed">
          <Banner kind="bad" title={t('customers.invoices.owed', { amount: money(owed, lang.value) })} data-testid="owed-banner">{t('customers.invoices.owedText', { n: unpaid })}</Banner>
        </div>
      )}
      {list.length
        ? <Rows>{list.map((v) => {
            const left = owedOn(v);
            return (
              <RowItem key={v.id} href={`#/invoice/${v.id}`} chevron class={left > 0 ? 'customers-row-owed' : ''} data-testid="invoice-row"
                title={invoiceNumber(v) || t('customers.invoices.draft')}
                sub={<span class="customers-line"><span>{stampDay(when(v))}</span>{left > 0 && <b class="customers-left">{t('customers.invoices.left', { amount: money(left, lang.value) })}</b>}</span>}
                end={<span class="customers-amount"><Money cents={v.total_cents} /><InvoicePill status={v.status} paidCents={v.paid_cents} /></span>} />
            );
          })}</Rows>
        : <p class="customers-panel-empty muted">{t('customers.invoices.none')}</p>}
    </Panel>
  );
}

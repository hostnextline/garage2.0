/* One invoice in « Factures »: number, customer, when (or what is left), the amount, its state, and the bell
   « Relancer » on an unpaid one. A row redraws only when its own invoice changes (memo: hundreds of rows). */
import { memo } from 'preact/compat';
import { BellRing } from 'lucide-preact';
import type { Invoice } from '../../data/types';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { shortDate, dayOf } from '../../lib/dates';
import { IconButton, InvoicePill, Money } from '../../ui';
import { daysSince } from '../../domain/money/invoice';
import { listDate } from '../../domain/money/list';
import { amountsOf, invoiceWho, invoiceLabel } from '../../shared/invoices/select';

export const InvoiceRow = memo(function InvoiceRow(p: { v: Invoice; onRemind: (v: Invoice) => unknown; keepRoom?: boolean }) {
  const { v } = p;
  const l = lang.value;
  const a = amountsOf(v);
  const unpaid = v.status === 'issued';
  const days = unpaid ? daysSince(v.issued_at) : null;
  const when = listDate(v) ? shortDate(dayOf(new Date(listDate(v))), l) : '';
  const sub = unpaid
    ? (a.paid > 0 ? t('invoices.list.subPartial', { when, left: money(a.balance, l) }) : t('invoices.list.subUnpaid', { when, ago: t('invoices.ago', { n: days ?? 0 }) }))
    : v.status === 'draft' ? t('invoices.list.subDraft', { when }) : v.status === 'void' && v.void_reason ? t('invoices.list.subVoid', { when, reason: v.void_reason }) : when;
  const who = invoiceWho(v);
  return (
    <div class="inv-row" role="listitem" data-testid="invoice-row">
      <a class="inv-row-main" href={`#/invoice/${v.id}`}>
        <span class="inv-row-who">
          <span class="inv-row-no">{invoiceLabel(v, l)}</span>
          <span class="inv-row-name">{who}</span>
          <span class={`inv-row-sub${days != null && days > 30 ? ' is-late' : ''}`}>{sub}</span>
        </span>
        <span class="inv-row-end">
          <Money cents={unpaid ? a.balance : a.total} />
          <InvoicePill status={v.status} paidCents={v.paid_cents} />
        </span>
      </a>
      {unpaid && v.job_id
        ? <IconButton icon={<BellRing />} label={t('invoices.list.remind', { who })} onClick={() => p.onRemind(v)} data-testid="invoice-remind" />
        : p.keepRoom && <span class="inv-row-room" aria-hidden="true" />}
    </div>
  );
});

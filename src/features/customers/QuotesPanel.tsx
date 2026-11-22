/* « Estimations »: each estimate (number, day, car, total, status) and « Nouvelle ». */
import { Plus, Car } from 'lucide-preact';
import { may } from '../../domain/rights';
import { t } from '../../lib/i18n';
import { quotesList, settings, vehicleLabel, vehicle } from '../../data/select';
import type { Customer, Quote } from '../../data/types';
import { Panel, Rows, RowItem, Button, Pill, Money, type Tone } from '../../ui';
import { quoteNumber } from '../../shared/invoices/select';
import { quoteTotals } from '../../domain/money/quote';
import { Bit } from '../../shared/customers/bits';
import { stampDay } from '../../domain/moment/dayWords';

const QUOTE_TONE: Record<Quote['status'], Tone> = { open: 'draft', sent: 'booked', accepted: 'ok', declined: 'cancelled', converted: 'paid' };
export function QuotesPanel(p: { c: Customer; canEdit: boolean }) {
  const list = quotesList.value.filter((q) => q.customer_id === p.c.id);
  if (!list.length && !may.quotes()) return null;
  return (
    <Panel title={t('customers.quotes.title')} flush data-testid="quotes-panel"
      action={may.quotes() && p.canEdit && <Button icon={<Plus size={18} />} href={`#/quote/new?customer=${p.c.id}`} data-testid="quote-new">{t('customers.quotes.new')}</Button>}>
      {list.length
        ? <Rows>{list.map((q) => {
            const car = vehicle(q.vehicle_id);
            return (
              <RowItem key={q.id} href={`#/quote/${q.id}`} chevron title={quoteNumber(q) || t('customers.quotes.noNumber')} data-testid="quote-row"
                sub={<span class="customers-line"><span>{stampDay(q.created_at)}</span>{(car || q.vehicle_text) && <Bit icon={<Car size={14} aria-hidden="true" />}>{car ? vehicleLabel(car) : q.vehicle_text}</Bit>}</span>}
                end={<span class="customers-amount"><Money cents={quoteTotals(q.items, settings.value.taxes).total} /><Pill tone={QUOTE_TONE[q.status] || 'muted'}>{t(`customers.quotes.status.${q.status}`)}</Pill></span>} />
            );
          })}</Rows>
        : <p class="customers-panel-empty muted">{t('customers.quotes.none')}</p>}
    </Panel>
  );
}

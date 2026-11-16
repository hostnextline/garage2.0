/* One line of the customers list: the name (+ company), the phone, the first car, the next appointment or the last
   visit, the flags in words. Right-click (computer) or long press (phone): the shortcut menu. Drawn again only when its
   customer or its facts change (a list of hundreds stays smooth while typing). */
import { memo } from 'preact/compat';
import { Phone, Car } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { customerName } from '../../data/select';
import type { Customer } from '../../data/types';
import { RowItem, Avatar, Pill } from '../../ui';
import { openMenu, openMenuAt, pressProps } from '../../ui/ContextMenu';
import { customerActions } from '../../shared/customers/shortcuts';
import type { CustomerFacts } from '../../shared/customers/facts';
import { Flags, Bit } from '../../shared/customers/bits';
import { whenText, nextLine, lastLine } from '../../shared/customers/when';
import { dayWord } from '../../domain/moment/dayWords';
import { carName } from '../../domain/vehicles/words';

/** right-click (computer) or long press (phone) on a customer: the shortcut menu */
function rowMenu(c: Customer) {
  const actions = () => customerActions(c, { edit: true });
  return {
    onContextMenu: (e: MouseEvent) => openMenu(e, actions(), customerName(c)),
    ...pressProps((x, y) => { const a = actions(); if (!a.length) return false; openMenuAt(x, y, a, customerName(c)); })
  };
}

export const CustomerRow = memo(function CustomerRow(p: { c: Customer; f: CustomerFacts; day: string }) {
  const { c, f } = p;
  const name = customerName(c);
  const company = c.company && (c.first_name || c.last_name) ? c.company : null;
  return (
    <RowItem href={`#/customer/${c.id}`} class="customers-row" data-testid="customer-row" chevron events={rowMenu(c) as never}
      start={<Avatar name={name} />}
      title={<>{name}{company && <span class="customers-row-company">{company}</span>}</>}
      sub={<>
        <span class="customers-col">{c.phone ? <Bit icon={<Phone size={14} aria-hidden="true" />}>{c.phone}</Bit> : <span class="faint">{t('customers.noPhone')}</span>}</span>
        <span class="customers-col">{f.cars.length > 0 && <Bit icon={<Car size={14} aria-hidden="true" />}>{carName(f.cars[0])}{f.cars.length > 1 ? ` ${t('customers.carMore', { n: f.cars.length - 1 })}` : ''}</Bit>}</span>
        <span class="customers-col-flags">
          {f.next ? <span class="customers-when-inline"><Pill tone="booked">{nextLine(f.next.day, f.next.block, f.next, p.day)}</Pill></span>
            : f.last ? <span class="customers-when-inline faint">{lastLine(f.last.day)}</span> : null}
          <Flags c={c} owed={f.owed} />
        </span>
      </>}
      end={<When f={f} day={p.day} />} />
  );
});

function When(p: { f: CustomerFacts; day: string }) {
  const { next, last } = p.f;
  if (next) return <span class="customers-when is-next"><span>{t('customers.when.next')}</span><b>{whenText(next.day, next.block, next, p.day)}</b></span>;
  if (last) return <span class="customers-when"><span>{t('customers.when.last')}</span><b>{dayWord(last.day)}</b></span>;
  return <span class="customers-when" />;
}

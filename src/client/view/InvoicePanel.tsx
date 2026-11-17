/* The finished invoice: number, day, car, lines, taxes, total, what was paid, the garage's tax numbers and words, the
   PAYÉ stamp, card payment (or « Appelez-nous ») and « Imprimer ». */
import type { ComponentChildren } from 'preact';
import { Printer } from 'lucide-preact';
import { Button } from '../../ui/Button';
import { shortDate } from '../../lib/dates';
import type { JobView } from '../api';
import { cad, lineCents, localDayOf, qtyText } from '../format';
import { ct, type CLang } from '../i18n';
import { CallUs, Note, Stamp, Sums } from '../ui';
import { Line } from './Line';
import { PayBox } from './PayBox';
import { invoiceBalance, invoicePaid } from './view-state';

/** a sentence with a number that must not break across lines (« Facture F-0043 ») */
function keepTogether(text: string, value: string): ComponentChildren {
  const [a, b = ''] = text.split('\u0001');
  return <>{a}<span style={{ whiteSpace: 'nowrap' }}>{value}</span>{b}</>;
}

export function InvoicePanel(p: { v: JobView; l: CLang; justPaid: boolean; payFailed: string; pendingNote: boolean; onPay: () => Promise<void> }) {
  const { v, l } = p;
  const inv = v.invoice!;
  const paid = invoicePaid(inv);
  const taxed = inv.tps_cents + inv.tvq_cents > 0;
  const issuedDay = inv.issued_at ? localDayOf(inv.issued_at) : null;
  const g = v.garage;
  const footer = l === 'en' ? g.footer_en || g.footer_fr : g.footer_fr || g.footer_en;
  return (
    <section class="cl-panel glass cl-invoice" aria-labelledby="cl-inv" data-testid="client-invoice">
      <div class="cl-inv-head">
        <h2 id="cl-inv">{keepTogether(ct(l, 'invoice.title', { number: '\u0001' }), inv.number)}</h2>
        <div class="cl-inv-meta">
          <div>
            {issuedDay && <p>{ct(l, 'invoice.issued', { date: shortDate(issuedDay, l) })}</p>}
            {v.job.vehicle && <p>{v.job.vehicle}</p>}
          </div>
          {paid && <Stamp l={l} animate={p.justPaid} />}
        </div>
      </div>
      <ul class="cl-lines">
        {(inv.lines || []).map((x, i) => {
          const q = qtyText(x, l);
          return <Line key={i} desc={x.description} l={l} cents={lineCents(x)} meta={q ? <span>{q}</span> : undefined} />;
        })}
      </ul>
      <Sums l={l} class="cl-inv-sums" rows={[[ct(l, 'invoice.subtotal'), inv.subtotal_cents], taxed && [ct(l, 'invoice.tps'), inv.tps_cents], taxed && [ct(l, 'invoice.tvq'), inv.tvq_cents]]} />
      <div class="cl-total">
        <span class="cl-total-label">{ct(l, 'invoice.total')}</span>
        <b class="cl-total-amt" data-testid="client-total">{cad(inv.total_cents, l)}</b>
      </div>
      {inv.paid_cents > 0 && <Sums l={l} rows={[[ct(l, 'invoice.paid'), -inv.paid_cents], [ct(l, 'invoice.balance'), invoiceBalance(inv), true]]} />}
      {(g.tps_no || g.tvq_no) && (
        <p class="cl-taxnos">
          {g.tps_no && <span>{ct(l, 'invoice.tpsNo', { no: g.tps_no })}</span>}
          {g.tvq_no && <span>{ct(l, 'invoice.tvqNo', { no: g.tvq_no })}</span>}
        </p>
      )}
      {inv.notes && <p class="cl-notes">{inv.notes}</p>}
      {footer && <p class="cl-notes cl-muted">{footer}</p>}
      {paid ? (
        <div class="cl-pay"><Note kind="ok">{ct(l, 'invoice.paidThanks')}</Note></div>
      ) : v.pay.available ? (
        <PayBox v={v} l={l} failed={p.payFailed} pendingNote={p.pendingNote} onPay={p.onPay} />
      ) : (
        <div class="cl-pay cl-noprint"><CallUs garage={g} l={l} primary={false} /></div>
      )}
      <div class="cl-tools cl-noprint">
        <Button icon={<Printer />} onClick={() => window.print()} data-testid="client-print">{ct(l, 'invoice.print')}</Button>
      </div>
    </section>
  );
}

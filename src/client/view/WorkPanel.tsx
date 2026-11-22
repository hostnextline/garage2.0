/* The work: the estimate (planned lines, « 159,98 $ + tx », the tax detail, what was paid ahead, the refused extra work,
   the signature) or, once the mechanic is there, the invoice being made with « Payer maintenant ». */
import { Check } from 'lucide-preact';
import type { JobView } from '../api';
import { cad, lineCents, qtyText } from '../format';
import { ct, type CLang } from '../i18n';
import { Note, Sums } from '../ui';
import { EstimateSign } from './EstimateSign';
import { Line } from './Line';
import { PayBox } from './PayBox';
import type { ActResult, Drawn } from './useAppointment';
import { chargesTaxes, isOnSiteBill, sections, workLines } from './view-state';

export function WorkPanel(p: { v: JobView; l: CLang; payFailed: string; pendingNote: boolean; /** a bank debit on its way: no « Payer » */ processing?: boolean; onPay: () => Promise<void>; onSign: (d: Drawn | null) => Promise<ActResult> }) {
  const { v, l } = p;
  const declined = sections(v).declined;
  const taxed = chargesTaxes(v);
  const e = v.expected;
  // the mechanic is there: the invoice being made is what is due, with taxes, and can be paid now
  const onSite = isOnSiteBill(v);
  const work = workLines(v);
  const payable = v.pay.available && !p.processing;
  return (
    <section class="cl-panel glass" aria-labelledby="cl-work" data-testid="client-work">
      <h2 id="cl-work">{ct(l, onSite ? 'work.billTitle' : 'work.title')}</h2>
      {onSite && <p class="cl-sub" data-testid="client-bill-lead">{ct(l, payable ? 'work.billLead' : 'work.billLeadNoPay')}</p>}
      {work.kind === 'bill' ? (
        <ul class="cl-lines" data-testid="client-bill">
          {work.lines.map((x, i) => {
            const q = qtyText(x, l);
            return <Line key={i} desc={x.description} l={l} cents={lineCents(x)} meta={q ? <span>{q}</span> : undefined} />;
          })}
        </ul>
      ) : work.lines.length ? (
        <ul class="cl-lines">
          {work.lines.map((i) => {
            const q = qtyText(i, l);
            const tag = i.status === 'done' ? <span class="cl-tag"><Check aria-hidden="true" />{ct(l, 'work.done')}</span>
              : i.status === 'approved' ? <span class="cl-tag"><Check aria-hidden="true" />{ct(l, 'work.accepted')}</span> : null;
            return <Line key={i.id} desc={i.description} l={l} cents={lineCents(i)} meta={(q || tag) ? <>{q && <span>{q}</span>}{tag}</> : undefined} />;
          })}
        </ul>
      ) : <p class="cl-muted">{ct(l, 'work.none')}</p>}
      {e.total > 0 && (
        <>
          <div class="cl-total">
            <span class="cl-total-label">{ct(l, onSite ? 'work.billTotal' : 'work.expectedNoTax')}</span>
            <b class="cl-total-amt" data-testid="client-expected">{onSite || !taxed ? cad(e.total, l) : `${cad(e.subtotal, l)} ${ct(l, 'work.plusTax')}`}</b>
          </div>
          {taxed && (
            <details class="cl-details">
              <summary>{ct(l, 'work.taxDetail')}</summary>
              <Sums l={l} rows={[[ct(l, 'invoice.subtotal'), e.subtotal], [ct(l, 'invoice.tps'), e.tps], [ct(l, 'invoice.tvq'), e.tvq], [ct(l, 'invoice.total'), e.total, true]]} />
            </details>
          )}
          {v.prepaid_cents > 0 && <Sums l={l} rows={[[ct(l, 'work.prepaid'), -v.prepaid_cents], [ct(l, 'work.left'), Math.max(0, e.total - v.prepaid_cents), true]]} />}
        </>
      )}
      {declined.length > 0 && (
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <h3 class="cl-small cl-muted" style={{ margin: '0 0 var(--sp-2)', fontWeight: 560 }}>{ct(l, 'extras.declinedTitle')}</h3>
          <ul class="cl-lines">
            {declined.map((x) => <Line key={x.id} desc={x.description} l={l} cents={lineCents(x)} off meta={<span class="cl-tag cl-tag-off">{ct(l, 'extras.declined')}</span>} />)}
          </ul>
        </div>
      )}
      <EstimateSign v={v} l={l} onSign={p.onSign} />
      {/* no payment before the work: only once the mechanic is there */}
      {onSite && payable && v.pay.kind === 'prepay' && <PayBox v={v} l={l} now failed={p.payFailed} pendingNote={p.pendingNote} onPay={p.onPay} />}
      {onSite && p.processing && <div class="cl-pay cl-noprint"><Note data-testid="client-pay-processing">{ct(l, 'pay.processing')}</Note></div>}
    </section>
  );
}

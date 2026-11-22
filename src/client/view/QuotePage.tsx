/* An estimate sent before any appointment (#t= of a quote): its lines, total, how long it holds, « Appeler pour
   réserver » and « Imprimer ». Nothing to sign or accept here. */
import { Printer } from 'lucide-preact';
import { Button } from '../../ui/Button';
import { shortDate } from '../../lib/dates';
import type { QuoteView } from '../api';
import { cad, lineCents, montrealToday, qtyText } from '../format';
import { ct, type CLang } from '../i18n';
import { CallUs, Note, PrintIdentity, Sums, garageName } from '../ui';
import { Line } from './Line';

export function QuotePage(p: { v: QuoteView; l: CLang }) {
  const { v, l } = p;
  const taxed = v.totals.tps + v.totals.tvq > 0;
  // the garage's calendar decides (a phone set to another time zone must not expire it early)
  const expired = !!v.valid_until && v.valid_until < montrealToday();
  return (
    <>
      <section class="cl-hero">
        <p class="cl-hello">{ct(l, 'helloAlone')}</p>
        <h1>{ct(l, 'quote.title')}</h1>
        <p class="cl-lead">{ct(l, 'quote.lead', { garage: garageName(v.garage, l) })}</p>
      </section>
      <PrintIdentity garage={v.garage} l={l} />
      <section class="cl-panel glass" aria-labelledby="cl-quote" data-testid="client-quote">
        <div class="cl-inv-head">
          <h2 id="cl-quote">{ct(l, 'quote.number', { number: v.number })}</h2>
          {v.vehicle && <div class="cl-inv-meta"><p>{v.vehicle}</p></div>}
        </div>
        <ul class="cl-lines">
          {v.items.map((x, i) => {
            const q = qtyText(x, l);
            return <Line key={i} desc={x.description} l={l} cents={lineCents(x)} meta={q ? <span>{q}</span> : undefined} />;
          })}
        </ul>
        {taxed && <Sums l={l} rows={[[ct(l, 'invoice.subtotal'), v.totals.subtotal], [ct(l, 'invoice.tps'), v.totals.tps], [ct(l, 'invoice.tvq'), v.totals.tvq]]} />}
        <div class="cl-total">
          <span class="cl-total-label">{ct(l, taxed ? 'quote.total' : 'quote.totalNoTax')}</span>
          <b class="cl-total-amt" data-testid="client-total">{cad(v.totals.total, l)}</b>
        </div>
        {v.valid_until && (expired
          ? <div style={{ marginTop: 'var(--sp-4)' }}><Note kind="warn">{ct(l, 'quote.expired', { date: shortDate(v.valid_until, l) })}</Note></div>
          : <p class="cl-small cl-muted" style={{ margin: 'var(--sp-4) 0 0' }}>{ct(l, 'quote.validUntil', { date: shortDate(v.valid_until, l) })}</p>)}
        <p class="cl-small cl-muted" style={{ margin: 'var(--sp-2) 0 0' }}>{ct(l, 'quote.note')}</p>
        <div class="cl-pay cl-noprint"><CallUs garage={v.garage} l={l} label={ct(l, 'quote.book')} /></div>
        <div class="cl-tools cl-noprint">
          <Button icon={<Printer />} onClick={() => window.print()} data-testid="client-print">{ct(l, 'invoice.print')}</Button>
        </div>
      </section>
    </>
  );
}

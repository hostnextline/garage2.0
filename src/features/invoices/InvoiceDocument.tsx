/* The invoice as the customer reads it, drawn on screen from the same words and numbers as its PDF
   (domain/money/document.ts), with the PAYÉ / ANNULÉE stamp. */
import type { PdfData } from '../../domain/money/document';

/** the invoice as the customer reads it (the same words and numbers as its PDF) */
export function InvoiceDocument(p: { d: PdfData; animate?: boolean }) {
  const d = p.d;
  return (
    <article class="panel glass inv-doc" lang={d.lang === 'en' ? 'en-CA' : 'fr-CA'} aria-label={d.docTitle} data-testid="invoice-document">
      <header class="inv-doc-head">
        <div class="inv-doc-garage">
          <img src="./logo-his.png" alt="" width="52" height="52" />
          <div>
            <b>{d.garage.name}</b>
            {d.garage.lines.map((x, i) => <span key={i}>{x}</span>)}
          </div>
        </div>
        <div class="inv-doc-title">
          <h2>{d.title}</h2>
          {d.number && <span class="inv-doc-no">{d.number}</span>}
          {d.meta.map(([k, v]) => <span key={k}>{k}{d.lang === 'en' ? ': ' : ' : '}{v}</span>)}
        </div>
      </header>
      {(d.to || d.vehicle) && (
        <div class="inv-doc-parties">
          {d.to && <div><span class="inv-doc-label">{d.to.title}</span><p>{d.to.lines.map((x, i) => <span key={i}>{x}<br /></span>)}</p></div>}
          {d.vehicle && <div><span class="inv-doc-label">{d.vehicle.title}</span><p>{d.vehicle.text}</p></div>}
        </div>
      )}
      <table class="inv-table">
        <thead><tr>
          <th scope="col">{d.head[0]}</th><th scope="col" class="num-col col-qty">{d.head[1]}</th>
          <th scope="col" class="num-col col-price">{d.head[2]}</th><th scope="col" class="num-col">{d.head[3]}</th>
        </tr></thead>
        <tbody>
          {d.rows.map((r, i) => (
            <tr key={i}>
              <td>{r[0]}{r[1] !== '1' && <span class="inv-td-sub qty-sub">{r[1]} × {r[2]}</span>}</td>
              <td class="num-col col-qty">{r[1]}</td><td class="num-col col-price">{r[2]}</td><td class="num-col">{r[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.taxNote && <p class="muted small" style={{ margin: 'var(--sp-2) 0 0' }}>{d.taxNote}</p>}
      <div class="inv-doc-bottom">
        <div class="inv-doc-left">
          {d.stamp && (
            <span class={`stamp inv-doc-stamp${d.stamp.tone === 'void' ? ' stamp-muted' : ''}${p.animate && d.stamp.tone === 'paid' ? ' stamp-land' : ''}`}
              role="img" aria-label={d.stamp.text} data-testid={`stamp-${d.stamp.tone}`}>{d.stamp.text}</span>
          )}
          {d.payments && (
            <div>
              <span class="inv-doc-label">{d.payments.title}</span>
              {d.payments.rows.map(([k, v], i) => <p key={i} class="inv-doc-notes between row"><span>{k}</span><span class="money">{v}</span></p>)}
            </div>
          )}
          {d.notes && <div><span class="inv-doc-label">{d.notes.title}</span><p class="inv-doc-notes">{d.notes.text}</p></div>}
        </div>
        <div class="totals">
          {d.totals.map((r, i) => [
            <span key={`l${i}`} class={r.strong ? 'total' : undefined}>{r.label}</span>,
            <span key={`v${i}`} class={`money${r.strong ? ' total' : ''}`}>{r.value}</span>
          ])}
        </div>
      </div>
      {d.footer.length > 0 && <footer class="inv-doc-foot">{d.footer.map((x, i) => <p key={i}>{x}</p>)}</footer>}
    </article>
  );
}

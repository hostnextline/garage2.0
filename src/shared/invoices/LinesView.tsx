/* The lines of an invoice or an estimate, read-only: descriptions as written for the customer, amounts in the
   person's own language, from the one totals rule. */
import type { Lang } from '../../data/types';
import { t, lang as uiLang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { lineCents, unitCents, lineQty, type LineLike } from '../../domain/money/invoice';

export function LinesView(p: { lines: LineLike[]; docLang?: Lang | string }) {
  const l = uiLang.value;
  if (!p.lines.length) return <p class="muted" style={{ margin: 0 }}>{t('invoices.lines.none')}</p>;
  const qtyFmt = new Intl.NumberFormat(l === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 3 });
  return (
    <div class="inv-view" role="list" data-testid="lines-view">
      {p.lines.map((x, i) => {
        const disc = x.kind === 'discount';
        const qty = lineQty(x);
        return (
          <div key={i} class="inv-view-line" role="listitem">
            <span class="grow">
              <span class="inv-view-desc">{x.description}</span>
              {(qty !== 1 || x.taxable === false) && (
                <span class="inv-view-sub">
                  {qty !== 1 && <span>{t('invoices.lines.qtyTimes', { q: qtyFmt.format(qty), p: money(unitCents(x), l) })}</span>}
                  {x.taxable === false && <span>{t('invoices.lines.notTaxable')}</span>}
                </span>
              )}
            </span>
            <span class={`money${disc ? ' is-neg' : ''}`}>{money(lineCents(x), l)}</span>
          </div>
        );
      })}
    </div>
  );
}

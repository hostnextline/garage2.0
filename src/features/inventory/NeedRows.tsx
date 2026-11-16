/* The rows of « Besoins de la semaine »: a need (what | need | in stock | to buy, it opens the appointments it comes
   from) and an appointment to complete (it opens the car, or the job when there is no car). */
import { useState } from 'preact/hooks';
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { job as jobById, customer, customerName } from '../../data/select';
import type { NeedLine, Missing } from '../../domain/stock/needs';
import { lineLabel, qtyWords, dayWord } from '../../shared/stock/needsWords';

export function NeedRow(p: { l: NeedLine }) {
  const { l } = p;
  const [open, setOpen] = useState(false);
  const stock = l.stock == null ? '—' : qtyWords(l, l.stock);
  return (
    <div class={`needs-row${open ? ' is-open' : ''}`} data-testid="needs-row">
      <button type="button" class="needs-row-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="grow needs-row-main">
          <span class="needs-row-name">{lineLabel(l)}</span>
          <span class="small muted">
            {t('inventory.needs.fromJobs', { n: l.jobs.length })}
            <span class="needs-phone">, {t('inventory.needs.needStock', { need: qtyWords(l, l.qty), stock })}</span>
            {!l.sure && <>, <span class="needs-warn">{t('inventory.needs.toConfirm').toLowerCase()}</span></>}
          </span>
        </span>
        <span class="needs-cell num"><span class="sr-only">{t('inventory.needs.cols.need')} </span>{qtyWords(l, l.qty)}</span>
        <span class="needs-cell num muted"><span class="sr-only">{t('inventory.needs.cols.stock')} </span>{stock}</span>
        <span class={`needs-cell num ${l.toBuy > 0 ? 'needs-buy-n' : 'needs-ok'}`}><span class="sr-only">{t('inventory.needs.cols.buy')} </span>{l.toBuy > 0 ? qtyWords(l, l.toBuy) : '✓'}</span>
        <ChevronDown size={18} class="needs-chev" aria-hidden="true" />
      </button>
      {open && (
        <ul class="needs-jobs" role="list">
          {l.jobs.map((j) => {
            const job = jobById(j.jobId);
            const who = job ? customerName(customer(job.customer_id)) : '';
            return (
              <li key={j.jobId}>
                <a href={`#/job/${j.jobId}`} class="needs-job">
                  <span class="grow">{[`#${j.number}`, dayWord(j.day), who].filter(Boolean).join(', ')}<span class="small muted needs-job-car">{j.car || t('inventory.needs.noCar')}{j.sure ? '' : `, ${t('inventory.needs.fromList')}`}</span></span>
                  <span class="num">{qtyWords(l, j.qty)}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function MissingRow(p: { m: Missing }) {
  const { m } = p;
  const vid = jobById(m.jobId)?.vehicle_id;
  const what = m.what.map((x) => t(`inventory.needs.missing.${x}`, { car: m.car })).join(' ');
  const href = vid && !m.what.includes('car') ? `#/vehicle/${vid}` : `#/job/${m.jobId}`;
  return (
    <li>
      <a class="needs-job" href={href} data-testid="needs-missing-row">
        <TriangleAlert size={18} aria-hidden="true" class="needs-warn" />
        <span class="grow">{[`#${m.number}`, dayWord(m.day), m.car].filter(Boolean).join(', ')}<span class="small muted needs-job-car">{what}</span></span>
        <ChevronRight size={18} class="faint" aria-hidden="true" />
      </a>
    </li>
  );
}

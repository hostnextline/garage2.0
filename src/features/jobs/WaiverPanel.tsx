/* The authorization of work on the job sheet: signed (by whom, when, online or on the phone), to sign at the arrival, or
   missing; the estimate the customer signed online and whether what they owe changed since. */
import { Signature, Eye, CircleCheckBig } from 'lucide-preact';
import type { Job } from '../../data/types';
import { Panel, Button, Help } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { jobTotals, invoiceOf } from '../../data/select';
import { estimateChanged } from '../../domain/jobs/billing';
import type { JobRights } from '../../domain/jobs/rights';
import { signedWhen } from './WaiverSheet';

export function WaiverPanel(p: { job: Job; rights: JobRights; onSign: () => void; onSee: () => void }) {
  const { job: j } = p;
  if (!j.waiver_signed_at && (j.status === 'cancelled' || j.status === 'no_show')) return null;
  const signed = !!j.waiver_signed_at;
  // the estimate the customer signed online, and whether what they owe changed since (the draft's total when there is one:
  // the amount the server kept when they signed)
  const estimate = j.estimate_signed_at && j.estimate_cents != null ? (() => {
    const work = jobTotals(j.id).total;
    const inv = invoiceOf(j.id);
    const now = inv && inv.status === 'draft' ? inv.total_cents : work;
    return { signed: money(j.estimate_cents!, lang.value), now: money(now, lang.value), changed: estimateChanged(j.estimate_cents!, work, inv, j.status) };
  })() : null;
  return (
    <Panel class={`jobs-waiver${signed ? ' is-signed' : ''}`} data-tour="job-waiver" data-testid="job-waiver">
      <div class="jobs-waiver-row">
        <span class="jobs-waiver-icon" aria-hidden="true">{signed ? <CircleCheckBig /> : <Signature />}</span>
        <div class="grow">
          <h3 class="jobs-h">{t('jobs.waiver.panel')} <Help text={t('jobs.waiver.help')} /></h3>
          <p class="small muted" style={{ margin: 0 }} data-testid="waiver-state">
            {signed ? `${t(j.waiver_via === 'online' ? 'jobs.waiver.signedOnline' : 'jobs.waiver.signedBy', { name: j.waiver_signer || '' })}, ${signedWhen(j.waiver_signed_at)}`
              : j.status === 'on_site' ? t('jobs.waiver.notYet')
                : j.status === 'booked' || j.status === 'en_route' ? t('jobs.waiver.atArrival') : t('jobs.waiver.missing')}
          </p>
          {estimate && (
            <p class={`small ${estimate.changed ? 'jobs-warn-text' : 'muted'}`} style={{ margin: '2px 0 0' }} data-testid="estimate-state">
              {estimate.changed ? t('jobs.waiver.estimateChanged', { signed: estimate.signed, now: estimate.now }) : t('jobs.waiver.estimateSigned', { amount: estimate.signed })}
            </p>
          )}
        </div>
        {signed && j.waiver_attachment && <Button size="sm" variant="ghost" icon={<Eye />} onClick={p.onSee}>{t('jobs.waiver.see')}</Button>}
        {!signed && j.status === 'on_site' && p.rights.act && <Button size="sm" icon={<Signature />} onClick={p.onSign} data-testid="waiver-open">{t('jobs.waiver.sign')}</Button>}
      </div>
    </Panel>
  );
}

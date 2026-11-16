/* « Les textos » of the job sheet: the live trip (arrival time, km), the texts the customer did not get (with « Envoyer »),
   and every text sent for this job. */
import { Navigation, Send } from 'lucide-preact';
import type { Job } from '../../data/types';
import { Panel, Button, Banner, Pill } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { stamp } from '../../lib/dates';
import { messagesOf, activeTrip, settings, invoiceOf, jobTotals } from '../../data/select';
import { isFinished } from '../../domain/jobs/billing';
import { textGaps } from '../../domain/jobs/texts';
import type { JobRights } from '../../domain/jobs/rights';
import { jobName, clockOf } from '../../shared/jobs/select';
import { pendingJobs } from '../../shared/jobs/pending';
import { sendText, sendTracking, trackingSent } from '../../shared/jobs/texts';

/** a word of the dictionary, else the server's own value (a kind or a status the app does not know yet) */
const word = (key: string, raw: string) => { const s = t(key); return s === key ? raw : s; };

export function TextsPanel(p: { job: Job; rights: JobRights }) {
  const { job: j } = p;
  const msgs = messagesOf(j.id);
  const trip = activeTrip(j.id);
  const l = lang.value;
  const gaps = textGaps({
    status: j.status, act: p.rights.act, msgs, trip: !!trip, trackingSent: trackingSent.value.has(j.id),
    leaveWaiting: !!pendingJobs().steps.get(j.id)?.some((s) => s.action === 'leave'),
    invoiceDone: isFinished(invoiceOf(j.id)),
    // arrived without signal (or the text could not go): the invoice to pay during the work is offered again, when it has
    // something to bill
    arrivalOn: settings.value.messages?.on?.arrived !== false && !j.coffre_id && jobTotals(j.id).total > 0
  });
  return (
    <Panel title={t('jobs.text.title')} class="jobs-texts" data-testid="job-texts">
      <div class="stack">
        {trip && (
          <div class="jobs-trip" data-testid="job-trip">
            <Navigation aria-hidden="true" />
            <div class="grow">
              <b>{trip.eta_at ? t('jobs.text.tripEta', { time: clockOf(trip.eta_at) }) : t('jobs.text.tripNoEta')}</b>
              <span class="small muted">{t('jobs.text.trip')}{trip.km != null ? `, ${t('jobs.text.tripKm', { km: Number(trip.km).toLocaleString(l === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 1 }) })}` : ''}</span>
            </div>
          </div>
        )}
        {gaps.noTracking && (
          <Banner kind="warn" action={<Button size="sm" icon={<Send />} onClick={() => sendTracking(j, { resend: true, driving: p.rights.mine })} data-testid="send-tracking">{t('jobs.text.sendTracking')}</Button>}>
            {t('jobs.text.noTracking')}
          </Banner>
        )}
        {gaps.noInvoiceText && (
          <Banner kind="info" action={<Button size="sm" icon={<Send />} onClick={() => sendText('arrived', j, { okText: t('jobs.did.arriveInvoice', { name: jobName(j) }) })} data-testid="send-arrived">{t('jobs.text.sendArrived')}</Button>}>
            {t('jobs.text.noArrived')}
          </Banner>
        )}
        {msgs.length ? (
          <ul class="jobs-msgs">
            {msgs.map((m) => (
              <li key={m.id}>
                <div class="row between">
                  <b class="small">{word(`jobs.text.kinds.${m.kind}`, m.kind)}</b>
                  <Pill tone={m.status === 'sent' ? 'ok' : m.status === 'failed' ? 'bad' : 'muted'}>{word(`jobs.text.status.${m.status}`, m.status)}</Pill>
                </div>
                <span class="small faint">{stamp(m.created_at, l)}</span>
                {m.body && <p class="jobs-msg-body">{m.body}</p>}
              </li>
            ))}
          </ul>
        ) : <p class="muted" style={{ margin: 0 }}>{t('jobs.text.none')}</p>}
      </div>
    </Panel>
  );
}

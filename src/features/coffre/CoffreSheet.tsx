/* « Payé par le Coffre » (the owner, or the mechanic of the job’s truck, Part 22): the jobs of this customer that family or friends paid this way (this one is
   checked), what was given, a note. Those jobs get no invoice and no taxes; they are written in the Coffre, apart. */
import { useEffect, useState } from 'preact/hooks';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { longDay, today } from '../../lib/dates';
import { allJobs, customer as customerRow, customerName, invoiceOf, jobTotals, paymentsOf } from '../../data/select';
import { coffreAdd } from '../../data/api';
import type { Job } from '../../data/types';
import { Sheet, Button, Field, MoneyInput, Textarea, DateInput, Check, Banner, run } from '../../ui';
import { coffreCandidates } from './logic';
import './coffre.css';

export function CoffreSheet(p: { job: Job; open: boolean; onClose: () => void; onDone?: () => void }) {
  if (!p.open) return null;
  return <CoffreOpen {...p} />;
}

function CoffreOpen(p: { job: Job; onClose: () => void; onDone?: () => void }) {
  const l = lang.value;
  const prepaid = (jobId: string) => paymentsOf({ jobId }).length > 0;
  // the mechanic: the jobs his trucks do (as the server allows); the owner: all of them
  // every member of the team may put the customer's jobs in the Coffre (the server says the same, coffre_may_add)
  const list = coffreCandidates(p.job, allJobs.value, (id) => invoiceOf(id), prepaid).slice(0, 30);
  const [picked, setPicked] = useState<string[]>(() => list.some((j) => j.id === p.job.id) ? [p.job.id] : []);
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [day, setDay] = useState(today());
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setErr(null); }, [picked.join(','), amount]);
  const value = picked.reduce((n, id) => n + jobTotals(id).subtotal, 0);
  const who = customerName(customerRow(p.job.customer_id));
  const toggle = (id: string, on: boolean) => setPicked((x) => (on ? [...x, id] : x.filter((y) => y !== id)));
  const save = async () => {
    if (!picked.length) { setErr(t('coffre.sheet.pickOne')); return; }
    if (amount == null || amount < 0) { setErr(t('coffre.sheet.amountNeeded')); return; }
    const r = await run(() => coffreAdd(picked, amount, note.trim() || null, day), { ok: t('coffre.sheet.done', { n: picked.length }) });
    if (r) { p.onClose(); p.onDone?.(); }
  };
  return (
    <Sheet open onClose={p.onClose} title={t('coffre.sheet.title')} sub={who} data-testid="coffre-sheet"
      footer={<><Button onClick={p.onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="coffre-save">{t('coffre.sheet.save')}</Button></>}>
      <div class="stack">
        <p class="small muted" style={{ margin: 0 }}>{t('coffre.sheet.lead')}</p>
        <Field label={t('coffre.sheet.jobs')} group>
          <div class="coffre-jobs" data-testid="coffre-jobs">
            {!list.length && <p class="muted small" style={{ margin: 0 }}>{t('coffre.sheet.noJob')}</p>}
            {list.map((j) => (
              <Check key={j.id} checked={picked.includes(j.id)} onChange={(on) => toggle(j.id, on)} data-testid={`coffre-job-${j.id}`}
                label={<span>{t('coffre.sheet.jobLine', { n: j.number, day: longDay(j.day, l) })}</span>}
                hint={t('coffre.sheet.jobValue', { value: money(jobTotals(j.id).subtotal, l) })} />
            ))}
          </div>
        </Field>
        <Field label={t('coffre.sheet.amount')} hint={t('coffre.sheet.amountHint', { value: money(value, l) })}>
          <MoneyInput cents={amount} onCents={setAmount} aria-label={t('coffre.sheet.amount')} invalid={!!err && amount == null} />
        </Field>
        <Field label={t('coffre.sheet.day')}>
          <DateInput value={day} onValue={setDay} />
        </Field>
        <Field label={t('coffre.sheet.note')} optional>
          <Textarea value={note} onValue={setNote} rows={2} maxLength={500} />
        </Field>
        {err && <Banner kind="warn">{err}</Banner>}
        <Banner kind="info">{t('coffre.sheet.what')}</Banner>
      </div>
    </Sheet>
  );
}

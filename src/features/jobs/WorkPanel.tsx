/* « Le travail »: what is planned, done, proposed on site and the customer's answers, with the job's total.
   - A planned line becomes « Fait » with one tap; any line opens a short sheet (fait, pas fait, remettre…).
   - « Ajouter du travail »: the price list (ServicePicker). The owner and the office add planned work; a mechanic adding
     work once on site proposes it (the customer must accept it).
   - « Proposer un travail »: a line written on the spot (what, price, why), then the customer's answer: signed on the
     phone, by the link in a text (the answer comes back by itself), or given to the office on the phone. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Check, Plus, PenLine, Hourglass, CircleCheck, Circle, X, Minus, MessageSquareText, Phone, Tag } from 'lucide-preact';
import type { Job, JobItem, ItemStatus } from '../../data/types';
import { Panel, Button, Sheet, Field, Input, Textarea, MoneyInput, Money, Totals, Seg, Kv, Check as CheckBox, attempt } from '../../ui';
import { t, tl, lang } from '../../lib/i18n';
import { money, lineTotal, totals } from '../../lib/money';
import { duration } from '../../lib/dates';
import { itemsOf, jobTotals, settings, invoiceOf } from '../../data/select';
import { me } from '../../data/auth';
import { addItem, updateItem, removeItem, setJobDuration, setItemPrice } from '../../data/api';
import { ServicePicker, itemsDuration, type ItemDraft } from '../booking/ServicePicker';
import { SignaturePad } from './SignaturePad';
import { hasEnoughInk, type Stroke } from './signature';
import { answerBySignature, answerByVoice, sendText } from './flow';
import { customerLang } from './WaiverSheet';
import type { JobRights } from './select';

const OPEN_STATUSES = ['booked', 'en_route', 'on_site'];
const lineCents = (i: Pick<JobItem, 'qty' | 'unit_cents' | 'kind'>) => (i.kind === 'discount' ? -1 : 1) * lineTotal({ qty: Number(i.qty), unitCents: Math.abs(i.unit_cents) });

export function itemStatusText(i: JobItem): string {
  const status = t(`jobs.work.status.${i.status}`);
  if ((i.status === 'approved' || i.status === 'declined') && i.answered_via) return t('jobs.work.statusVia', { status, via: t(`jobs.work.via.${i.answered_via}`) });
  return status;
}
function StatusIcon(p: { s: ItemStatus }) {
  const Icon = p.s === 'done' || p.s === 'approved' ? CircleCheck : p.s === 'proposed' ? Hourglass : p.s === 'declined' ? X : p.s === 'removed' ? Minus : Circle;
  return <span class={`jobs-item-icon is-${p.s}`} aria-hidden="true"><Icon size={18} /></span>;
}

export interface WorkPanelProps {
  job: Job; rights: JobRights;
  onItem: (id: string) => void; onAnswer: (id: string) => void; onAdd: () => void; onPropose: () => void;
}
export function WorkPanel(p: WorkPanelProps) {
  const { job: j, rights } = p;
  const items = itemsOf(j.id);
  const tot = jobTotals(j.id);
  const pending = items.filter((i) => i.status === 'proposed').reduce((n, i) => n + lineCents(i), 0);
  const canEdit = rights.act && OPEN_STATUSES.includes(j.status);
  const l = lang.value;
  return (
    <Panel title={t('jobs.work.title')} help={t('jobs.work.help')} data-tour="job-work" class="jobs-work" data-testid="job-work">
      {items.length ? (
        <div class="rows jobs-items" role="list">
          {items.map((i) => {
            const off = i.status === 'declined' || i.status === 'removed';
            return (
              <div key={i.id} class={`row-item jobs-item${off ? ' is-off' : ''}`} role="listitem" data-testid="job-item">
                <StatusIcon s={i.status} />
                <button type="button" class="jobs-item-main" onClick={() => p.onItem(i.id)}>
                  <span class="row-title">{i.description}</span>
                  <span class="row-sub">{itemStatusText(i)}{Number(i.qty) !== 1 ? `, ${t('jobs.work.qty', { qty: Number(i.qty).toLocaleString(l === 'en' ? 'en-CA' : 'fr-CA'), price: money(Math.abs(i.unit_cents), l) })}` : ''}</span>
                </button>
                <Money cents={lineCents(i)} class={`jobs-item-price${off ? ' faint' : ''}`} />
                <span class="jobs-item-act">
                  {canEdit && j.status === 'on_site' && i.status === 'planned' && (
                    <Button size="sm" icon={<Check />} label={t('jobs.work.markDoneLabel', { what: i.description })} onClick={() => attempt(() => updateItem(i.id, { status: 'done' }))} data-testid="item-done">{t('jobs.work.markDone')}</Button>
                  )}
                  {rights.act && i.status === 'proposed' && (
                    <Button size="sm" icon={<PenLine />} onClick={() => p.onAnswer(i.id)} data-testid="item-answer">{t('jobs.work.answer')}</Button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ) : <p class="muted" style={{ margin: 0 }}>{t('jobs.work.none')}</p>}
      {tot.total > 0 && (
        <div class="jobs-totals">
          <Totals subtotal={tot.subtotal} tps={tot.tps} tvq={tot.tvq} total={tot.total} taxesOn={settings.value.taxes.enabled} />
        </div>
      )}
      {pending > 0 && <p class="small jobs-pending">{t('jobs.work.pendingTotal', { amount: money(pending, l) })}</p>}
      {canEdit && (
        <div class="jobs-work-actions">
          <Button icon={<Plus />} onClick={p.onAdd} data-testid="work-add">{t('jobs.work.add')}</Button>
          <Button icon={<PenLine />} onClick={p.onPropose} data-tour="job-extra" data-testid="work-propose">{t('jobs.work.propose')}</Button>
        </div>
      )}
    </Panel>
  );
}

/* ---------- one line ---------- */
export function ItemSheet(p: { job: Job; item: JobItem | undefined; rights: JobRights; onClose: () => void; onAnswer: (id: string) => void }) {
  const i = p.item;
  if (!i) return null;
  const canEdit = p.rights.act && OPEN_STATUSES.includes(p.job.status);
  const onSite = p.job.status === 'on_site';
  const set = (status: ItemStatus) => async () => { if (await attempt(() => updateItem(i.id, { status }), { ok: t('jobs.work.changed') })) p.onClose(); };
  const l = lang.value;
  return (
    <Sheet open onClose={p.onClose} title={i.description} sub={itemStatusText(i)} data-testid="item-sheet"
      footer={<Button onClick={p.onClose}>{t('common.close')}</Button>}>
      <div class="stack">
        <Kv items={[
          [t('common.price'), <Money cents={lineCents(i)} />],
          [t('common.qty'), Number(i.qty) !== 1 ? t('jobs.work.qty', { qty: Number(i.qty).toLocaleString(l === 'en' ? 'en-CA' : 'fr-CA'), price: money(Math.abs(i.unit_cents), l) }) : null],
          [t('jobs.work.why'), i.note]
        ]} />
        <PriceEdit job={p.job} item={i} />
        {canEdit && (
          <div class="stack">
            {/* on site: what was done, or not (not billed); before that, the plan only changes */}
            {onSite && i.status === 'planned' && <Button variant="primary" block icon={<Check />} onClick={set('done')}>{t('jobs.work.setDone')}</Button>}
            {onSite && i.status === 'done' && <Button block onClick={set('planned')}>{t('jobs.work.setPlanned')}</Button>}
            {onSite && (i.status === 'planned' || i.status === 'done' || i.status === 'approved') && <Button block variant="danger" icon={<Minus />} onClick={set('removed')}>{t('jobs.work.setRemoved')}</Button>}
            {i.status === 'removed' && <Button block onClick={set('planned')}>{t('jobs.work.setBack')}</Button>}
            {!onSite && (i.status === 'planned' || i.status === 'approved') && (
              <Button block variant="danger" icon={<X />} confirm={t('jobs.work.removeConfirm')}
                onClick={async () => { if (await attempt(() => removeItem(i.id), { ok: t('jobs.work.removedFromJob') })) p.onClose(); }} data-testid="item-remove">{t('jobs.work.removeFromJob')}</Button>
            )}
            {i.status === 'proposed' && <Button variant="primary" block icon={<PenLine />} onClick={() => p.onAnswer(i.id)}>{t('jobs.work.getAnswer')}</Button>}
            {i.status === 'proposed' && (
              <Button block variant="danger" icon={<X />} confirm={t('jobs.work.withdrawConfirm')}
                onClick={async () => { if (await attempt(() => removeItem(i.id), { ok: t('jobs.work.withdrawn') })) p.onClose(); }}>{t('jobs.work.withdraw')}</Button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ---------- « Changer le prix »: everyone on the team, while the appointment is coming or under way and its invoice is
   not finished (the server says the same, job_item_price, and keeps the old and new prices) ---------- */
function PriceEdit(p: { job: Job; item: JobItem }) {
  const i = p.item;
  const [open, setOpen] = useState(false);
  const [cents, setCents] = useState<number | null>(Math.abs(i.unit_cents));
  const inv = invoiceOf(p.job.id);
  const finished = !!inv && inv.status !== 'draft' && inv.status !== 'void';
  const may = !!me.value && OPEN_STATUSES.includes(p.job.status) && ['planned', 'approved', 'done', 'proposed'].includes(i.status);
  if (!may) return null;
  if (finished) return <p class="small muted" style={{ margin: 0 }}>{t('jobs.price.locked')}</p>;
  if (!open) return <Button block icon={<Tag />} onClick={() => { setCents(Math.abs(i.unit_cents)); setOpen(true); }} data-testid="item-price-edit">{t('jobs.price.change')}</Button>;
  const save = async () => {
    if (cents == null || cents < 0) return;
    if (cents === Math.abs(i.unit_cents)) { setOpen(false); return; }
    const ok = await attempt(() => setItemPrice(i.id, cents), { ok: t(p.job.confirm_sent_at ? 'jobs.price.doneResend' : 'jobs.price.done', { price: money(cents, lang.value) }) });
    if (ok) setOpen(false);
  };
  return (
    <div class="stack jobs-price-edit" data-testid="item-price-form">
      <Field label={Number(i.qty) !== 1 ? t('jobs.price.unitLabel') : t('jobs.price.label')} hint={t('jobs.price.hint')}>
        <MoneyInput cents={cents} onCents={setCents} aria-label={t('jobs.price.label')} />
      </Field>
      <div class="row-wrap">
        <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={save} disabled={cents == null} data-testid="item-price-save">{t('jobs.price.save')}</Button>
      </div>
    </div>
  );
}

/* ---------- « Ajouter du travail » ---------- */
export function AddWorkSheet(p: { job: Job; rights: JobRights; open: boolean; onClose: () => void; onProposed: (id: string) => void }) {
  const { job: j, rights } = p;
  const [drafts, setDrafts] = useState<ItemDraft[]>([]);
  const [longer, setLonger] = useState(true);
  useEffect(() => { if (p.open) { setDrafts([]); setLonger(true); } }, [p.open]);
  // once on site, a mechanic's added work is an extra: the customer must accept it
  const extra = !rights.office && j.status === 'on_site';
  const minutes = itemsDuration(drafts);
  const canLonger = j.status === 'booked' && rights.duration && minutes > 0;
  const n = drafts.length;
  const save = async () => {
    const ids: string[] = [];
    const ok = await attempt(async () => {
      for (const d of drafts) {
        ids.push(await addItem(j.id, { kind: d.kind, service_id: d.service_id, item_id: d.item_id ?? null, description: d.description, qty: d.qty, unit_cents: d.unit_cents,
          taxable: d.taxable, duration_min: d.duration_min, note: d.note ?? null, status: extra ? 'proposed' : 'planned' }));
      }
    }, { ok: extra ? t('jobs.work.proposed') : t('jobs.work.added', { n }) });
    if (!ok) return;
    if (canLonger && longer) await attempt(() => setJobDuration(j.id, j.duration_min + minutes), { ok: t('jobs.moment.durationSaved', { time: duration(j.duration_min + minutes, lang.value) }) });
    p.onClose();
    if (extra && ids[0]) p.onProposed(ids[0]);
  };
  return (
    <Sheet open={p.open} onClose={p.onClose} title={t('jobs.work.addTitle')} sub={extra ? t('jobs.work.addAsExtra') : undefined} wide data-testid="add-work-sheet"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!n} onClick={save} data-testid="add-work-ok">{n ? t(extra ? 'jobs.work.proposeButton' : 'jobs.work.addButton', { n }) : t('jobs.work.add')}</Button>
      </>}>
      <div class="stack">
        <ServicePicker value={drafts} onValue={setDrafts} lang={customerLang(j)} allowCustom />
        {minutes > 0 && !canLonger && <p class="small muted" style={{ margin: 0 }}>{t('jobs.work.addMinutes', { time: duration(minutes, lang.value) })}</p>}
        {canLonger && <CheckBox checked={longer} onChange={setLonger} label={t('jobs.work.longer', { time: duration(minutes, lang.value) })} hint={t('jobs.work.longerHint')} />}
      </div>
    </Sheet>
  );
}

/* ---------- « Proposer un travail » ---------- */
export function ProposeSheet(p: { job: Job; open: boolean; onClose: () => void; onProposed: (id: string) => void }) {
  const [what, setWhat] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const [why, setWhy] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => { if (p.open) { setWhat(''); setPrice(null); setWhy(''); setTried(false); } }, [p.open]);
  const whatErr = tried && !what.trim() ? t('jobs.work.whatMissing') : null;
  const priceErr = tried && price == null ? t('jobs.work.priceMissing') : null;
  const save = async () => {
    setTried(true);
    if (!what.trim() || price == null) return;
    let id = '';
    const ok = await attempt(async () => {
      id = await addItem(p.job.id, { kind: 'labour', service_id: null, description: what.trim().slice(0, 300), qty: 1, unit_cents: Math.max(0, price), taxable: true, status: 'proposed', note: why.trim() || null });
    });
    if (!ok) return;
    p.onClose();
    p.onProposed(id);
  };
  return (
    <Sheet open={p.open} onClose={p.onClose} title={t('jobs.work.proposeTitle')} sub={t('jobs.work.proposeLead')} data-testid="propose-sheet"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={save} data-testid="propose-ok">{t('jobs.work.proposeOk')}</Button>
      </>}>
      <div class="stack">
        <Field label={t('jobs.work.what')} error={whatErr}>
          <Input value={what} onValue={setWhat} placeholder={t('jobs.work.whatPlaceholder')} maxLength={300} invalid={!!whatErr} data-testid="propose-what" />
        </Field>
        <Field label={t('jobs.work.price')} error={priceErr}>
          <MoneyInput cents={price} onCents={setPrice} invalid={!!priceErr} aria-label={t('jobs.work.price')} />
        </Field>
        <Field label={t('jobs.work.why')} hint={t('jobs.work.whyHint')} optional>
          <Textarea value={why} onValue={setWhy} rows={2} maxLength={500} />
        </Field>
      </div>
    </Sheet>
  );
}

/* ---------- the customer's answer to proposed work ---------- */
type How = 'sign' | 'text' | 'voice';
export function AnswerSheet(p: { job: Job; item: JobItem | undefined; rights: JobRights; onClose: () => void }) {
  const { job: j, item: i, rights } = p;
  const l = customerLang(j);
  const [how, setHow] = useState<How>(rights.office && !rights.mine ? 'voice' : 'sign');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const price = useMemo(() => {
    if (!i) return null;
    const tt = totals([{ qty: Number(i.qty), unitCents: Math.abs(i.unit_cents), taxable: i.taxable }], settings.value.taxes);
    return { sub: tt.subtotal, total: tt.total };
  }, [i?.qty, i?.unit_cents, i?.taxable]);
  if (!i) return null;
  const answered = i.status !== 'proposed';
  const close = p.onClose;
  const yes = async () => {
    if (!hasEnoughInk(strokes)) { setErr(tl(l, 'jobs.sign.tooSmall')); return; }
    if (await answerBySignature(i, true, strokes)) close();
  };
  const no = async () => { if (await answerBySignature(i, false, [])) close(); };
  const opts = [
    { value: 'sign' as How, label: t('jobs.work.howSign') },
    { value: 'text' as How, label: t('jobs.work.howText') },
    ...(rights.verbal ? [{ value: 'voice' as How, label: t('jobs.work.howVoice') }] : [])
  ];
  return (
    <Sheet open onClose={close} title={tl(l, 'jobs.sign.extraTitle')} dismissable={!strokes.length} data-testid="answer-sheet"
      footer={answered ? <Button onClick={close}>{t('common.close')}</Button>
        : how === 'sign' ? <>
          <Button onClick={no} data-testid="answer-no">{tl(l, 'jobs.sign.decline')}</Button>
          <Button variant="primary" onClick={yes} disabled={!strokes.length} data-testid="answer-yes">{tl(l, 'jobs.sign.accept')}</Button>
        </> : <Button onClick={close}>{t('common.close')}</Button>}>
      <div class="stack">
        <div class="jobs-extra" lang={l === 'en' ? 'en-CA' : 'fr-CA'} tabIndex={-1} autoFocus>
          <h3>{i.description}</h3>
          {i.note && <p><span class="jobs-extra-label">{tl(l, 'jobs.sign.extraWhy')}</span>{i.note}</p>}
          {price && <p class="jobs-extra-price">{tl(l, 'jobs.sign.extraPrice', { price: money(price.sub, l), total: money(price.total, l) })}</p>}
        </div>
        {answered ? <p class="muted" style={{ margin: 0 }}>{itemStatusText(i)}</p> : <>
          <Field label={t('jobs.work.how')} group>
            <Seg value={how} onValue={(v) => { setHow(v); setErr(null); }} options={opts} label={t('jobs.work.how')} class="jobs-seg" data-testid="answer-how" />
          </Field>
          {how === 'sign' && <>
            <SignaturePad strokes={strokes} onStrokes={(s) => { setStrokes(s); setErr(null); }} label={tl(l, 'jobs.sign.pad')} hint={tl(l, 'jobs.sign.acceptSign')} clearLabel={tl(l, 'jobs.sign.clear')} height={180} data-testid="answer-pad" />
            {err && <p class="field-error" role="alert" style={{ margin: 0 }}>{err}</p>}
          </>}
          {how === 'text' && <>
            <p class="muted" style={{ margin: 0 }}>{t('jobs.work.textLead')}</p>
            <Button variant="primary" icon={<MessageSquareText />} onClick={async () => { if (await sendText('extras', j)) close(); }} data-testid="answer-text">{t('jobs.work.textSend')}</Button>
          </>}
          {how === 'voice' && <>
            <p class="muted" style={{ margin: 0 }}>{t('jobs.work.voiceLead')}</p>
            <div class="jobs-two">
              <Button variant="primary" icon={<Phone />} onClick={async () => { if (await answerByVoice(i, true)) close(); }} data-testid="answer-voice-yes">{t('jobs.work.voiceYes')}</Button>
              <Button onClick={async () => { if (await answerByVoice(i, false)) close(); }}>{t('jobs.work.voiceNo')}</Button>
            </div>
          </>}
        </>}
      </div>
    </Sheet>
  );
}

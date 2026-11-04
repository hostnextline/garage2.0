/* One estimate (#/quote/:id; #/quote/new makes one). Made for the spot: the work and its price first, the total
   with taxes, then (if wanted) who it is for — a name and a phone, or a customer file — and the car. Saved by itself.
   PDF or « Partager » in the customer's language, « Réserver » turns it into a job, « Accepté » / « Refusé ». */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Share2, FileDown, CalendarPlus, Check as CheckIcon, X, Undo2, Trash2, UserRound, Wrench } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { isField, may } from '../../app/routes';
import { navigate, goBack } from '../../app/router';
import { touch } from '../../app/media';
import type { Quote, Lang } from '../../data/types';
import { getRow } from '../../data/store';
import { settings, customer, customerName, vehicle, job as jobRow } from '../../data/select';
import { saveQuote, errorMessage } from '../../data/api';
import { uuid, net } from '../../data/sync';
import { can, me } from '../../data/auth';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { today, shortDate, stamp as stampText } from '../../lib/dates';
import { formatPhone } from '../../lib/text';
import { Page, Panel, Button, Banner, Empty, Skeleton, Field, Input, PhoneInput, Textarea, DateInput, Seg, Totals, run, attempt, toast } from '../../ui';
import { CustomerPicker } from '../customers/CustomerPicker';
import { VehiclePicker } from '../customers/VehiclePicker';
import { LinesEditor, LinesView, CatalogSheet, withKeys, type EditLine } from '../invoices/Lines';
import { useDraft } from '../invoices/useDraft';
import { usePdf } from '../invoices/usePdf';
import { quotePdfData } from '../invoices/pdf';
import { canShareText } from '../invoices/share';
import { quoteNumber } from '../invoices/select';
import { quoteTotals, cleanItems, quoteIsEmpty, quoteExpired, defaultValidUntil } from './logic';
import { QuotePill } from './QuotesScreen';
import '../invoices/invoices.css';
import './quotes.css';

export default function QuoteScreen({ params, query }: ScreenProps) {
  if (params.id === 'new') return <NewQuote customerId={query.get('customer')} />;
  const q = getRow<Quote>('quotes', params.id);
  if (!q || q.deleted_at) {
    return (
      <Page title={t('quotes.one')} back="/quotes">
        {net.value.ready
          ? <Panel><Empty title={t('quotes.screen.missing')} text={t('quotes.screen.missingText')} action={<Button variant="primary" href="#/quotes">{t('quotes.screen.toList')}</Button>} /></Panel>
          : <Panel><Skeleton h={28} lines={5} /></Panel>}
      </Page>
    );
  }
  return <QuoteEditor key={q.id} q={q} />;
}

/** « Nouvelle estimation »: the estimate is made at once (its number comes from the server), then shown */
function NewQuote(p: { customerId: string | null }) {
  const started = useRef(false);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!isField()) { setFailed(t('common.notAllowed')); return; }
    const c = customer(p.customerId);
    const id = uuid();
    saveQuote({ id, status: 'open', items: [], lang: c?.lang || lang.value, valid_until: defaultValidUntil(today()), customer_id: c?.id ?? null, vehicle_id: null,
      contact_name: null, contact_phone: null, vehicle_text: null, notes: null, job_id: null })
      .then(() => navigate(`/quote/${id}`, { replace: true }), (e) => setFailed(errorMessage(e)));
  }, []);
  return (
    <Page title={t('quotes.newTitle')} back="/quotes">
      {failed ? <Banner kind="bad" action={<Button onClick={() => goBack('/quotes')}>{t('common.back')}</Button>}>{failed}</Banner> : <Panel><Skeleton h={28} lines={4} /></Panel>}
    </Page>
  );
}

interface QV {
  items: EditLine[]; customer_id: string | null; vehicle_id: string | null; contact_name: string; contact_phone: string; vehicle_text: string;
  notes: string; valid_until: string; lang: Lang;
}
const fromQuote = (q: Quote): QV => ({
  items: withKeys(q.items), customer_id: q.customer_id ?? null, vehicle_id: q.vehicle_id ?? null, contact_name: q.contact_name || '', contact_phone: q.contact_phone || '',
  vehicle_text: q.vehicle_text || '', notes: q.notes || '', valid_until: q.valid_until || '', lang: q.lang === 'en' ? 'en' : 'fr'
});
const toPatch = (v: QV): Partial<Quote> => ({
  items: cleanItems(v.items), customer_id: v.customer_id, vehicle_id: v.customer_id ? v.vehicle_id : null, contact_name: v.contact_name.trim() || null,
  contact_phone: v.contact_phone.trim() || null, vehicle_text: v.vehicle_text.trim() || null, notes: v.notes.trim() || null, valid_until: v.valid_until || null, lang: v.lang
});
const quoteSig = (v: QV) => JSON.stringify(toPatch(v));

function QuoteEditor(p: { q: Quote }) {
  const { q } = p;
  const l = lang.value;
  const mine = !q.created_by || q.created_by === me.value?.id;
  const canEdit = q.status !== 'converted' && (can('book') || (mine && isField()));
  const d = useDraft<QV>(fromQuote(q), quoteSig, async (v) => {
    try { await saveQuote({ id: q.id, ...toPatch(v) }); } catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
  });
  const v = d.value;
  const [catalog, setCatalog] = useState(false);
  const [picking, setPicking] = useState(false);
  const pdf = usePdf();
  const tt = quoteTotals(cleanItems(v.items), settings.value.taxes);
  const c = customer(v.customer_id);
  const expired = quoteExpired(q, today());
  const number = q.number != null ? quoteNumber(q) : '';
  const set = (patch: Partial<QV>) => d.change({ ...v, ...patch });

  // an estimate left empty (opened by mistake) is not kept
  const cur = useRef(v);
  cur.current = v;
  useEffect(() => () => {
    const x = cur.current;
    const row = getRow<Quote>('quotes', q.id);
    if (row && !row.deleted_at && row.status === 'open' && quoteIsEmpty({ ...toPatch(x), items: x.items } as Quote)) void saveQuote({ id: q.id, deleted_at: new Date().toISOString() }).catch(() => undefined);
  }, []);

  const setStatus = (status: Quote['status'], ok: string) => run(async () => { await d.flush(); await saveQuote({ id: q.id, status }); }, { ok });
  const doc = () => quotePdfData({ quote: { ...q, ...toPatch(v), items: cleanItems(v.items) } as Quote, customer: c, vehicle: vehicle(v.customer_id ? v.vehicle_id : null), settings: settings.value });
  const ready = () => { if (!v.items.length) { toast(t('quotes.screen.needItems'), { kind: 'bad' }); return false; } return true; };
  const share = async () => {
    if (!ready()) return;
    await d.flush();
    await pdf.make(doc, { onShared: () => { if (canEdit && q.status === 'open') void saveQuote({ id: q.id, status: 'sent' }).catch(() => undefined); } });
  };
  const download = async () => { if (!ready()) return; await d.flush(); await pdf.make(doc, { share: false }); };
  const remove = async () => {
    const ok = await attempt(async () => { d.reset(v); await saveQuote({ id: q.id, deleted_at: new Date().toISOString() }); }, { ok: t('quotes.screen.deleted') });
    if (ok) goBack('/quotes');
  };
  const sharesFiles = touch.value && canShareText();
  const bookable = (may.book() || may.walkIn()) && v.items.length > 0 && (q.status === 'open' || q.status === 'sent' || q.status === 'accepted');
  const job = jobRow(q.job_id);

  return (
    <Page title={number ? <>{t('quotes.one')} <span class="nowrap">{number}</span></> : t('quotes.newTitle')}
      sub={<span class="row-wrap"><QuotePill status={q.status} />{q.created_at && <span>{t('quotes.screen.made', { when: stampText(q.created_at, l) })}</span>}</span>}
      back="/quotes" wide>
      <div class="quote-layout">
        <div class="quote-main">
        <Panel title={t('quotes.screen.items')} sub={t('quotes.screen.itemsSub')} class="quote-items" data-tour="quote-items" data-testid="quote-items"
          action={canEdit ? <span class={`inv-saved inv-saved-${d.state}`} role="status" aria-live="polite" data-testid="quote-state">{t(`invoices.draft.state.${d.state}`)}</span> : undefined}>
          {canEdit
            ? <LinesEditor lines={v.items} onLines={(items) => set({ items })} docLang={v.lang} onCatalog={() => setCatalog(true)} />
            : <ReadOnlyItems q={q} />}
        </Panel>
        <Panel title={t('quotes.screen.who')} sub={t('quotes.screen.whoSub')} class="quote-who">
          {canEdit ? (
            <div class="stack">
              {c ? (
                <div class="stack">
                  <div class="quote-customer">
                    <UserRound aria-hidden="true" />
                    <div class="grow"><b>{customerName(c)}</b>{c.phone && <span class="muted small">{formatPhone(c.phone)}</span>}</div>
                    <Button variant="ghost" onClick={() => set({ customer_id: null, vehicle_id: null })} data-testid="quote-unpick">{t('quotes.screen.unpick')}</Button>
                  </div>
                  <Field label={t('quotes.screen.vehicle')} group optional>
                    <VehiclePicker customerId={c.id} value={v.vehicle_id} onPick={(id) => set({ vehicle_id: id })} />
                  </Field>
                  {!v.vehicle_id && (
                    <Field label={t('quotes.screen.vehicleText')} optional>
                      <Input value={v.vehicle_text} onValue={(s) => set({ vehicle_text: s })} placeholder={t('quotes.screen.vehiclePh')} maxLength={120} />
                    </Field>
                  )}
                </div>
              ) : (
                <>
                  <div class="grid-2">
                    <Field label={t('quotes.screen.contactName')} optional>
                      <Input value={v.contact_name} onValue={(s) => set({ contact_name: s })} autoComplete="off" maxLength={120} data-testid="quote-contact" />
                    </Field>
                    <Field label={t('quotes.screen.contactPhone')} optional>
                      <PhoneInput value={v.contact_phone} onValue={(s) => set({ contact_phone: s })} />
                    </Field>
                  </div>
                  <Field label={t('quotes.screen.vehicleText')} optional>
                    <Input value={v.vehicle_text} onValue={(s) => set({ vehicle_text: s })} placeholder={t('quotes.screen.vehiclePh')} maxLength={120} data-testid="quote-vehicle" />
                  </Field>
                  {picking
                    ? <Field label={t('quotes.screen.pickCustomer')} group>
                      <CustomerPicker value={null} autoFocus allowCreate onPick={(id) => {
                        const cu = customer(id);
                        if (id) { set({ customer_id: id, vehicle_id: null, lang: cu?.lang === 'en' ? 'en' : cu ? 'fr' : v.lang }); setPicking(false); }
                      }} />
                      <Button variant="ghost" onClick={() => setPicking(false)}>{t('common.cancel')}</Button>
                    </Field>
                    : <Button variant="ghost" icon={<UserRound />} onClick={() => setPicking(true)} data-testid="quote-pick">{t('quotes.screen.pickCustomer')}</Button>}
                </>
              )}
            </div>
          ) : (
            <p style={{ margin: 0 }}>{[customerName(c) || q.contact_name, q.contact_phone ? formatPhone(q.contact_phone) : '', q.vehicle_text].filter(Boolean).join(', ') || t('quotes.noName')}</p>
          )}
        </Panel>
        </div>

        <div class="quote-side">
        <Panel class="quote-total" data-testid="quote-total">
          <div class="stack">
            <div class="inv-hero">
              <span class="inv-hero-label">{t('quotes.screen.total')}</span>
              <span class="inv-hero-amount money" data-testid="quote-total-amount">{money(tt.total, l)}</span>
              <span class="muted small">{settings.value.taxes.enabled !== false ? t('quotes.screen.taxesIncluded') : t('quotes.screen.noTaxes')}</span>
            </div>
            <div class="inv-totals"><Totals subtotal={tt.subtotal} tps={tt.tps} tvq={tt.tvq} total={tt.total} taxesOn={settings.value.taxes.enabled !== false} /></div>
            {expired && <Banner kind="warn">{t('quotes.screen.expired', { when: shortDate(q.valid_until!, l) })}</Banner>}
            {q.status === 'converted' && (
              <Banner kind="ok" action={job ? <Button icon={<Wrench />} href={`#/job/${job.id}`}>{t('quotes.screen.toJob', { n: job.number })}</Button> : undefined}>{t('quotes.screen.converted')}</Banner>
            )}
            <div class="inv-actions">
              {sharesFiles
                ? <>
                  <Button variant="primary" icon={<Share2 />} onClick={share} data-tour="quote-send" data-testid="quote-share">{t('quotes.screen.share')}</Button>
                  <Button icon={<FileDown />} onClick={download} data-testid="quote-pdf">{t('quotes.screen.pdf')}</Button>
                </>
                : <Button variant={q.status === 'accepted' ? 'secondary' : 'primary'} icon={<FileDown />} onClick={download} data-tour="quote-send" data-testid="quote-pdf">{t('quotes.screen.pdf')}</Button>}
            </div>
            {canEdit && q.status === 'open' && !sharesFiles && (
              <Button variant="ghost" onClick={() => setStatus('sent', t('quotes.screen.markedSent'))} data-testid="quote-mark-sent">{t('quotes.screen.markSent')}</Button>
            )}
            {bookable && (
              <Button variant={q.status === 'accepted' ? 'primary' : 'secondary'} icon={<CalendarPlus />} href={`#/book?quote=${q.id}`} onClick={() => d.flush()} data-testid="quote-book">{t('quotes.screen.book')}</Button>
            )}
            {canEdit && (q.status === 'open' || q.status === 'sent') && (
              <div class="inv-actions">
                <Button icon={<CheckIcon />} onClick={() => setStatus('accepted', t('quotes.screen.accepted'))} data-testid="quote-accept">{t('quotes.screen.accept')}</Button>
                <Button icon={<X />} onClick={() => setStatus('declined', t('quotes.screen.declined'))} data-testid="quote-decline">{t('quotes.screen.decline')}</Button>
              </div>
            )}
            {canEdit && (q.status === 'accepted' || q.status === 'declined') && (
              <Button variant="ghost" icon={<Undo2 />} onClick={() => setStatus('open', t('quotes.screen.reopened'))} data-testid="quote-reopen">{t('quotes.screen.reopen')}</Button>
            )}
          </div>
        </Panel>

        <Panel title={t('quotes.screen.details')} class="quote-details">
          <div class="stack">
            <div class="quote-detail-row">
              <Field label={t('quotes.screen.validUntil')} optional>
                <DateInput value={v.valid_until} onValue={(s) => set({ valid_until: s })} min={today()} aria-label={t('quotes.screen.validUntil')} />
              </Field>
              <Field label={t('quotes.screen.docLang')} group help={t('quotes.screen.docLangHelp')}>
                <Seg<Lang> value={v.lang} onValue={(x) => canEdit && set({ lang: x })} options={[{ value: 'fr', label: t('common.langs.fr') }, { value: 'en', label: t('common.langs.en') }]} label={t('quotes.screen.docLang')} />
              </Field>
            </div>
            <Field label={t('quotes.screen.notes')} hint={t('quotes.screen.notesHint')} optional>
              <Textarea value={v.notes} onValue={(s) => set({ notes: s })} rows={3} maxLength={1500} disabled={!canEdit} />
            </Field>
          </div>
        </Panel>

        {canEdit && q.status !== 'converted' && (
          <div class="quote-delete">
            <Button variant="danger" icon={<Trash2 />} confirm={t('quotes.screen.deleteConfirm')} onClick={remove} data-testid="quote-delete">{t('quotes.screen.delete')}</Button>
          </div>
        )}
        </div>
      </div>
      <CatalogSheet open={catalog} onClose={() => setCatalog(false)} docLang={v.lang} onAdd={(add) => set({ items: [...v.items, ...add] })} />
      {pdf.sheet}
    </Page>
  );
}

function ReadOnlyItems(p: { q: Quote }) {
  return <LinesView lines={p.q.items || []} docLang={p.q.lang === 'en' ? 'en' : 'fr'} />;
}

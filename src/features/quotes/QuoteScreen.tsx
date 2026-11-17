/* One estimate (#/quote/:id; #/quote/new makes one). Made for the spot: the work and its price first, the total
   with taxes, then (if wanted) who it is for — a name and a phone, or a customer file — and the car. Saved by itself.
   PDF or « Partager » in the customer's language, « Réserver » turns it into a job, « Accepté » / « Refusé ». */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Trash2 } from 'lucide-preact';
import { isField, may } from '../../domain/rights';
import { navigate, goBack, type ScreenProps } from '../../platform/router';
import { touch } from '../../platform/media';
import type { Quote, Lang } from '../../data/types';
import { getRow } from '../../data/store';
import { settings, customer, vehicle, job as jobRow } from '../../data/select';
import { saveQuote, errorMessage } from '../../data/api';
import { uuid, net } from '../../data/sync';
import { can, me } from '../../data/auth';
import { t, lang } from '../../lib/i18n';
import { today, stamp as stampText } from '../../lib/dates';
import { Page, Panel, Button, Banner, Empty, Skeleton, Field, Textarea, DateInput, Seg, attempt, toast } from '../../ui';
import { LinesEditor, percentWords } from '../../shared/invoices/LinesEditor';
import { LinesView } from '../../shared/invoices/LinesView';
import { CatalogSheet } from '../../shared/invoices/CatalogSheet';
import { useDraft } from '../../shared/invoices/useDraft';
import { usePdf } from '../../shared/invoices/usePdf';
import { canShareText } from '../../shared/invoices/share';
import { quoteNumber } from '../../shared/invoices/select';
import { quotePdfData } from '../../domain/money/document';
import { quoteTotals, cleanItems, quoteIsEmpty, quoteExpired, defaultValidUntil, dropWhenLeft, changedOnly } from '../../domain/money/quote';
import { keepKeys } from '../../domain/money/editLines';
import { addLines } from '../../domain/money/draft';
import { waitingEntries, rowWaiting } from '../../domain/money/waiting';
import { QuotePill } from './QuotePill';
import { QuoteWho } from './QuoteWho';
import { QuoteTotal } from './QuoteTotal';
import { fromQuote, toPatch, quoteSig, type QV } from './form';
import '../../shared/invoices/invoices.css';
import './quotes.css';

/** the estimates made on this phone during this visit: only those may be dropped when left empty */
const madeHere = new Set<string>();

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
    if (!may.newQuote()) { setFailed(t('common.notAllowed')); return; }
    const c = customer(p.customerId);
    const id = uuid();
    madeHere.add(id);
    saveQuote({ id, status: 'open', items: [], lang: c?.lang || lang.value, valid_until: defaultValidUntil(today()), customer_id: c?.id ?? null, vehicle_id: null,
      contact_name: null, contact_phone: null, vehicle_text: null, notes: null, job_id: null })
      .then(() => navigate(`/quote/${id}`, { replace: true }), (e: unknown) => setFailed(errorMessage(e)));
  }, []);
  return (
    <Page title={t('quotes.newTitle')} back="/quotes">
      {failed ? <Banner kind="bad" action={<Button onClick={() => goBack('/quotes')}>{t('common.back')}</Button>}>{failed}</Banner> : <Panel><Skeleton h={28} lines={4} /></Panel>}
    </Page>
  );
}

function QuoteEditor(p: { q: Quote }) {
  const { q } = p;
  const l = lang.value;
  const mine = !q.created_by || q.created_by === me.value?.id;
  const canEdit = q.status !== 'converted' && (can('book') || (mine && isField()));
  const d = useDraft<QV>(fromQuote(q), quoteSig, async (v, base) => {
    const patch = changedOnly(toPatch(v), toPatch(base));
    if (patch) await saveQuote({ id: q.id, ...patch });
  }, { busy: rowWaiting(waitingEntries(), 'quotes', q.id), offline: !net.value.online, adopt: (s, shown) => ({ ...s, items: keepKeys(s.items, shown.items) }) });
  const v = d.value;
  const [catalog, setCatalog] = useState(false);
  const pdf = usePdf();
  const tt = quoteTotals(cleanItems(v.items), settings.value.taxes);
  const c = customer(v.customer_id);
  const number = q.number != null ? quoteNumber(q) : '';
  const set = (patch: Partial<QV>) => d.update((cur) => ({ ...cur, ...patch }));

  // an estimate opened by mistake and left empty is not kept (only by the one who just made it, see dropWhenLeft)
  const cur = useRef(v);
  cur.current = v;
  useEffect(() => () => {
    const x = cur.current;
    const row = getRow<Quote>('quotes', q.id);
    if (dropWhenLeft({ madeHere: madeHere.has(q.id), canEdit, row, empty: quoteIsEmpty({ ...toPatch(x), items: x.items }) })) {
      void attempt(() => saveQuote({ id: q.id, deleted_at: new Date().toISOString() }), { quiet: true });
    }
  }, []);

  const setStatus = (status: Quote['status'], ok: string) => attempt(async () => { await d.flush(); await saveQuote({ id: q.id, status }); }, { ok });
  const doc = () => quotePdfData({ quote: { ...q, ...toPatch(v), items: cleanItems(v.items) } as Quote, customer: c, vehicle: vehicle(v.customer_id ? v.vehicle_id : null), settings: settings.value });
  const ready = () => { if (!v.items.length) { toast(t('quotes.screen.needItems'), { kind: 'bad' }); return false; } return true; };
  const share = async () => {
    if (!ready()) return;
    await d.flush();
    await pdf.make(doc, { onShared: () => { if (canEdit && q.status === 'open') void attempt(() => saveQuote({ id: q.id, status: 'sent' }), { quiet: true }); } });
  };
  const download = async () => { if (!ready()) return; await d.flush(); await pdf.make(doc, { share: false }); };
  const remove = async () => {
    const ok = await attempt(async () => { d.reset(v); await saveQuote({ id: q.id, deleted_at: new Date().toISOString() }); }, { ok: t('quotes.screen.deleted') });
    if (ok) goBack('/quotes');
  };
  const sharesFiles = touch.value && canShareText();
  const bookable = (may.book() || may.walkIn()) && v.items.length > 0 && (q.status === 'open' || q.status === 'sent' || q.status === 'accepted');

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
              : <LinesView lines={q.items || []} docLang={q.lang === 'en' ? 'en' : 'fr'} />}
          </Panel>
          <QuoteWho q={q} v={v} canEdit={canEdit} set={set} />
        </div>

        <div class="quote-side">
          <QuoteTotal q={q} tt={tt} expired={quoteExpired(q, today())} job={jobRow(q.job_id)} canEdit={canEdit} sharesFiles={sharesFiles} bookable={bookable}
            onShare={share} onDownload={download} onBook={() => d.flush()} onStatus={setStatus} />

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
      <CatalogSheet open={catalog} onClose={() => setCatalog(false)} docLang={v.lang} onAdd={(add) => set({ items: addLines(d.peek().items, add, percentWords()) })} />
      {pdf.sheet}
    </Page>
  );
}

/* The total of an estimate with its taxes, and what to do with it: « Partager » / PDF, « Marquer comme envoyée »,
   « Réserver », « Accepté » / « Refusé », « Remettre en cours ». */
import { Share2, FileDown, CalendarPlus, Check as CheckIcon, X, Undo2, Wrench } from 'lucide-preact';
import type { Quote, Job } from '../../data/types';
import { settings } from '../../data/select';
import { t, lang } from '../../lib/i18n';
import { money, type Totals as TotalsT } from '../../lib/money';
import { shortDate } from '../../lib/dates';
import { Panel, Button, Banner, Totals } from '../../ui';

export function QuoteTotal(p: {
  q: Quote; tt: TotalsT; expired: boolean; job: Job | undefined; canEdit: boolean; sharesFiles: boolean; bookable: boolean;
  onShare: () => Promise<unknown>; onDownload: () => Promise<unknown>; onBook: () => unknown; onStatus: (status: Quote['status'], ok: string) => Promise<unknown>;
}) {
  const { q, tt } = p;
  const l = lang.value;
  const taxesOn = settings.value.taxes.enabled !== false;
  return (
    <Panel class="quote-total" data-testid="quote-total">
      <div class="stack">
        <div class="inv-hero">
          <span class="inv-hero-label">{t('quotes.screen.total')}</span>
          <span class="inv-hero-amount money" data-testid="quote-total-amount">{money(tt.total, l)}</span>
          <span class="muted small">{taxesOn ? t('quotes.screen.taxesIncluded') : t('quotes.screen.noTaxes')}</span>
        </div>
        <div class="inv-totals"><Totals subtotal={tt.subtotal} tps={tt.tps} tvq={tt.tvq} total={tt.total} taxesOn={taxesOn} /></div>
        {p.expired && <Banner kind="warn">{t('quotes.screen.expired', { when: shortDate(q.valid_until!, l) })}</Banner>}
        {q.status === 'converted' && (
          <Banner kind="ok" action={p.job ? <Button icon={<Wrench />} href={`#/job/${p.job.id}`}>{t('quotes.screen.toJob', { n: p.job.number })}</Button> : undefined}>{t('quotes.screen.converted')}</Banner>
        )}
        <div class="inv-actions">
          {p.sharesFiles
            ? <>
              <Button variant="primary" icon={<Share2 />} onClick={p.onShare} data-tour="quote-send" data-testid="quote-share">{t('quotes.screen.share')}</Button>
              <Button icon={<FileDown />} onClick={p.onDownload} data-testid="quote-pdf">{t('quotes.screen.pdf')}</Button>
            </>
            : <Button variant={q.status === 'accepted' ? 'secondary' : 'primary'} icon={<FileDown />} onClick={p.onDownload} data-tour="quote-send" data-testid="quote-pdf">{t('quotes.screen.pdf')}</Button>}
        </div>
        {p.canEdit && q.status === 'open' && !p.sharesFiles && (
          <Button variant="ghost" onClick={() => p.onStatus('sent', t('quotes.screen.markedSent'))} data-testid="quote-mark-sent">{t('quotes.screen.markSent')}</Button>
        )}
        {p.bookable && (
          <Button variant={q.status === 'accepted' ? 'primary' : 'secondary'} icon={<CalendarPlus />} href={`#/book?quote=${q.id}`} onClick={p.onBook} data-testid="quote-book">{t('quotes.screen.book')}</Button>
        )}
        {p.canEdit && (q.status === 'open' || q.status === 'sent') && (
          <div class="inv-actions">
            <Button icon={<CheckIcon />} onClick={() => p.onStatus('accepted', t('quotes.screen.accepted'))} data-testid="quote-accept">{t('quotes.screen.accept')}</Button>
            <Button icon={<X />} onClick={() => p.onStatus('declined', t('quotes.screen.declined'))} data-testid="quote-decline">{t('quotes.screen.decline')}</Button>
          </div>
        )}
        {p.canEdit && (q.status === 'accepted' || q.status === 'declined') && (
          <Button variant="ghost" icon={<Undo2 />} onClick={() => p.onStatus('open', t('quotes.screen.reopened'))} data-testid="quote-reopen">{t('quotes.screen.reopen')}</Button>
        )}
      </div>
    </Panel>
  );
}

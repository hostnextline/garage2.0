/* What a finished invoice must say beside its totals (the invoice panel of the job and the invoice screen):
   - « Trop-perçu »: the customer paid more than the invoice; « Inscrire le remboursement » opens the refund sheet.
   - work of the job that is not on the invoice (added or accepted after it was finished): « Modifier la facture ».
   - a payment taken on this phone that still waits for the network: it is not taken a second time. */
import type { Invoice, Job } from '../../data/types';
import { itemsOf } from '../../data/select';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { Banner, Button } from '../../ui';
import { workMissing, jobOpen } from '../../domain/money/draft';
import { ReopenButton, mayReopen } from './Reopen';

export function OverBanner(p: { over: number; canRefund: boolean; onRefund: () => void }) {
  if (p.over <= 0) return null;
  return (
    <Banner kind="warn" title={t('invoices.panel.overTitle', { amount: money(p.over, lang.value) })} data-testid="invoice-over">
      <p style={{ margin: 0 }}>{t('invoices.panel.over')}</p>
      {p.canRefund && <Button size="sm" onClick={p.onRefund} data-testid="invoice-refund">{t('invoices.panel.overButton')}</Button>}
    </Banner>
  );
}

/** the job's billable work missing from a finished invoice, while the job is coming or under way. Not while its
    « Terminer la facture » waits on this phone (`finishing`): the server still has a draft, « Modifier la facture »
    would be refused; it is said once the invoice is really finished. */
export function UnbilledBanner(p: { inv: Invoice; job: Job | undefined; finishing?: boolean }) {
  const j = p.job;
  if (p.finishing || !j || !jobOpen(j.status) || p.inv.status === 'draft' || p.inv.status === 'void') return null;
  const missing = workMissing(p.inv.lines, itemsOf(j.id));
  if (!missing.length) return null;
  const reopen = mayReopen(p.inv, j);
  return (
    <Banner kind="warn" title={t('invoices.panel.unbilled', { n: missing.length })} data-testid="invoice-unbilled">
      <span class="inv-new-work">{missing.map((i) => i.description).join(', ')}</span>
      <p style={{ margin: 0 }}>{reopen ? t('invoices.panel.unbilledText') : t('invoices.panel.unbilledClosed')}</p>
      {reopen && <ReopenButton inv={p.inv} job={j} />}
    </Banner>
  );
}

/** in place of « Encaisser » when nothing is left once the payments waiting on this phone are counted */
export function PayWaitingBanner(p: { cents: number }) {
  return (
    <Banner kind="info" title={t('invoices.pay.waiting', { amount: money(p.cents, lang.value) })} data-testid="pay-waiting">
      {t('invoices.pay.waitingText')}
    </Banner>
  );
}

/* « Terminer la facture » while work of the job is not on it: asked before the invoice gets its number, because a
   finished invoice can no longer take it once the job is done. « Ajouter et terminer » or « Terminer sans » (that work
   then marked « Pas fait »: without `onWithout`, for someone who may not, only « Ajouter et terminer »). */
import { Receipt } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { Sheet, Button } from '../../ui';
import type { WorkItem } from '../../domain/money/draft';

export function MissingWorkSheet(p: { work: WorkItem[]; onClose: () => void; onAdd: () => Promise<unknown>; onWithout?: () => Promise<unknown> }) {
  if (!p.work.length) return null;
  return (
    <Sheet open onClose={p.onClose} title={t('invoices.draft.missing.title', { n: p.work.length })} data-testid="missing-work"
      footer={<>
        {p.onWithout && <Button onClick={p.onWithout} data-testid="missing-work-without">{t('invoices.draft.missing.without')}</Button>}
        <Button variant="primary" icon={<Receipt />} onClick={p.onAdd} data-testid="missing-work-add">{t('invoices.draft.missing.add')}</Button>
      </>}>
      <div class="stack">
        <p class="inv-new-work" style={{ margin: 0 }}>{p.work.map((i) => i.description).join(', ')}</p>
        <p class="muted small" style={{ margin: 0 }}>{t('invoices.draft.missing.text')}</p>
      </div>
    </Sheet>
  );
}

/* « Terminer la facture » while work of the job is not on it: asked before the invoice gets its number, because a
   finished invoice can no longer take it once the job is done. « Ajouter et terminer », or the other way:
   - `notDone` (the job coming or under way): « Pas fait, terminer », and the sheet says that work will be marked
     « Pas fait » and not billed (review invoices: before, « Terminer sans » did it without a word, and a mechanic who
     had done the work lost its billing without noticing);
   - a job already over: « Terminer sans », the invoice finished as it is, the work not touched.
   Without `onWithout` (someone whose « Pas fait » the server refuses), only « Ajouter et terminer ». */
import { Receipt } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { Sheet, Button } from '../../ui';
import type { WorkItem } from '../../domain/money/draft';

export function MissingWorkSheet(p: { work: WorkItem[]; onClose: () => void; onAdd: () => Promise<unknown>; onWithout?: () => Promise<unknown>; notDone?: boolean }) {
  if (!p.work.length) return null;
  const notDone = !!p.onWithout && !!p.notDone;
  return (
    <Sheet open onClose={p.onClose} title={t('invoices.draft.missing.title', { n: p.work.length })} data-testid="missing-work"
      footer={<>
        {p.onWithout && <Button onClick={p.onWithout} data-testid="missing-work-without">{t(notDone ? 'invoices.draft.missing.notDone' : 'invoices.draft.missing.without')}</Button>}
        <Button variant="primary" icon={<Receipt />} onClick={p.onAdd} data-testid="missing-work-add">{t('invoices.draft.missing.add')}</Button>
      </>}>
      <div class="stack">
        <p class="inv-new-work" style={{ margin: 0 }}>{p.work.map((i) => i.description).join(', ')}</p>
        <p class="muted small" style={{ margin: 0 }}>{t('invoices.draft.missing.text')}</p>
        {notDone && <p class="small" style={{ margin: 0 }} data-testid="missing-work-not-done">{t('invoices.draft.missing.notDoneText', { n: p.work.length })}</p>}
      </div>
    </Sheet>
  );
}

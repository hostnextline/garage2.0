/* « Du catalogue »: services of the price list (the booking's ServicePicker), added as lines of an invoice or an
   estimate. */
import { useEffect, useState } from 'preact/hooks';
import type { Lang } from '../../data/types';
import { t } from '../../lib/i18n';
import { Button, Sheet } from '../../ui';
import { ServicePicker } from '../moment/ServicePicker';
import type { ItemDraft } from '../../domain/moment/logic';
import { fromDrafts, type EditLine } from '../../domain/money/editLines';

export function CatalogSheet(p: { open: boolean; onClose: () => void; docLang: Lang; onAdd: (lines: EditLine[]) => void }) {
  const [picked, setPicked] = useState<ItemDraft[]>([]);
  useEffect(() => { if (p.open) setPicked([]); }, [p.open]);
  return (
    <Sheet open={p.open} onClose={p.onClose} title={t('invoices.catalog.title')} sub={t('invoices.catalog.sub')} wide data-testid="catalog-sheet"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!picked.length} onClick={() => { p.onAdd(fromDrafts(picked)); p.onClose(); }} data-testid="catalog-add">
          {picked.length ? t('invoices.catalog.add', { n: picked.length }) : t('invoices.catalog.pick')}
        </Button>
      </>}>
      <ServicePicker value={picked} onValue={setPicked} lang={p.docLang} allowCustom={false} />
    </Sheet>
  );
}

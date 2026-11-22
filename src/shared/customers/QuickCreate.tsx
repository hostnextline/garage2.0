/* The picker's short sheet « Nouveau client »: prénom, nom, téléphone, adresse, langue. What was typed in the search
   fills it; a phone already on a file offers « Choisir {name} ». While « Créer » runs (it may wait a moment for the
   position of the address, R163) the sheet cannot be left: a customer saved after « Annuler » was picked into the
   booking the person thought they had left. */
import { useEffect, useRef } from 'preact/hooks';
import { UserPlus } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { customerName } from '../../data/select';
import { Button, Sheet, Banner, run } from '../../ui';
import { CustomerFields } from './CustomerFields';
import { emptyDraft, type Draft } from './draft';
import { useCustomerDraft } from './useCustomerDraft';
import { createCustomer } from './create';

export function QuickCreate(p: { initial: Partial<Draft>; onClose: () => void; onCreated: (id: string) => void }) {
  const f = useCustomerDraft(() => emptyDraft(p.initial));
  // the sheet is gone (a navigation closed it): a save that ends later picks nothing
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const close = () => { if (!f.isSaving()) p.onClose(); };
  const create = () => f.once(async () => {
    if (!f.ready()) return;
    const id = await run(() => createCustomer(f.draft), { ok: t('customers.file.created') });
    if (id && alive.current) p.onCreated(id);
  });
  return (
    <Sheet open onClose={close} dismissable={!f.saving} title={t('customers.picker.createTitle')} data-testid="quick-create"
      footer={<>
        <Button onClick={close} disabled={f.saving}>{t('common.cancel')}</Button>
        <Button variant="primary" icon={<UserPlus size={18} />} onClick={create} busy={f.saving} data-testid="quick-create-ok">{t('customers.picker.createOk')}</Button>
      </>}>
      {f.bad && <Banner kind="bad">{t('customers.form.fix')}</Banner>}
      <CustomerFields draft={f.draft} set={f.set} errors={f.errors} short autoFocus={!p.initial.first_name}
        dupAction={(c) => <Button onClick={() => { if (!f.isSaving()) p.onCreated(c.id); }} data-testid="dup-pick">{t('customers.dup.pick', { name: c.first_name || customerName(c) })}</Button>} />
    </Sheet>
  );
}

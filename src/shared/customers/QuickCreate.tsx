/* The picker's short sheet « Nouveau client »: prénom, nom, téléphone, adresse, langue. What was typed in the search
   fills it; a phone already on a file offers « Choisir {name} ». */
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
  const create = () => f.once(async () => {
    if (!f.ready()) return;
    const id = await run(() => createCustomer(f.draft), { ok: t('customers.file.created') });
    if (id) p.onCreated(id);
  });
  return (
    <Sheet open onClose={p.onClose} title={t('customers.picker.createTitle')} data-testid="quick-create"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" icon={<UserPlus size={18} />} onClick={create} data-testid="quick-create-ok">{t('customers.picker.createOk')}</Button>
      </>}>
      {f.bad && <Banner kind="bad">{t('customers.form.fix')}</Banner>}
      <CustomerFields draft={f.draft} set={f.set} errors={f.errors} short autoFocus={!p.initial.first_name}
        dupAction={(c) => <Button onClick={() => p.onCreated(c.id)} data-testid="dup-pick">{t('customers.dup.pick', { name: c.first_name || customerName(c) })}</Button>} />
    </Sheet>
  );
}

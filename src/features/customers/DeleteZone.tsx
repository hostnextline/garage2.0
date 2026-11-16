/* « Supprimer ce client » (two taps, the « clients » right): blocked by a coming appointment or money owed. The rules
   are those of this device's rows; the server-side rule is asked for in the rebuild's requests (customers-a-09). */
import { Trash2 } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { jobsOfCustomer } from '../../data/select';
import { deleteCustomer } from '../../data/api';
import { can } from '../../data/auth';
import type { Customer } from '../../data/types';
import { Button, attempt } from '../../ui';
import { factsOf, isUpcoming } from '../../shared/customers/facts';
import { currentDay } from '../../domain/oil/clock';

export function DeleteZone(p: { c: Customer; onLeaving: (on: boolean) => void; onDeleted: () => void }) {
  if (!can('clients')) return null;
  // (the day is a signal: an appointment of yesterday no longer blocks after midnight)
  const upcoming = jobsOfCustomer(p.c.id).some((j) => isUpcoming(j, currentDay.value));
  const owed = factsOf(p.c.id).owed;
  const blocked = upcoming ? t('customers.file.deleteBlockedJobs') : owed > 0 ? t('customers.file.deleteBlockedOwed', { amount: money(owed, lang.value) }) : null;
  const remove = async () => {
    // the file leaves the device inside deleteCustomer: the screen knows it is leaving before that
    p.onLeaving(true);
    if (await attempt(() => deleteCustomer(p.c.id), { ok: t('customers.file.deleted') })) p.onDeleted();
    else p.onLeaving(false);
  };
  return (
    <div class="customers-danger">
      <p class="small muted" style={{ margin: 0 }}>{blocked || t('customers.file.deleteHint')}</p>
      <Button variant="danger" icon={<Trash2 size={18} />} disabled={!!blocked} confirm={t('common.confirmDelete')} data-testid="customer-delete" onClick={remove}>{t('customers.file.delete')}</Button>
    </div>
  );
}

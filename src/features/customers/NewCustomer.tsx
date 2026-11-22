/* #/customer/new?name=&phone=: the new customer's file, and his car right away (optional). « Créer la fiche » opens the
   file, « Créer et réserver » the booking with the customer (and the car) already chosen. Entrée in a field goes to the
   next field; only the buttons create. */
import { useState } from 'preact/hooks';
import { UserPlus, CalendarPlus } from 'lucide-preact';
import { may } from '../../domain/rights';
import { navigate } from '../../platform/router';
import { touch } from '../../platform/media';
import { useFocusOnMount } from '../../ui/hooks';
import { t } from '../../lib/i18n';
import { Page, Panel, Button, Banner, Empty, Form, run } from '../../ui';
import { draftFromQuery } from '../../shared/customers/search';
import { CustomerFields } from '../../shared/customers/CustomerFields';
import { emptyDraft } from '../../shared/customers/draft';
import { useCustomerDraft } from '../../shared/customers/useCustomerDraft';
import { createCustomer, mayCreateCustomer } from '../../shared/customers/create';
import { CarForm, EMPTY_CAR, carIsEmpty, carErrors, type AddDraft, type AddMode } from '../../shared/vehicles/VehicleBits';
import { enterGoesNext } from './enterNext';

export function NewCustomer(p: { query: URLSearchParams }) {
  const f = useCustomerDraft(() => {
    const typed = draftFromQuery(p.query.get('name') || '');
    return emptyDraft({ first_name: typed.first_name, last_name: typed.last_name, phone: p.query.get('phone') || typed.phone });
  });
  const [saving, setSaving] = useState<'' | 'file' | 'book'>('');
  // the car, right away (optional): saved with the customer when something is typed
  const [car, setCar] = useState<AddDraft>(EMPTY_CAR);
  const [carMode, setCarMode] = useState<AddMode>('ymm');
  const carBad = () => { if (carIsEmpty(car)) return false; const e = carErrors(car, carMode); return !!(e.year || e.model || e.vin); };
  useFocusOnMount(!touch.value, () => document.querySelector<HTMLInputElement>(f.draft.first_name ? '.customers-new input[type=tel]' : '.customers-new [data-testid=cf-first]'));
  const save = (thenBook: boolean) => f.once(async () => {
    const ok = f.ready();
    if (!ok || carBad()) { setTimeout(() => document.querySelector<HTMLElement>('.customers-new [aria-invalid="true"]')?.focus(), 0); return; }
    setSaving(thenBook ? 'book' : 'file');
    try {
      const withCar = !carIsEmpty(car);
      const id = await run(() => createCustomer(f.draft, withCar ? car : null), { ok: withCar ? t('customers.file.createdWithCar') : t('customers.file.created') });
      if (id) navigate(thenBook ? `/book?customer=${id}` : `/customer/${id}`, { replace: true });
    } finally { setSaving(''); }
  });
  if (!mayCreateCustomer()) {
    return <Page class="customers-page" title={t('customers.form.newTitle')} back="/customers"><Panel><Empty title={t('customers.form.noRight')} text={t('common.notAllowed')} /></Panel></Page>;
  }
  return (
    <Page class="customers-page" title={t('customers.form.newTitle')} sub={t('customers.form.newSub')} back="/customers" data-testid="customer-new">
      <Panel class="customers-new">
        <Form onSubmit={() => save(false)} class="stack-lg">
          <div class="stack-lg" onKeyDown={(e) => enterGoesNext(e, '[data-testid=customer-create]')}>
            {f.bad && <Banner kind="bad">{t('customers.form.fix')}</Banner>}
            <CustomerFields draft={f.draft} set={f.set} errors={f.errors}
              dupAction={(c) => <Button size="sm" href={`#/customer/${c.id}`} data-testid="dup-open">{t('customers.dup.open')}</Button>} />
            <section class="stack customers-new-car" data-testid="new-car">
              <h3 class="customers-new-h">{t('customers.form.car')} <span class="faint">({t('common.optional')})</span></h3>
              <CarForm value={car} onPatch={(patch) => setCar((x) => ({ ...x, ...patch }))} mode={carMode} onMode={setCarMode} tried={f.tried && !carIsEmpty(car)} />
            </section>
            <div class="customers-actions">
              <Button type="submit" variant="primary" icon={<UserPlus size={18} />} busy={saving === 'file'} data-testid="customer-create">{t('customers.form.create')}</Button>
              {may.book() && <Button icon={<CalendarPlus size={18} />} busy={saving === 'book'} onClick={() => save(true)} data-testid="customer-create-book">{t('customers.form.createBook')}</Button>}
            </div>
          </div>
        </Form>
      </Panel>
    </Page>
  );
}

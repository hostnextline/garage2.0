/* « Pour qui » of an estimate: a name, a phone and a car written on the spot, or a customer file and its car.
   Facultatif: an estimate needs no customer. */
import { useState } from 'preact/hooks';
import { UserRound } from 'lucide-preact';
import type { Quote } from '../../data/types';
import { customer, customerName } from '../../data/select';
import { t } from '../../lib/i18n';
import { formatPhone } from '../../lib/text';
import { Panel, Button, Field, Input, PhoneInput } from '../../ui';
import { CustomerPicker } from '../../shared/customers/CustomerPicker';
import { VehiclePicker } from '../../shared/vehicles/VehiclePicker';
import type { QV } from './form';

export function QuoteWho(p: { q: Quote; v: QV; canEdit: boolean; set: (patch: Partial<QV>) => void }) {
  const { v, set } = p;
  const [picking, setPicking] = useState(false);
  const c = customer(v.customer_id);
  return (
    <Panel title={t('quotes.screen.who')} sub={t('quotes.screen.whoSub')} class="quote-who">
      {p.canEdit ? (
        <div class="stack">
          {c ? (
            <div class="stack">
              <div class="quote-customer">
                <UserRound aria-hidden="true" />
                <div class="grow"><b>{customerName(c)}</b>{c.phone && <span class="muted small">{formatPhone(c.phone)}</span>}</div>
                <Button variant="ghost" onClick={() => set({ customer_id: null, vehicle_id: null })} data-testid="quote-unpick">{t('quotes.screen.unpick')}</Button>
              </div>
              <Field label={t('quotes.screen.vehicle')} group optional>
                <VehiclePicker customerId={c.id} value={v.vehicle_id} onPick={(id) => set({ vehicle_id: id })} />
              </Field>
              {!v.vehicle_id && (
                <Field label={t('quotes.screen.vehicleText')} optional>
                  <Input value={v.vehicle_text} onValue={(s) => set({ vehicle_text: s })} placeholder={t('quotes.screen.vehiclePh')} maxLength={120} />
                </Field>
              )}
            </div>
          ) : (
            <>
              <div class="grid-2">
                <Field label={t('quotes.screen.contactName')} optional>
                  <Input value={v.contact_name} onValue={(s) => set({ contact_name: s })} autoComplete="off" maxLength={120} data-testid="quote-contact" />
                </Field>
                <Field label={t('quotes.screen.contactPhone')} optional>
                  <PhoneInput value={v.contact_phone} onValue={(s) => set({ contact_phone: s })} />
                </Field>
              </div>
              <Field label={t('quotes.screen.vehicleText')} optional>
                <Input value={v.vehicle_text} onValue={(s) => set({ vehicle_text: s })} placeholder={t('quotes.screen.vehiclePh')} maxLength={120} data-testid="quote-vehicle" />
              </Field>
              {picking
                ? <Field label={t('quotes.screen.pickCustomer')} group>
                  <CustomerPicker value={null} autoFocus allowCreate onPick={(id) => {
                    const cu = customer(id);
                    if (id) { set({ customer_id: id, vehicle_id: null, lang: cu?.lang === 'en' ? 'en' : cu ? 'fr' : v.lang }); setPicking(false); }
                  }} />
                  <Button variant="ghost" onClick={() => setPicking(false)}>{t('common.cancel')}</Button>
                </Field>
                : <Button variant="ghost" icon={<UserRound />} onClick={() => setPicking(true)} data-testid="quote-pick">{t('quotes.screen.pickCustomer')}</Button>}
            </>
          )}
        </div>
      ) : (
        <p style={{ margin: 0 }}>{[customerName(c) || p.q.contact_name, p.q.contact_phone ? formatPhone(p.q.contact_phone) : '', p.q.vehicle_text].filter(Boolean).join(', ') || t('quotes.noName')}</p>
      )}
    </Panel>
  );
}

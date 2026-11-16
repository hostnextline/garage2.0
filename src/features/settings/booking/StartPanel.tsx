/* « Départ des camions »: the address (with its position, a small map), its name, the number texted on the way back,
   and « Routes partagées ». */
import { t } from '../../../lib/i18n';
import { Panel, Field, Input, PhoneInput, Banner, Switch } from '../../../ui';
import { AddressField, type PlaceValue } from '../../../shared/places/AddressField';
import { MapView } from '../../../shared/map/MapView';
import type { PartProps } from './BookingSection';

export function StartPanel({ d, set, err, clear, replanNote }: PartProps & { replanNote: boolean }) {
  const place: PlaceValue = { address: d.place.address, unit: null, postal_code: null, lat: d.place.lat, lng: d.place.lng };
  const hasPos = d.place.lat != null && d.place.lng != null;
  return (
    <Panel title={t('settings.booking.start')} help={t('settings.booking.startHelp')} data-testid="booking-start">
      <div class="settings-centrale">
        <div class="stack">
          <div class="settings-address" data-testid="centrale-address">
            <AddressField value={place} label={t('settings.booking.startAddress')}
              onValue={(v) => { set((x) => ({ ...x, place: { address: v.address, lat: v.lat, lng: v.lng } })); clear('place'); }} />
          </div>
          {d.place.address && !hasPos && <Banner kind={err.place ? 'bad' : 'warn'}>{t('settings.booking.noPos')}</Banner>}
          <Field label={t('settings.booking.label')} help={t('settings.booking.labelHelp')}>
            <Input value={d.label} onValue={(v) => set((x) => ({ ...x, label: v }))} maxLength={30} autoComplete="off" data-testid="booking-start-label" />
          </Field>
          <Field label={t('settings.booking.returnPhone')} help={t('settings.booking.returnPhoneHelp')}>
            <PhoneInput value={d.return_phone} onValue={(v) => set((x) => ({ ...x, return_phone: v }))} />
          </Field>
          <Switch checked={d.shared_routes} onChange={(v) => set((x) => ({ ...x, shared_routes: v }))} label={t('settings.booking.shared')} hint={t('settings.booking.sharedHint')} data-testid="booking-shared" />
          {replanNote && <p class="small muted settings-replan" data-testid="booking-replan-note">{t('settings.booking.replanNote')}</p>}
        </div>
        {hasPos && (
          <figure class="settings-minimap">
            <MapView height="220px" controls={false} label={t('settings.booking.mapLabel')}
              markers={[{ id: 'home', kind: 'home', lat: d.place.lat!, lng: d.place.lng!, label: d.label || 'Centrale', title: d.place.address }]} />
            {d.place.address && <figcaption class="small muted">{d.place.address}</figcaption>}
          </figure>
        )}
      </div>
    </Panel>
  );
}

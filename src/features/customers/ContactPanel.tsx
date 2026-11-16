/* « Coordonnées »: phone, e-mail, the address on one line, « Position pas encore trouvée » with « Chercher » (one sure
   place: saved at once and spread to the coming appointments at that address; several: the person picks; none: the
   closest answers), the language, « À savoir », the two switches (saved at once), « Client depuis … ». */
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { MapPin } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { e164 } from '../../lib/text';
import { monthName } from '../../lib/dates';
import { saveCustomer } from '../../data/api';
import type { Customer } from '../../data/types';
import { Panel, Rows, RowItem, Kv, Button, Sheet, Switch, Pill, attempt, toast } from '../../ui';
import { searchPlaces } from '../../shared/places/AddressField';
import { locate } from '../../shared/places/locate';
import type { Suggestion } from '../../shared/places/photon';
import { oneLine } from '../../shared/places/address';
import { spreadToJobs } from '../../shared/customers/locator';
import { dayOfIso } from '../../domain/moment/dayWords';
import { positionPatch } from './positionPatch';

export function ContactPanel(p: { c: Customer; canEdit: boolean }) {
  const c = p.c;
  const [places, setPlaces] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  // a tap on a place while the previous one is being saved does nothing
  const saving = useRef(false);
  const addr = oneLine(c, t('customers.address.unitWord'));
  const since = dayOfIso(c.created_at);
  // one place fits (the same door, street and town): saved at once; several: the person picks; none: the closest answers
  const find = async () => {
    if (busy) return;
    setBusy(true);
    const r = await locate(c.address, { postal: c.postal_code, city: c.city, fresh: true });
    if (r.status === 'found') { await usePlace(r.place); setBusy(false); return; }
    if (r.status === 'choose') { setBusy(false); setPlaces(r.choices); return; }
    const s = r.status === 'offline' ? null : await searchPlaces(oneLine({ address: c.address, postal_code: c.postal_code }));
    setBusy(false);
    if (r.status === 'offline' || s?.error) toast(t('customers.contact.positionOffline'), { kind: 'bad' });
    else if (!s?.places.some((x) => x.place.lat != null)) toast(t('customers.contact.positionNone'), { kind: 'bad' });
    else setPlaces(s.places);
  };
  // the position only (and the town when the file has none): OpenStreetMap's postal code is often wrong in Canada and is
  // never saved, only a code the person typed (CLAUDE.md « Postal codes »)
  const usePlace = async (s: Suggestion) => {
    if (s.place.lat == null) { toast(t('customers.contact.positionNone'), { kind: 'bad' }); return; }
    if (saving.current) return;
    saving.current = true;
    try {
      const ok = await attempt(() => saveCustomer(positionPatch(c, s)), { ok: t('customers.contact.positionSaved') });
      if (ok) { setPlaces(null); void spreadToJobs(c.id, s.place.lat, s.place.lng); }
    } finally { saving.current = false; }
  };
  const toggle = (k: 'sms_ok' | 'card_on_file', v: boolean) => attempt(() => saveCustomer({ id: c.id, [k]: v }));
  const items: [ComponentChildren, ComponentChildren][] = [
    [t('customers.form.phone'), c.phone && <a href={`tel:${e164(c.phone) || c.phone}`} class="customers-link">{c.phone}</a>],
    [t('customers.form.email'), c.email && <a href={`mailto:${c.email}`} class="customers-link">{c.email}</a>],
    [t('customers.contact.address'), addr && (
      <span class="stack customers-addr">
        <span>{addr}</span>
        {c.lat == null && (
          <span class="customers-hint is-warn">
            <MapPin size={16} aria-hidden="true" /><span class="grow">{t('customers.contact.noPosition')}</span>
            {p.canEdit && <Button size="sm" busy={busy} onClick={() => find()} data-testid="find-position">{t('customers.address.find')}</Button>}
          </span>
        )}
      </span>
    )],
    [t('customers.contact.lang'), c.lang === 'en' ? t('customers.form.langEn') : t('customers.form.langFr')],
    [t('customers.form.notes'), c.notes && <span class="customers-prewrap">{c.notes}</span>]
  ];
  if (!p.canEdit) items.push([t('customers.form.sms'), c.sms_ok !== false ? t('common.yes') : t('common.no')], [t('customers.form.card'), c.card_on_file ? t('common.yes') : t('common.no')]);
  const empty = !c.phone && !c.email && !addr;
  return (
    <Panel title={t('customers.contact.title')} data-testid="contact-panel">
      <div class="stack">
        {empty && <p class="muted" style={{ margin: 0 }}>{t('customers.contact.none')}</p>}
        <Kv items={items} class="customers-kv" />
        {p.canEdit && (
          <div class="customers-switches">
            <Switch checked={c.sms_ok !== false} onChange={(v) => { void toggle('sms_ok', v); }} label={t('customers.form.sms')} hint={t('customers.form.smsHint')} data-testid="sw-sms" />
            <Switch checked={!!c.card_on_file} onChange={(v) => { void toggle('card_on_file', v); }} label={t('customers.form.card')} hint={t('customers.form.cardHint')} data-testid="sw-card" />
          </div>
        )}
        {since && <p class="faint small" style={{ margin: 0 }}>{t('customers.contact.since', { month: monthName(since, lang.value) })}</p>}
      </div>
      {places && (
        <Sheet open onClose={() => setPlaces(null)} title={t('customers.contact.pickPosition')} sub={addr}>
          <Rows>
            {places.map((s) => (
              <RowItem key={s.key} start={<MapPin size={20} aria-hidden="true" />} title={s.label} sub={s.sub} onClick={() => void usePlace(s)}
                end={!s.exact ? <Pill tone="warn" dot={false}>{t('customers.contact.streetOnly')}</Pill> : undefined} />
            ))}
          </Rows>
        </Sheet>
      )}
    </Panel>
  );
}

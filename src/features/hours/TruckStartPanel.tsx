/* « Départ de ce camion » (Part 18): where one truck leaves from in the morning. By default « Départ des camions »
   (Réglages, Réservations); a mechanic who takes his truck home can leave from his own address. The afternoon and
   the evening start from his last stop of the block before. Saving re-plans the coming appointments on the server
   (set_truck_start); the phone brings them back at once. */
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { settings, truck as truckRow } from '../../data/select';
import { setTruckStart } from '../../data/api';
import { flush, pull } from '../../data/sync';
import type { TruckStart } from '../../data/types';
import { Panel, Field, Input, Seg, Button, Banner, attempt } from '../../ui';
import { AddressField, type PlaceValue } from '../customers/AddressField';

type Mode = 'home' | 'own';
interface Draft { mode: Mode; label: string; address: string; lat: number | null; lng: number | null }

const draftOf = (s: TruckStart | null | undefined): Draft =>
  s ? { mode: 'own', label: s.label || '', address: s.address || '', lat: s.lat, lng: s.lng } : { mode: 'home', label: '', address: '', lat: null, lng: null };

/** what will be sent: null = « Départ des camions »; undefined = the address is not found on the map yet */
export function startOf(d: Draft): TruckStart | null | undefined {
  if (d.mode === 'home') return null;
  if (d.lat == null || d.lng == null) return undefined;
  return { label: d.label.trim().slice(0, 30) || null, address: d.address.trim() || null, lat: d.lat, lng: d.lng };
}
export const sameStart = (a: TruckStart | null | undefined, b: TruckStart | null | undefined) =>
  (a ?? null) === null ? (b ?? null) === null
    : !!b && a!.lat === b.lat && a!.lng === b.lng && (a!.label || null) === (b.label || null) && (a!.address || null) === (b.address || null);

/** the words for where a truck leaves from (rows, map legend) */
export function startWords(s: TruckStart | null | undefined): string {
  if (s) return [s.label, s.address].filter(Boolean).join(', ') || t('hours.start.own');
  const h = settings.value.booking?.home;
  return t('hours.start.fromHome', { place: [h?.label || 'Centrale', h?.address].filter(Boolean).join(', ') });
}

export function TruckStartPanel(p: { truckId: string; canEdit: boolean }) {
  const tr = truckRow(p.truckId);
  const saved = tr?.start ?? null;
  const savedKey = JSON.stringify(saved);
  const [d, setD] = useState<Draft>(() => draftOf(saved));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setD(draftOf(saved)); setErr(null); }, [p.truckId, savedKey]);
  if (!tr) return null;

  const next = startOf(d);
  const dirty = next === undefined ? d.mode === 'own' && (d.address.trim() !== (saved?.address || '')) : !sameStart(next, saved);
  const home = settings.value.booking?.home;

  const save = async () => {
    if (next === undefined) { setErr(t('hours.start.noPos')); return; }
    const moved = (next?.lat ?? null) !== (saved?.lat ?? null) || (next?.lng ?? null) !== (saved?.lng ?? null);
    const ok = await attempt(() => setTruckStart(tr.id, next), { ok: moved ? t('hours.start.moved') : t('hours.start.saved') });
    if (!ok) return;
    // the server planned the coming appointments again: bring them now
    if (moved) void flush().then(() => pull('jobs')).catch(() => undefined);
  };

  if (!p.canEdit) {
    return (
      <Panel title={t('hours.start.title')} help={t('hours.start.help')} data-testid="truck-start-panel">
        <p class="small" style={{ margin: 0 }} data-testid="truck-start-words">{startWords(saved)}</p>
      </Panel>
    );
  }

  const place: PlaceValue = { address: d.address, unit: null, postal_code: null, lat: d.lat, lng: d.lng };
  return (
    <Panel title={t('hours.start.title')} sub={t('hours.start.sub')} help={t('hours.start.help')} data-testid="truck-start-panel">
      <div class="stack">
        <Field label={t('hours.start.mode')} group>
          <Seg<Mode> value={d.mode} onValue={(m) => { setD((x) => ({ ...x, mode: m })); setErr(null); }} label={t('hours.start.mode')} data-testid="truck-start-mode"
            options={[
              { value: 'home', label: home?.label || 'Centrale' },
              { value: 'own', label: t('hours.start.ownOption') }
            ]} />
        </Field>
        {d.mode === 'home' && <p class="small muted" style={{ margin: 0 }}>{startWords(null)}</p>}
        {d.mode === 'own' && (
          <>
            <div data-testid="truck-start-address">
              <AddressField value={place} label={t('hours.start.address')}
                onValue={(v) => { setD((x) => ({ ...x, address: v.address, lat: v.lat, lng: v.lng })); setErr(null); }} />
            </div>
            {(err || (d.address.trim() && (d.lat == null || d.lng == null))) && <Banner kind="warn">{err || t('hours.start.noPos')}</Banner>}
            <Field label={t('hours.start.label')} hint={t('hours.start.labelHint')} optional>
              <Input value={d.label} onValue={(v) => setD((x) => ({ ...x, label: v }))} maxLength={30} autoComplete="off" data-testid="truck-start-label" />
            </Field>
          </>
        )}
        {dirty && <p class="small muted" style={{ margin: 0 }} data-testid="truck-start-note">{t('hours.start.replanNote')}</p>}
        {dirty && (
          <div class="row-wrap">
            <Button variant="primary" onClick={save} data-testid="truck-start-save">{t('common.save')}</Button>
            <Button variant="ghost" onClick={() => { setD(draftOf(saved)); setErr(null); }}>{t('common.cancel')}</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* The VIN box: typed, scanned with the camera, read by the server (« Lire le NIV »), and the car's visits with us
   by that VIN as soon as it has 17 characters. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { ScanLine, CarFront } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { vinYear } from '../../lib/text';
import { vinState, typedVin } from '../../domain/vehicles/vin';
import { readVin } from '../../domain/vehicles/readVin';
import type { CarFields } from '../../domain/vehicles/carDraft';
import { Button, Field, InputWithButton, IconButton, Banner } from '../../ui';
import { VinScanSheet } from './VinScanSheet';
import { VinSeen } from './VinHistory';
import '../places/customers.css';

export function VinField(p: { value: string; onValue: (v: string) => void; onDecoded?: (car: Partial<CarFields>) => void; autoFocus?: boolean; error?: string | null; customerId?: string | null }) {
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'bad'; text: string } | null>(null);
  // the decoding of the VIN shown: an answer for a VIN changed meanwhile, or after the box is gone, is dropped
  const asked = useRef(0);
  useEffect(() => () => { asked.current++; }, []);
  const v = p.value || '';
  const st = vinState(v);
  const set = (s: string) => {
    asked.current++;
    setBusy(false);
    p.onValue(typedVin(s));
    setMsg(null);
  };
  const decode = async (vin = v) => {
    if (!p.onDecoded) return;
    const n = ++asked.current;
    setBusy(true);
    const r = await readVin(vin);
    if (n !== asked.current) return;
    setBusy(false);
    if (r.ok) {
      p.onDecoded(r.car);
      const name = [r.car.year, r.car.make, r.car.model, r.car.trim].filter(Boolean).join(' ');
      setMsg({ kind: 'ok', text: t('vehicles.vin.decoded', { car: name }) + (r.note ? ` ${t('vehicles.vin.partial')}` : '') });
    } else setMsg({ kind: r.offline ? 'warn' : 'bad', text: r.message });
  };
  const status = st === 'ok' ? t('vehicles.vin.ok') : st === 'bad' ? t('vehicles.vin.bad') : st === 'old' ? t('vehicles.vin.old', { n: v.length }) : st === 'short' ? t('vehicles.vin.count', { n: v.length }) : t('vehicles.vin.where');
  const year = v.length === 17 ? vinYear(v) : null;
  return (
    <div class="stack customers-vin">
      <Field label={t('vehicles.fields.vin')} error={p.error} hint={<span class={st === 'bad' ? 'customers-warn-text' : st === 'ok' ? 'customers-ok-text' : ''} data-testid="vin-status">{status}{st === 'ok' && year ? ` ${t('vehicles.vin.year', { year })}` : ''}</span>}>
        <InputWithButton class="input-vin" value={v} onValue={set} autoComplete="off" autoCapitalize="characters" spellcheck={false} autoFocus={p.autoFocus}
          inputMode="text" maxLength={24} placeholder="2HGFC2F59KH512345" invalid={!!p.error} data-testid="vin-input"
          button={<IconButton icon={<ScanLine />} label={t('vehicles.scan.button')} onClick={() => setScan(true)} data-testid="vin-scan" />} />
      </Field>
      {p.onDecoded && (
        <Button icon={<CarFront size={18} />} disabled={v.length !== 17} busy={busy} onClick={() => decode()} data-testid="vin-decode">{t('vehicles.vin.read')}</Button>
      )}
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      {/* a car we already worked on (any owner): its visits, by the VIN */}
      {v.length === 17 && <VinSeen vin={v} customerId={p.customerId} />}
      {scan && <VinScanSheet onClose={() => setScan(false)} onVin={(vin) => { setScan(false); set(vin); if (p.onDecoded) void decode(vin); }} />}
    </div>
  );
}

/* A car (#/vehicle/:id): what it is (year, make, model, version, engine, VIN, plate, odometer, colour, tires, notes),
   its « Fiche technique » and its job history. « Lire le NIV » fills the fields from the VIN; « Scanner le NIV » reads
   the barcode with the camera where the phone can. The edit sheet is VehicleEditSheet.tsx. */
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Pencil, ScanLine, Car, UserRound } from 'lucide-preact';
import { isField } from '../../domain/rights';
import { navigate, type ScreenProps } from '../../platform/router';
import { t, tMaybe, lang } from '../../lib/i18n';
import { vinCheck } from '../../lib/text';
import { vehicle, customer, customerName, allJobs } from '../../data/select';
import { saveVehicle } from '../../data/api';
import { net } from '../../data/sync';
import { Page, Panel, Kv, Button, Empty, Skeleton, Pill, attempt, toast } from '../../ui';
import { JobTicket } from '../../shared/jobs/JobTicket';
import { jobOrder } from '../../shared/customers/facts';
import { SpecPanel } from '../../shared/vehicles/SpecPanel';
import { VinScanSheet, canScan, readVin } from '../../shared/vehicles/VehicleBits';
import { lastOil } from '../../domain/oil/select';
import { dateShort } from '../../domain/moment/dayWords';
import { useVinHistory, VinVisits } from '../../shared/vehicles/VinHistory';
import { CarHistoryButton } from '../../shared/jobs/CarHistory';
import { km, engineLine } from '../../shared/vehicles/vehicleText';
import { Plate } from '../../shared/customers/bits';
import { carName } from '../../domain/vehicles/words';
import { VehicleEditSheet } from './VehicleEditSheet';
import { specLinkPatch, vinFill } from './vehicleDraft';
import '../../shared/places/customers.css';

/** the words of a fuel or a drive code, the code itself when the dictionaries have none (R170: tMaybe, not t(k) === k) */
export const word = (group: 'fuel' | 'drive', v: string | null | undefined) => {
  if (!v) return null;
  return tMaybe(`vehicles.${group}.${v}`) ?? v;
};

export default function VehicleScreen({ params }: ScreenProps) {
  const [editing, setEditing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [reading, setReading] = useState(false);
  // set BEFORE the car is removed: it leaves the device at once, and this screen must not show « not on this phone »
  const gone = useRef(false);
  const v = vehicle(params.id);
  // (asked before any early return: the same hooks on every render)
  const byVin = useVinHistory(v?.vin, v?.customer_id ?? null);
  if (!v) {
    if (gone.current) return null;
    return (
      <Page class="customers-page" title={t('vehicles.title')} back="/customers">
        {net.value.ready
          ? <Panel><Empty icon={<Car />} title={t('vehicles.screen.notFound.title')} text={t('vehicles.screen.notFound.text')} action={<Button variant="primary" href="#/customers">{t('vehicles.screen.notFound.action')}</Button>} /></Panel>
          : <Panel><div aria-busy="true"><Skeleton h={22} lines={5} /></div></Panel>}
      </Page>
    );
  }
  const owner = customer(v.customer_id);
  const canEdit = isField();
  const jobs = allJobs.value.filter((j) => j.vehicle_id === v.id).sort((a, b) => jobOrder(b, a));
  const check = v.vin && v.vin.length === 17 ? vinCheck(v.vin) : null;
  const engine = v.engine || engineLine({ displacement: v.displacement, cylinders: v.cylinders });
  const oil = lastOil(v);
  const items: [ComponentChildren, ComponentChildren][] = [
    [t('vehicles.fields.trim'), v.trim],
    [t('vehicles.fields.engine'), engine || null],
    [t('vehicles.fields.fuel'), word('fuel', v.fuel)],
    [t('vehicles.fields.drive'), word('drive', v.drive)],
    [t('vehicles.fields.vin'), v.vin && <span class="row-wrap"><span class="customers-vin-text">{v.vin}</span>{check === 'bad' && <Pill tone="warn" dot={false}>{t('vehicles.vin.check')}</Pill>}</span>],
    [t('vehicles.fields.odometer'), v.odometer_km != null ? km(v.odometer_km, lang.value) : null],
    [t('vehicles.fields.lastOil'), oil && <span data-testid="vehicle-last-oil">{oil.ours ? t('vehicles.fields.lastOilOurs', { day: dateShort(oil.day) }) : dateShort(oil.day)}</span>],
    [t('vehicles.fields.color'), v.color],
    [t('vehicles.fields.tires'), v.tire_size],
    [t('vehicles.fields.notes'), v.notes && <span class="customers-prewrap">{v.notes}</span>]
  ];
  const empty = items.every(([, x]) => x == null || x === '' || x === false);
  // a VIN read by the camera: saved at once (the reading of what it says can take 15 s on a weak signal), then what it
  // tells fills what the file does not say yet, read from the car as it is when the answer comes; an answer for a VIN
  // that was changed meanwhile is dropped
  const scanned = async (vin: string) => {
    setScanning(false);
    const id = v.id;
    if (!(await attempt(() => saveVehicle({ id, vin, ...specLinkPatch(v, { vin }) })))) return;
    setReading(true);
    try {
      const r = await readVin(vin);
      const now = vehicle(id);
      if (!now || now.vin !== vin) return;
      const fill = r.ok ? vinFill(now, r.car) : {};
      if (Object.keys(fill).length) await attempt(() => saveVehicle({ id, ...fill, ...specLinkPatch(now, fill) }), { ok: t('vehicles.scan.savedFilled') });
      else toast(t('vehicles.scan.saved'), { kind: 'ok' });
    } finally { setReading(false); }
  };
  return (
    <Page class="customers-page" title={carName(v)} back={owner ? `/customer/${owner.id}` : '/customers'} data-testid="vehicle-screen"
      sub={<span class="customers-line">{owner && <a class="customers-link customers-owner" href={`#/customer/${owner.id}`}><UserRound size={16} aria-hidden="true" />{customerName(owner)}</a>}<Plate plate={v.plate} /></span>}
      actions={<div class="row"><CarHistoryButton car={v} />{canEdit && <Button icon={<Pencil size={18} />} onClick={() => setEditing(true)} data-testid="vehicle-edit">{t('common.edit')}</Button>}</div>}>
      <div class="customers-file">
        <div class="customers-side">
          <Panel title={t('vehicles.screen.details')} data-testid="vehicle-details"
            action={canEdit && !v.vin && canScan() && <Button icon={<ScanLine size={18} />} onClick={() => setScanning(true)} data-testid="vehicle-scan">{t('vehicles.scan.button')}</Button>}>
            {reading && <p class="small muted" role="status" style={{ margin: 0 }}>{t('customers.vehicle.vinReading')}</p>}
            {empty ? <p class="muted" style={{ margin: 0 }}>{t('vehicles.screen.empty')}</p> : <Kv items={items} class="customers-kv" />}
          </Panel>
          <SpecPanel v={v} canEdit={canEdit} />
        </div>
        <div class="customers-main">
          {byVin.state === 'ok' ? (
            /* the car's own file: every visit of this VIN, whoever owned it then */
            <Panel title={t('vehicles.vinHistory.title')} sub={t('vehicles.vinHistory.sub')} data-testid="vehicle-history">
              {byVin.visits.length ? <VinVisits visits={byVin.visits} owners /> : <p class="muted" style={{ margin: 0 }}>{t('vehicles.vinHistory.none')}</p>}
            </Panel>
          ) : (
            <Panel title={t('vehicles.screen.history')} sub={jobs.length ? t('customers.jobs.count', { n: jobs.length }) : undefined} data-testid="vehicle-history">
              <div class="stack">
                {jobs.length ? <div class="stack">{jobs.map((j) => <JobTicket key={j.id} job={j} showDay />)}</div> : <p class="muted" style={{ margin: 0 }}>{t('vehicles.screen.historyNone')}</p>}
                {byVin.state === 'none' && !v.vin && <p class="small muted" style={{ margin: 0 }}>{t('vehicles.vinHistory.noVin')}</p>}
                {byVin.state === 'error' && <p class="small muted" style={{ margin: 0 }}>{t('vehicles.vinHistory.offline')}</p>}
              </div>
            </Panel>
          )}
        </div>
      </div>
      {scanning && <VinScanSheet onClose={() => setScanning(false)} onVin={(vin) => void scanned(vin)} />}
      {editing && <VehicleEditSheet v={v} onClose={() => setEditing(false)} onLeaving={(on) => { gone.current = on; }}
        onRemoved={() => { setEditing(false); setTimeout(() => navigate(owner ? `/customer/${owner.id}` : '/customers', { replace: true }), 0); }} />}
    </Page>
  );
}

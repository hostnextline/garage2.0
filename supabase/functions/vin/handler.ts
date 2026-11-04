// Reads a VIN with the free NHTSA database: year, make, model, engine, fuel, drive. Team members only.
import { serve, json, body, fail, env, withTimeout } from '../_shared/http.ts';
import { caller } from '../_shared/db.ts';

const FUEL: Record<string, string> = { Gasoline: 'essence', Diesel: 'diesel', Electric: 'electrique', 'Flexible Fuel Vehicle (FFV)': 'e85', 'Compressed Natural Gas (CNG)': 'gnc' };
const DRIVE: Record<string, string> = { 'FWD/Front-Wheel Drive': 'fwd', 'RWD/Rear-Wheel Drive': 'rwd', 'AWD/All-Wheel Drive': 'awd', '4WD/4-Wheel Drive/4x4': '4wd', '4x2': '2wd' };

export const handler = serve(async (req) => {
  await caller(req);
  const b = await body(req);
  const vin = String(b.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) fail('vin', 'Un VIN a 17 caractères (jamais de I, O ou Q).');
  const r = await withTimeout(fetch(`${env('VPIC_BASE', 'https://vpic.nhtsa.dot.gov')}/api/vehicles/DecodeVinValues/${vin}?format=json`), 10000, 'service de VIN');
  if (!r.ok) fail('vpic', 'La base des VIN ne répond pas. Réessaie ou tape le véhicule.', 502);
  const d = (await r.json())?.Results?.[0] || {};
  const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : null; };
  const hybrid = /HEV|Hybrid/i.test(String(d.ElectrificationLevel || ''));
  const out = {
    vin,
    year: num(d.ModelYear),
    make: d.Make ? String(d.Make).replace(/\b\w+/g, (w: string) => (w.length <= 3 ? w.toUpperCase() : w[0] + w.slice(1).toLowerCase())) : null,
    model: d.Model || null,
    trim: [d.Trim, d.Series].filter(Boolean).join(' ') || null,
    displacement: num(d.DisplacementL) ? Math.round(Number(d.DisplacementL) * 10) / 10 : null,
    cylinders: num(d.EngineCylinders),
    turbo: /yes/i.test(String(d.Turbo || '')) || null,
    fuel: hybrid ? 'hybride' : FUEL[String(d.FuelTypePrimary || '')] || (d.FuelTypePrimary ? String(d.FuelTypePrimary).toLowerCase() : null),
    drive: DRIVE[String(d.DriveType || '')] || null,
    engine: d.EngineModel || d.EngineConfiguration || null,
    body: d.BodyClass || null,
    error: d.ErrorCode && !/^0/.test(String(d.ErrorCode)) ? String(d.ErrorText || '').slice(0, 200) : null
  };
  return json({ ok: true, vehicle: out });
});

/* The words of « Le véhicule d'abord » (pure, tested in carWords.test.ts). */
import type { Vehicle, JobItem } from '../../data/types';
import type { CarFacts } from '../inventory/needs';
import { oilGrade } from '../inventory/needs';
import { t } from '../../lib/i18n';

/** « 2015 Volkswagen Golf » and « 1.8 L TSI, 4 cyl. » */
export function carLine(v: Pick<Vehicle, 'year' | 'make' | 'model' | 'trim' | 'engine' | 'displacement' | 'cylinders'> | undefined | null): { name: string; detail: string } {
  if (!v) return { name: '', detail: '' };
  const name = [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
  const disp = v.displacement ? `${Number(v.displacement).toFixed(1)} L` : '';
  const detail = [[disp, v.engine].filter(Boolean).join(' '), v.cylinders ? t('jobs.carFirst.cyl', { n: v.cylinders }) : ''].filter(Boolean).join(', ');
  return { name, detail };
}

/** « Huile 5W-30 », « 4,5 L, filtre PH7317 »; to confirm when it comes from the engine list, not the car's sheet */
export function oilLine(f: CarFacts, lang: string): { known: boolean; main: string; sub: string; toConfirm: boolean } {
  const g = oilGrade(f.values.oil_visc == null ? '' : String(f.values.oil_visc));
  const grade = g.grade ? [g.grade, g.spec].filter(Boolean).join(' ') : (f.values.oil_visc ? String(f.values.oil_visc) : '');
  const l = Number(f.values.oil_l);
  const litres = l > 0 ? t('jobs.carFirst.litres', { n: l.toLocaleString(lang === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 1 }) }) : '';
  const filter = f.values.oil_filter ? t('jobs.carFirst.filter', { ref: String(f.values.oil_filter) }) : '';
  const toConfirm = (['oil_visc', 'oil_l', 'oil_filter'] as const).some((k) => f.values[k] != null && f.from[k] === 'list');
  return { known: !!grade, main: grade ? t('jobs.carFirst.oil', { grade }) : '', sub: [litres, filter].filter(Boolean).join(', '), toConfirm };
}

/** the work to do: the planned and accepted lines (not the declined ones, not the discounts), else the problem told */
export function workLines(items: Pick<JobItem, 'description' | 'status' | 'kind' | 'qty' | 'deleted_at'>[], problem: string | null | undefined): string[] {
  const out = items
    .filter((i) => !i.deleted_at && ['planned', 'done', 'approved', 'proposed'].includes(i.status) && i.kind !== 'discount')
    .map((i) => `${Number(i.qty) > 1 ? `${Number(i.qty)} × ` : ''}${i.description}`.trim())
    .filter(Boolean);
  if (!out.length && problem?.trim()) out.push(problem.trim());
  return out;
}

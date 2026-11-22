/* How far ahead one can book, the numbers of the route estimate and the two garde-route limits (0 = no limit). */
import { t } from '../../../lib/i18n';
import { Panel, Field } from '../../../ui';
import { NumInput } from '../fields';
import { NUMS, type NumDef } from './model';
import type { PartProps } from './BookingSection';

const unitOf = (u: NumDef['unit']) => (u === 'days' ? t('settings.booking.days') : u === 'kmh' ? 'km/h' : u === 'pct' ? '%' : u === 'km' ? 'km' : t('settings.booking.minutes'));

export function PlanNumbers({ d, set, err, clear }: PartProps) {
  return (
    <Panel title={t('settings.booking.plan')} help={t('settings.booking.planHelp')}>
      <div class="settings-grid-3">
        {NUMS.map((n) => (
          <Field key={n.k} label={t(`settings.booking.${n.label}`)} help={t(`settings.booking.${n.label}Help`)} error={err[n.k]}>
            <NumInput value={d[n.k]} onValue={(v) => { set((x) => ({ ...x, [n.k]: v })); clear(n.k); }}
              unit={unitOf(n.unit)} decimals={n.decimals} invalid={!!err[n.k]} aria-label={t(`settings.booking.${n.label}`)} data-testid={`booking-${n.k}`} />
          </Field>
        ))}
      </div>
    </Panel>
  );
}

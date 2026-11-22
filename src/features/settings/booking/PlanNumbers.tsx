/* How far ahead one can book, the numbers of the route estimate and the two garde-route limits (0 = no limit).
   With the real roads on (Part 27) the speed, the detour and the « near » distance are not used by the server: they stay
   here (the owner may switch back) marked « utilisé seulement sans les vraies routes », and the unknown time also counts
   a trip not measured yet. */
import { t } from '../../../lib/i18n';
import { Panel, Field } from '../../../ui';
import { NumInput } from '../fields';
import { NUMS, type NumDef } from './model';
import type { PartProps } from './BookingSection';

export const unitOf = (u: NumDef['unit']) => (u === 'days' ? t('settings.booking.days') : u === 'kmh' ? 'km/h' : u === 'pct' ? '%' : u === 'km' ? 'km'
  : u === 'tx' ? t('settings.booking.roads.txUnit') : t('settings.booking.minutes'));

export function PlanNumbers({ d, set, err, clear, roadsOn = false }: PartProps & { roadsOn?: boolean }) {
  const helpOf = (n: NumDef) => t(roadsOn && n.k === 'unknown_min' ? 'settings.booking.unknownHelpRoads' : `settings.booking.${n.label}Help`);
  return (
    <Panel title={t('settings.booking.plan')} help={t(roadsOn ? 'settings.booking.planHelpRoads' : 'settings.booking.planHelp')} data-testid="booking-plan">
      <div class="settings-grid-3">
        {NUMS.map((n) => (
          <Field key={n.k} label={t(`settings.booking.${n.label}`)} help={helpOf(n)} error={err[n.k]}
            hint={roadsOn && n.estimate ? <span data-testid={`booking-${n.k}-estimate`}>{t('settings.booking.roads.onlyEstimate')}</span> : undefined}>
            <NumInput value={d[n.k]} onValue={(v) => { set((x) => ({ ...x, [n.k]: v })); clear(n.k); }}
              unit={unitOf(n.unit)} decimals={n.decimals} invalid={!!err[n.k]} aria-label={t(`settings.booking.${n.label}`)} data-testid={`booking-${n.k}`} />
          </Field>
        ))}
      </div>
    </Panel>
  );
}

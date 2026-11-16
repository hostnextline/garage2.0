/* Which vehicle: in « Options » for an appointment (only if the customer wants that mechanic: the app chooses
   otherwise), and in the form itself when the person must say it (a walk-in nobody drives, or a mechanic who may take
   several vehicles); « carte au dossier ». */
import { t } from '../../lib/i18n';
import { activeTrucks, truckLabel, truckColor } from '../../data/select';
import { Panel, Field, Chips, Check } from '../../ui';
import type { Action } from './draft';

type Act = (a: Action) => void;

function TruckChips(p: { label: string; value: string | null; ids: string[]; auto: boolean; act: Act }) {
  return (
    <Chips label={p.label} value={[p.value || '']} onValue={(v) => p.act({ t: 'truck', id: v[0] || null })}
      options={[...(p.auto ? [{ value: '', label: t('booking.options.truckAuto') }] : []), ...p.ids.map((id) => ({
        value: id, label: <span class="row" style={{ gap: '6px' }}><span class="book-dot" style={{ background: truckColor(id) }} aria-hidden="true" />{truckLabel(id)}</span>
      }))]} />
  );
}

/** « Options »: the vehicle by hand (owner, office), the card on file */
export function OptionsPanel(p: { pickTruck: boolean; truckId: string | null; card: boolean | null; act: Act }) {
  const label = t('booking.options.truck');
  return (
    <details class="book-options glass panel" data-testid="book-options">
      <summary><span class="panel-title">{t('booking.options.title')}</span></summary>
      <div class="stack book-options-body">
        {p.pickTruck && (
          <Field label={label} hint={t('booking.options.truckHint')} group>
            <TruckChips label={label} value={p.truckId} ids={activeTrucks.value.map((x) => x.id)} auto act={p.act} />
          </Field>
        )}
        <Check checked={!!p.card} onChange={(on) => p.act({ t: 'card', on })} label={t('booking.options.card')} hint={t('booking.options.cardHint')} />
      </div>
    </details>
  );
}

/** the vehicle that does the job, when it is not obvious: never one picked for the person */
export function TruckPanel(p: { ids: string[]; truckId: string | null; act: Act }) {
  const label = t('booking.options.walkInTruck');
  return (
    <Panel title={label} data-testid="book-truck">
      <TruckChips label={label} value={p.truckId} ids={p.ids} auto={false} act={p.act} />
    </Panel>
  );
}

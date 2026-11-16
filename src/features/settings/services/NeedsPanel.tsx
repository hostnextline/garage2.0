/* What the service takes that depends on the car (the needs of the week): said here, or guessed from its name. */
import { t } from '../../../lib/i18n';
import type { Need, NeedKind, TireSeason } from '../../../data/types';
import { Panel, Button, Field, Seg, Stepper, Chips } from '../../../ui';
import { NEED_KINDS, guessNeeds } from '../../../domain/stock/needs';
import type { ServiceDraft } from './serviceModel';

export function NeedsPanel(p: { d: ServiceDraft; onNeeds: (n: Need[] | null) => void }) {
  const guessed = p.d.needs == null;
  const needs = guessed ? guessNeeds({ name_fr: p.d.name_fr, name_en: p.d.name_en, includes: p.d.includes }) : p.d.needs!;
  const kinds = needs.map((n) => n.kind);
  const tires = needs.find((n) => n.kind === 'tires');
  const set = (next: Need[]) => p.onNeeds(next);
  const pick = (ks: NeedKind[]) => set(NEED_KINDS.filter((k) => ks.includes(k)).map((k) => needs.find((n) => n.kind === k) || (k === 'tires' ? { kind: k, qty: 4, season: null } : { kind: k })));
  const tire = (patch: Partial<Need>) => set(needs.map((n) => (n.kind === 'tires' ? { ...n, ...patch } : n)));
  return (
    <Panel plain title={t('settings.services.needs.title')} help={t('settings.services.needs.help')} data-testid="service-needs">
      <div class="stack">
        <Chips multiple label={t('settings.services.needs.title')} value={kinds} onValue={(v) => pick(v as NeedKind[])} data-testid="service-needs-kinds"
          options={NEED_KINDS.map((k) => ({ value: k, label: t(`settings.services.needs.kinds.${k}`) }))} />
        {tires && (
          <div class="grid-2">
            <Field label={t('settings.services.needs.tiresQty')} group>
              <Stepper value={tires.qty || 4} onValue={(v) => tire({ qty: v })} min={1} max={8} label={t('settings.services.needs.tiresQty')} />
            </Field>
            <Field label={t('settings.services.needs.season')} group>
              <Seg value={(tires.season || 'any') as TireSeason | 'any'} onValue={(v) => tire({ season: v === 'any' ? null : (v as TireSeason) })} label={t('settings.services.needs.season')}
                options={(['winter', 'summer', 'all', 'any'] as const).map((x) => ({ value: x, label: t(`settings.services.needs.seasons.${x}`) }))} />
            </Field>
          </div>
        )}
        <p class="small muted" style={{ margin: 0 }} data-testid="service-needs-note">
          {guessed ? (kinds.length ? t('settings.services.needs.guessed') : t('settings.services.needs.guessedNone')) : kinds.length ? t('settings.services.needs.said') : t('settings.services.needs.nothing')}
        </p>
        {!guessed && <div><Button size="sm" variant="ghost" onClick={() => p.onNeeds(null)} data-testid="service-needs-guess">{t('settings.services.needs.backToGuess')}</Button></div>}
      </div>
    </Panel>
  );
}

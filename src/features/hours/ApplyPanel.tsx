/* « Appliquer »: for when the drawing counts (one day, N weeks from a date, from now on), what it does in words, the
   appointments of this truck on the dates touched, and the button. */
import { t, lang } from '../../lib/i18n';
import { addDays, dow, isValidDay, longDay, parseDay, type Day } from '../../lib/dates';
import { windowsOn } from '../../data/select';
import { Panel, Button, Seg, Field, Stepper, DateInput } from '../../ui';
import { spanEnds, rangesWords, weekdaysWords } from '../../domain/moment/words';
import type { ApplyPlan, Mode } from './grid';

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const SHORT = new Map<string, Intl.DateTimeFormat>();
const shortDay = (day: Day, l: string) => {
  let f = SHORT.get(l);
  if (!f) { f = new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'short', day: 'numeric', month: 'short' }); SHORT.set(l, f); }
  return f.format(parseDay(day));
};

export function ApplyPanel(p: {
  mode: Mode; onMode: (m: Mode) => void; weeks: number; onWeeks: (n: number) => void;
  from: Day; onFrom: (d: Day) => void; today: Day; lastDay: Day;
  plan: ApplyPlan; jobsHit: number; alwaysReplaces: boolean;
  /** this phone does not hold every appointment of the truck: the count may be short */
  blind: boolean;
  canEdit: boolean; onApply: () => Promise<unknown>;
}) {
  const l = lang.value;
  const { mode, plan } = p;
  const effect = plan.empty ? '' : mode === 'day'
    ? t('hours.apply.effectDay', { day: longDay(p.from, l), hours: lower(rangesWords(plan.week[dow(p.from)] || [], l)) })
    : mode === 'weeks'
      ? t('hours.apply.effectWeeks', { days: weekdaysWords(plan.dows, l), weeks: t('hours.apply.weeksN', { n: p.weeks }), ...spanEnds(p.from, addDays(p.from, p.weeks * 7 - 1), l, p.today) })
      : t('hours.apply.effectAlways', { days: weekdaysWords(plan.dows, l) });
  const dayLabel = p.from === p.today ? t('hours.apply.today') : t('hours.apply.oneDay', { day: shortDay(p.from, l) });
  return (
    <Panel class="hours-apply" title={t('hours.apply.title')} data-tour="hours-apply" data-testid="hours-apply">
      <div class="stack">
        <Field label={t('hours.apply.mode')} group>
          <Seg value={mode} onValue={p.onMode} label={t('hours.apply.mode')} class="hours-modes" data-testid="hours-mode"
            options={[{ value: 'day', label: dayLabel }, { value: 'weeks', label: t('hours.apply.weeks', { weeks: t('hours.apply.weeksN', { n: p.weeks }) }) }, { value: 'always', label: t('hours.apply.always') }]} />
        </Field>
        {mode === 'weeks' && (
          <Field label={t('hours.apply.weeksLabel')} group>
            <Stepper value={p.weeks} min={1} max={12} label={t('hours.apply.weeksLabel')} format={(n) => t('hours.apply.weeksN', { n })} onValue={p.onWeeks} />
          </Field>
        )}
        {mode !== 'always' && (
          <Field label={mode === 'day' ? t('hours.apply.on') : t('hours.apply.from')}>
            <DateInput value={p.from} min={p.today} max={p.lastDay} onValue={(v) => { if (isValidDay(v) && v >= p.today) p.onFrom(v); }} />
          </Field>
        )}
        <div class="hours-effect" aria-live="polite" data-testid="hours-effect">
          {plan.empty ? <p class="muted">{mode === 'day' ? t('hours.apply.nothingDay') : t('hours.apply.nothing')}</p> : (
            <>
              <p class="hours-effect-what">{effect}</p>
              {p.alwaysReplaces && <p>{t('hours.apply.effectAlwaysDays')}</p>}
              <p>{t(windowsOn.value ? 'hours.win.tail' : 'hours.apply.tail')}</p>
              {p.jobsHit > 0 && <p class="hours-effect-jobs">{t('hours.apply.jobs', { n: p.jobsHit })}</p>}
              {p.blind && <p>{t('hours.apply.blind')}</p>}
            </>
          )}
        </div>
        <Button variant="primary" block disabled={plan.empty || !p.canEdit} onClick={p.onApply} data-testid="hours-apply-btn">{t('hours.apply.button')}</Button>
      </div>
    </Panel>
  );
}

/* « Par où commencer » on the Today screen: the next first step of this person (one line and a button). « Plus tard »
   hides it for a week; it goes away by itself once every step is done. Placed on Today by the today section. */
import { useEffect, useState } from 'preact/hooks';
import { Compass } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { me } from '../../data/auth';
import { Button, toast } from '../../ui';
import { computeChecklist, nextStep, progress } from './checklist';
import { guideInput, nextJobId, snooze, snoozed, refreshChecks, watchScreens } from './guide-data';
import { openStep } from './tour';
import './guide.css';

export function GuideCard() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { watchScreens(); void refreshChecks(); }, []);
  if (hidden || !me.value || snoozed()) return null;
  const input = guideInput();
  if (!input) return null;
  const steps = computeChecklist(input, nextJobId());
  const nx = nextStep(steps);
  if (!nx) return null;
  const pr = progress(steps);
  const later = () => { snooze(7); setHidden(true); toast(t('guide.laterToast')); };
  return (
    <section class="panel glass guide-card" aria-labelledby="guide-card-title" data-testid="guide-card">
      <div class="guide-card-row">
        <span class="guide-card-icon" aria-hidden="true"><Compass /></span>
        <div class="grow">
          <p class="guide-card-kicker"><span>{t('guide.next')}</span><span class="faint">{t('guide.progress', pr)}</span></p>
          <a id="guide-card-title" class="guide-card-title" href="#/guide">{t(`guide.steps.${nx.id}.title`)}</a>
        </div>
      </div>
      <div class="guide-card-actions">
        <Button onClick={() => openStep(nx)} data-testid="guide-card-go">{nx.kind === 'tour' ? t('guide.tour.start') : t('guide.go')}</Button>
        <Button variant="ghost" onClick={later} data-testid="guide-card-later">{t('guide.later')}</Button>
      </div>
    </section>
  );
}

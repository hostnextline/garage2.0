/* Aujourd'hui (#/): the first screen of everyone.
   - A mechanic: « Ma journée » (the shift and the position, the next stop with its red button, the stops of the day).
   - The owner and the office: « La journée » (the trucks now, money to collect, proposals, tomorrow's confirmations).
   - The treasurer only: today's payments and the treasury.
   - An owner (or the office) who is also a mechanic: « Vue propriétaire » / « Vue mécano » on top, kept on the phone.
   Both day screens start with « Pas terminé » while a job of a past day is still open.
   The guide's « Par où commencer » card sits on top when there is something to set up. */
import { useEffect } from 'preact/hooks';
import type { ScreenProps } from '../../platform/router';
import { Page, Tabs } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { longDay } from '../../lib/dates';
import { isOwner } from '../../data/auth';
import { GuideCard } from '../../shared/guide/GuideCard';
import { TextOutcomeHost } from '../../shared/jobs/TextOutcome';
import { PartsHost } from '../../shared/jobs/PartsSheet';
import { CarCheckHost } from '../../shared/jobs/CarCheckSheet';
import { MoveHost } from '../../shared/jobs/MoveHost';
import { DayOrderHost } from '../../shared/jobs/DayOrderHost';
import { startPositionSharing } from '../../services/position';
import { todayRole, hasTwoViews } from './select';
import { dayView, setDayView } from './prefs';
import type { DayView } from './rules';
import { useToday } from './hooks';
import { MechanicDay } from './MechanicDay';
import { OfficeDay, TreasurerDay } from './TeamDay';
import './today.css';

export default function TodayScreen(_p: ScreenProps) {
  useEffect(() => { startPositionSharing(); }, []);
  const role = todayRole();
  const date = longDay(useToday(), lang.value);
  const sub = date.charAt(0).toUpperCase() + date.slice(1);
  const title = role === 'mechanic' ? t('today.mine') : role === 'office' ? t('today.team') : t('today.title');
  return (
    <Page title={title} sub={sub} wide={role === 'office'} data-testid="today-screen">
      <GuideCard />
      {hasTwoViews() && (
        <div data-testid="today-views">
          <Tabs<DayView> value={dayView.value} onValue={setDayView} label={t('today.views.label')}
            tabs={[{ value: 'office', label: t(isOwner() ? 'today.views.owner' : 'today.views.office') }, { value: 'mechanic', label: t('today.views.mechanic') }]} />
        </div>
      )}
      {role === 'mechanic' ? <MechanicDay /> : role === 'office' ? <OfficeDay /> : <TreasurerDay />}
      <TextOutcomeHost />
      <PartsHost />
      <CarCheckHost />
      {/* « Déplacer » from a stop's menu (« Les camions », « Ma journée »): the sheet on this screen */}
      <MoveHost />
      {/* « Réorganiser la journée » / « Réorganiser ma journée » / « Réorganiser demain »: the sheet on this screen */}
      <DayOrderHost />
    </Page>
  );
}

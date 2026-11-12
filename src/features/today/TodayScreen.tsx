/* Aujourd'hui (#/): the first screen of everyone.
   - A mechanic: « Ma journée » (the shift and the position, the next stop with its red button, the stops of the day).
   - The owner and the office: « La journée » (the trucks now, money to collect, proposals, tomorrow's confirmations).
   - The treasurer only: today's payments and the treasury.
   The guide's « Par où commencer » card sits on top when there is something to set up. */
import { useEffect } from 'preact/hooks';
import type { ScreenProps } from '../../app/routes';
import { Page } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { today, longDay } from '../../lib/dates';
import { GuideCard } from '../guide/GuideCard';
import { TextOutcomeHost } from '../jobs/TextOutcome';
import { PartsHost } from '../jobs/PartsSheet';
import { CarCheckHost } from '../jobs/CarCheckSheet';
import { startPositionSharing } from './position';
import { todayRole } from './select';
import { MechanicDay } from './MechanicDay';
import { OfficeDay, TreasurerDay } from './TeamDay';
import './today.css';

export default function TodayScreen(_p: ScreenProps) {
  useEffect(() => { startPositionSharing(); }, []);
  const role = todayRole();
  const date = longDay(today(), lang.value);
  const sub = date.charAt(0).toUpperCase() + date.slice(1);
  const title = role === 'mechanic' ? t('today.mine') : role === 'office' ? t('today.team') : t('today.title');
  return (
    <Page title={title} sub={sub} wide={role === 'office'} data-testid="today-screen">
      <GuideCard />
      {role === 'mechanic' ? <MechanicDay /> : role === 'office' ? <OfficeDay /> : <TreasurerDay />}
      <TextOutcomeHost />
      <PartsHost />
      <CarCheckHost />
    </Page>
  );
}

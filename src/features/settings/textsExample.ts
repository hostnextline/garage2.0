/* The example values of the preview in Réglages → Textos, in the language of the text (the garage's own name, phone,
   invoice prefix, and an arrival window in window mode). */
import { t, type Lang } from '../../lib/i18n';
import { addDays, clock, longDay, today, nowMinute } from '../../lib/dates';
import { money } from '../../lib/money';
import { appBase } from '../../lib/config';
import { settings, garageName, blockOfKey, windowsOn, windowOf } from '../../data/select';
import { momentVars } from './messages';

/** example values, in the language of the text */
export function exampleVars(l: Lang): Record<string, string> {
  const b = settings.value.billing;
  const am = blockOfKey('am');
  // « Plages d'arrivée »: the example is an arrival estimated at 3 pm, so the text shows a window and never a block
  const moment = momentVars({ window: windowsOn.value ? windowOf(15 * 60) : null, block: [am.start, am.end],
    blockWords: t('settings.texts.example.bloc', undefined, l), dayWords: t('settings.texts.example.blocDay', undefined, l) }, l === 'en' ? 'en' : 'fr');
  return {
    ...moment,
    prenom: t('settings.texts.example.prenom', undefined, l), garage: garageName.value, jour: longDay(addDays(today(), 1), l),
    payer: t('settings.texts.example.payer', undefined, l),
    total: money(17245, l), lien: `${appBase()}client.html#t=Ab3dE9xQ`,
    mecano: t('settings.texts.example.mecano', undefined, l), heure: clock(Math.min(1435, Math.ceil((nowMinute() + 25) / 5) * 5), l), minutes: '25',
    vehicule: t('settings.texts.example.vehicule', undefined, l), montant: money(8000, l),
    numero: `${b.invoice_prefix ?? 'F-'}${String(43).padStart(Number(b.pad ?? 4), '0')}`, date: longDay(today(), l),
    telephone: settings.value.company?.phone || '438 901-6606',
    services: l === 'en' ? `• Oil change: ${money(7999, l)}\n• Tire swap: ${money(7000, l)}` : `• Changement d’huile\u00a0: ${money(7999, l)}\n• Changement de pneus\u00a0: ${money(7000, l)}`,
    soustotal: `${money(14999, l)} + tx`
  };
}

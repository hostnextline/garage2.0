/* Réglages (#/settings/:section?). Computer: the list of parts on the left, the part on the right.
   Phone: the list, then the part with « Retour ». A part with changes not saved keeps them (and shows a dot) until
   they are saved or undone. Apparence and Branchements are the owner's. */
import type { ComponentType } from 'preact';
import { type LucideIcon, Building2, Receipt, Wrench, CalendarClock, MessageSquareText, FileSignature, Palette, PlugZap, Tags, ChevronRight, RefreshCw } from 'lucide-preact';
import { may } from '../../domain/rights';
import { navigate, type ScreenProps } from '../../platform/router';
import { wide } from '../../platform/media';
import { t } from '../../lib/i18n';
import { isOwner } from '../../data/auth';
import { Page, Panel } from '../../ui';
import { hasDraft, settingsHere, SectionWait } from './SectionFrame';
import { CompanySection, companySaved } from './CompanySection';
import { BillingSection, billingSaved } from './BillingSection';
import { ServicesSection } from './services/ServicesSection';
import { BookingSection, bookingSaved } from './booking/BookingSection';
import { TextsSection, textsSaved } from './TextsSection';
import { WaiverSection, waiverSaved } from './WaiverSection';
import { LookSection, lookSaved } from './LookSection';
import { ConnectSection } from './connect/ConnectSection';
import { ExpensesSection, expensesSaved } from './ExpensesSection';
import { UpdatePanel } from '../../shared/app/UpdatePanel';
import '../../shared/look/settings.css';

export type SectionKey = 'company' | 'billing' | 'services' | 'booking' | 'texts' | 'waiver' | 'look' | 'connect' | 'expenses' | 'app';
interface SectionDef {
  key: SectionKey; icon: LucideIcon; view: ComponentType; owner?: boolean; tour?: string;
  /** for everyone on the team (no « settings » right needed) */ all?: boolean;
  /** a form over the settings row: drawn only once that row is on this device */ form?: boolean;
  /** the section's fields as stored now: the dot of the list compares the draft with them (settings-team-st-5) */
  saved?: () => object;
}
const SECTIONS: SectionDef[] = [
  { key: 'company', icon: Building2, view: CompanySection, form: true, saved: companySaved, tour: 'settings-company' },
  { key: 'billing', icon: Receipt, view: BillingSection, form: true, saved: billingSaved },
  { key: 'services', icon: Wrench, view: ServicesSection, tour: 'settings-services' },
  { key: 'booking', icon: CalendarClock, view: BookingSection, form: true, saved: bookingSaved },
  { key: 'texts', icon: MessageSquareText, view: TextsSection, form: true, saved: textsSaved, tour: 'settings-texts' },
  { key: 'waiver', icon: FileSignature, view: WaiverSection, form: true, saved: waiverSaved },
  { key: 'look', icon: Palette, view: LookSection, form: true, saved: lookSaved, owner: true, tour: 'settings-look' },
  { key: 'connect', icon: PlugZap, view: ConnectSection, owner: true, tour: 'settings-connect' },
  { key: 'expenses', icon: Tags, view: ExpensesSection, form: true, saved: expensesSaved },
  { key: 'app', icon: RefreshCw, view: AppSection, all: true }
];

/** Mise à jour de l'app: the version on this device and « Vérifier les mises à jour » */
function AppSection() {
  return <div class="settings-section stack-lg" data-testid="settings-app"><UpdatePanel titled={false} /></div>;
}

export default function SettingsScreen({ params }: ScreenProps) {
  // the owner sees all; the office (« settings ») everything but the owner's; a mechanic the app's own section (updates)
  const list = SECTIONS.filter((s) => (s.owner ? isOwner() : s.all || may.settingsEdit()));
  const asked = list.find((s) => s.key === params.section);
  const isWide = wide.value;
  const current = asked || (isWide ? list[0] : undefined);
  const nav = (
    <Panel flush class="settings-nav" data-testid="settings-nav">
      <nav aria-label={t('settings.list')}>
        <div class="rows" role="list">
          {list.map((s) => {
            const Icon = s.icon;
            const on = isWide && current?.key === s.key;
            const dirty = hasDraft(s.key, s.saved);
            return (
              <a key={s.key} role="listitem" class={`row-item settings-nav-row${on ? ' is-on' : ''}`} href={`#/settings/${s.key}`} aria-current={on ? 'page' : undefined}
                data-tour={s.tour} data-testid={`settings-nav-${s.key}`}
                onClick={(e) => { e.preventDefault(); navigate(`/settings/${s.key}`, { replace: isWide && !!asked }); }}>
                <span class="quick-icon" aria-hidden="true"><Icon size={20} /></span>
                <span class="row-main">
                  <span class="row-title">{t(`settings.sections.${s.key}.title`)}</span>
                  <span class="row-sub">{dirty ? <span class="settings-dirty-word"><span class="settings-dot" aria-hidden="true" />{t('settings.unsaved')}</span> : t(`settings.sections.${s.key}.sub`)}</span>
                </span>
                {!isWide && <span class="row-end"><ChevronRight size={18} class="faint" aria-hidden="true" /></span>}
              </a>
            );
          })}
        </div>
      </nav>
    </Panel>
  );

  if (!isWide && !current) {
    return <Page title={t('settings.title')} help={t('settings.help')} data-testid="settings-screen">{nav}</Page>;
  }
  const View = current!.view;
  const body = current!.form && !settingsHere() ? <SectionWait testid={`settings-${current!.key}`} /> : <View key={current!.key} />;
  if (!isWide) {
    return (
      <Page title={t(`settings.sections.${current!.key}.title`)} sub={t(`settings.sections.${current!.key}.sub`)} back="/settings" data-testid="settings-screen">
        {body}
      </Page>
    );
  }
  return (
    <Page title={t('settings.title')} help={t('settings.help')} wide data-testid="settings-screen">
      <div class="settings-layout">
        <aside class="settings-aside">{nav}</aside>
        <div class="settings-main">
          <h2 class="settings-main-title">{t(`settings.sections.${current!.key}.title`)}</h2>
          {body}
        </div>
      </div>
    </Page>
  );
}

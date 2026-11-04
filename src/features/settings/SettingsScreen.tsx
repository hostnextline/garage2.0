/* Réglages (#/settings/:section?). Computer: the list of parts on the left, the part on the right.
   Phone: the list, then the part with « Retour ». A part with changes not saved keeps them (and shows a dot) until
   they are saved or undone. Apparence and Branchements are the owner's. */
import type { ComponentType } from 'preact';
import { type LucideIcon, Building2, Receipt, Wrench, CalendarClock, MessageSquareText, FileSignature, Palette, PlugZap, Tags, ChevronRight, RefreshCw } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { navigate } from '../../app/router';
import { wide } from '../../app/media';
import { t } from '../../lib/i18n';
import { isOwner } from '../../data/auth';
import { Page, Panel } from '../../ui';
import { hasDraft } from './SectionFrame';
import { CompanySection } from './CompanySection';
import { BillingSection } from './BillingSection';
import { ServicesSection } from './ServicesSection';
import { BookingSection } from './BookingSection';
import { TextsSection } from './TextsSection';
import { WaiverSection } from './WaiverSection';
import { LookSection } from './LookSection';
import { ConnectSection } from './ConnectSection';
import { ExpensesSection } from './ExpensesSection';
import { UpdatePanel } from '../../app/UpdatePanel';
import './settings.css';

export type SectionKey = 'company' | 'billing' | 'services' | 'booking' | 'texts' | 'waiver' | 'look' | 'connect' | 'expenses' | 'app';
interface SectionDef { key: SectionKey; icon: LucideIcon; view: ComponentType; owner?: boolean; tour?: string }
const SECTIONS: SectionDef[] = [
  { key: 'company', icon: Building2, view: CompanySection, tour: 'settings-company' },
  { key: 'billing', icon: Receipt, view: BillingSection },
  { key: 'services', icon: Wrench, view: ServicesSection, tour: 'settings-services' },
  { key: 'booking', icon: CalendarClock, view: BookingSection },
  { key: 'texts', icon: MessageSquareText, view: TextsSection, tour: 'settings-texts' },
  { key: 'waiver', icon: FileSignature, view: WaiverSection },
  { key: 'look', icon: Palette, view: LookSection, owner: true, tour: 'settings-look' },
  { key: 'connect', icon: PlugZap, view: ConnectSection, owner: true, tour: 'settings-connect' },
  { key: 'expenses', icon: Tags, view: ExpensesSection },
  { key: 'app', icon: RefreshCw, view: AppSection }
];

/** Mise à jour de l'app: the version on this device and « Vérifier les mises à jour » */
function AppSection() {
  return <div class="settings-section stack-lg" data-testid="settings-app"><UpdatePanel titled={false} /></div>;
}

export default function SettingsScreen({ params }: ScreenProps) {
  const list = SECTIONS.filter((s) => !s.owner || isOwner());
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
            const dirty = hasDraft(s.key);
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
  if (!isWide) {
    return (
      <Page title={t(`settings.sections.${current!.key}.title`)} sub={t(`settings.sections.${current!.key}.sub`)} back="/settings" data-testid="settings-screen">
        <View key={current!.key} />
      </Page>
    );
  }
  return (
    <Page title={t('settings.title')} help={t('settings.help')} wide data-testid="settings-screen">
      <div class="settings-layout">
        <aside class="settings-aside">{nav}</aside>
        <div class="settings-main">
          <h2 class="settings-main-title">{t(`settings.sections.${current!.key}.title`)}</h2>
          <View key={current!.key} />
        </div>
      </div>
    </Page>
  );
}

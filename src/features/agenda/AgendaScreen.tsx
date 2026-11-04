/* STUB — to be replaced by the screen itself (see docs/ARCHITECTURE.md). */
import type { ScreenProps } from '../../app/routes';
import { t } from '../../lib/i18n';
import { Page, Empty } from '../../ui';

export default function AgendaScreen(_p: ScreenProps) {
  return <Page title={t('agenda.title')}><Empty title="…" /></Page>;
}

/* STUB — to be replaced by the screen itself (see docs/ARCHITECTURE.md). */
import type { ScreenProps } from '../../app/routes';
import { t } from '../../lib/i18n';
import { Page, Empty } from '../../ui';

export default function QuotesScreen(_p: ScreenProps) {
  return <Page title={t('quotes.title')}><Empty title="…" /></Page>;
}

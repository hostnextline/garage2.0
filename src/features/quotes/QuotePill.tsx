/* The state of an estimate in one pill: Ouverte, Envoyée, Acceptée, Refusée, Réservée. */
import { t } from '../../lib/i18n';
import { Pill, type Tone } from '../../ui';
import type { QuoteStatus } from '../../domain/money/quote';

const TONE: Record<QuoteStatus, Tone> = { open: 'draft', sent: 'booked', accepted: 'done', declined: 'cancelled', converted: 'on_site' };

export function QuotePill(p: { status: QuoteStatus }) {
  return <Pill tone={TONE[p.status] || 'muted'} data-testid="quote-status">{t(`quotes.status.${p.status}`)}</Pill>;
}

/* A small help center: questions and answers by topic, in simple words. */
import { DICTS, t, lang } from '../../lib/i18n';
import { clockRange } from '../../lib/dates';
import { blocks } from '../../data/select';
import { Panel, Tabs } from '../../ui';

export type Topic = 'book' | 'blocks' | 'offline' | 'texts' | 'payments' | 'rights';
export const TOPICS: Topic[] = ['book', 'blocks', 'offline', 'texts', 'payments', 'rights'];
export function isTopic(x: unknown): x is Topic { return TOPICS.includes(x as Topic); }

export function HelpCenter(p: { topic: Topic; onTopic: (t: Topic) => void; onOpen?: (topic: Topic, id: string) => void }) {
  const ids = Object.keys(DICTS.fr.guide.faq.qa[p.topic]);
  // the time slots in the answers are the garage's real ones
  const b = Object.fromEntries(blocks.value.map((x) => [x.key, clockRange(x.start, x.end, lang.value)]));
  const vars = { am: b.am || '', pm: b.pm || '', eve: b.eve || '' };
  return (
    <Panel title={t('guide.faq.title')} sub={t('guide.faq.lead')} id="guide-faq" data-testid="guide-faq">
      <Tabs value={p.topic} onValue={p.onTopic} label={t('guide.faq.title')} tabs={TOPICS.map((x) => ({ value: x, label: t(`guide.faq.topics.${x}`) }))} />
      <div class="guide-faq" role="tabpanel" key={p.topic}>
        {ids.map((id) => (
          <details key={id} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) p.onOpen?.(p.topic, id); }} data-testid={`faq-${p.topic}-${id}`}>
            <summary>{t(`guide.faq.qa.${p.topic}.${id}.q`)}</summary>
            <p>{t(`guide.faq.qa.${p.topic}.${id}.a`, vars)}</p>
          </details>
        ))}
      </div>
    </Panel>
  );
}

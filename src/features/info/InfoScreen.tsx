/* « Info » (#/info, #/info/<fiche>): every procedure of the app, in simple words, with an example. A search (accents
   and capitals do not count) and the topics; each sheet: for whom, the short answer, the steps, an example, tips,
   the screen to open, the other sheets of the same topic. The articles are in articles.ts. */
import { useEffect, useState } from 'preact/hooks';
import { Lightbulb, Info as InfoIcon, ArrowRight } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { navigate } from '../../app/router';
import { t, lang } from '../../lib/i18n';
import { Page, Panel, Rows, RowItem, SearchInput, Chips, Button, Empty } from '../../ui';
import { ARTICLES, INFO_TOPICS, type InfoArticle, type InfoTopic } from './articles';
import { searchInfo } from './search';
import './info.css';

const L = () => (lang.value === 'en' ? 'en' : 'fr') as 'fr' | 'en';
// the search and the topic stay while one opens a sheet and comes back
let kept: { q: string; topic: InfoTopic | null } = { q: '', topic: null };

export default function InfoScreen({ params }: ScreenProps) {
  const a = params.id ? ARTICLES.find((x) => x.id === params.id) : undefined;
  if (params.id) return a ? <Sheet a={a} /> : <Page title={t('info.title')} back="/info"><Empty title={t('info.notFound')} /></Page>;
  return <List />;
}

function List() {
  const l = L();
  const [q, setQ] = useState(kept.q);
  const [topic, setTopic] = useState<InfoTopic | null>(kept.topic);
  useEffect(() => { kept = { q, topic }; }, [q, topic]);
  const list = searchInfo(ARTICLES, q, l, topic);
  return (
    <Page title={t('info.title')} sub={t('info.sub')} help={t('info.help')} data-testid="info-screen">
      <SearchInput value={q} onValue={setQ} placeholder={t('info.search')} data-testid="info-search" />
      <Chips label={t('info.title')} value={[topic ?? 'all']} data-testid="info-topics"
        options={[{ value: 'all', label: t('info.all') }, ...INFO_TOPICS.map((x) => ({ value: x, label: t(`info.topics.${x}`) }))]}
        onValue={(v) => setTopic(!v[0] || v[0] === 'all' ? null : v[0] as InfoTopic)} />
      <p class="small muted" style={{ margin: 0 }} aria-live="polite">{list.length === 1 ? t('info.countOne') : t('info.count', { n: list.length })}</p>
      {!list.length ? <Panel><Empty title={t('info.none')} text={t('info.noneText')} /></Panel> : (
        <Panel flush>
          <Rows data-testid="info-list">
            {list.map((x) => (
              <RowItem key={x.id} href={`#/info/${x.id}`} chevron data-testid={`info-${x.id}`}
                start={<span class="info-topic-dot" data-topic={x.topic} aria-hidden="true"><InfoIcon size={18} /></span>}
                title={x[l].title} sub={x[l].short} />
            ))}
          </Rows>
        </Panel>
      )}
    </Page>
  );
}

function Sheet({ a }: { a: InfoArticle }) {
  const l = L();
  const x = a[l];
  const who = a.roles.map((r) => t(`info.roles.${r}`)).join(', ');
  const related = ARTICLES.filter((o) => o.topic === a.topic && o.id !== a.id);
  useEffect(() => { window.scrollTo?.(0, 0); }, [a.id]);
  return (
    <Page title={x.title} sub={`${t(`info.topics.${a.topic}`)} · ${t('info.forWho', { who })}`} back="/info" data-testid="info-sheet">
      <p class="info-short">{x.short}</p>
      <Panel title={t('info.steps')}>
        <ol class="info-steps">{x.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      </Panel>
      <section class="info-example" aria-label={t('info.example')} data-testid="info-example">
        <span class="info-example-head"><Lightbulb aria-hidden="true" />{t('info.example')}</span>
        <p>{x.example}</p>
      </section>
      {!!x.tips?.length && (
        <Panel title={t('info.tips')}>
          <ul class="info-tips">{x.tips.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Panel>
      )}
      {a.link && <div><Button variant="primary" icon={<ArrowRight />} onClick={() => navigate(a.link!.slice(1))} data-testid="info-open">{t('info.open')}</Button></div>}
      {!!related.length && (
        <Panel title={t('info.related')} flush>
          <Rows>{related.map((o) => <RowItem key={o.id} href={`#/info/${o.id}`} chevron title={o[l].title} />)}</Rows>
        </Panel>
      )}
    </Page>
  );
}

/* Choose the day and block (the switch « Plages d'arrivée » off): the map of the days, the best suggestions near the
   address (they need the network), then a two-week calendar coloured by the room left (works with the copy on the
   phone). Shared: booking, moving a job (through BlockPicker). */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Check, ListOrdered, RefreshCw, Sparkles } from 'lucide-preact';
import { addDays, daysBetween, duration, type BlockKey } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';
import { blocks, blockLoad, settings, job as jobRow, activeTrucks } from '../../data/select';
import { net } from '../../data/sync';
import { Banner, Button, Pill } from '../../ui';
import { openMenu, openMenuAt, pressProps } from '../../ui/ContextMenu';
import { isFar, farLimits, farInfo, momentsByKey, offered, betterText, roadWords } from '../../domain/moment/logic';
import type { BlockPickerProps } from '../../domain/moment/choice';
import { blockPhraseWithHours, spanEnds } from '../../domain/moment/words';
import { RoutePreview, RouteHover, type PreviewAsk } from './RoutePreview';
import { MomentMap } from './MomentMap';
import { stopRank } from './preview';
import { dayOf } from './deviceDay';
import { useSuggestions, useLaterScores, useClock, useHover, useFinePointer, hasAnswer, answers } from './hooks';
import { askedKind, bothKinds, kindOf } from './vehicles';
import { anyFar, betterThan } from './moments';
import { blockCell, keyOf } from './blockCells';
import { BlockCalendar, type CalRow } from './BlockCalendar';
import { ChosenBar, FarBanner, KindSwitch, KindTag, SuggNotes, momentActions, staleClick } from './parts';
import './booking.css';

const PAGE = 14;

export function BlocksPicker(p: BlockPickerProps) {
  const l = lang.value;
  const { today } = useClock();
  const horizon = Math.max(PAGE, Number(settings.value.booking.horizon_days) || 120);
  const lastDay = addDays(today, horizon);
  const bl = blocks.value;
  const drive = Number(settings.value.booking.unknown_min) || 20;
  const dur = Math.max(15, Math.round(p.duration || 60));
  const trucks = activeTrucks.value;
  const kinds = bothKinds(trucks);
  const online = net.value.online;
  const hasPos = p.lat != null && p.lng != null;

  /* ---------- suggestions (server): the next two weeks ---------- */
  const [retry, setRetry] = useState(0);
  const again = retry + (p.reload || 0);
  const base = { lat: p.lat, lng: p.lng, duration: dur, exclude: p.excludeJob ?? null, need: !!p.need, kind: askedKind(p, trucks), truckId: p.truckId };
  const q = { ...base, from: today, days: PAGE };
  const sugg = useSuggestions(q, online, again);
  const usable = hasAnswer(sugg);
  // the list answers the question of now (not the last one, kept dimmed while a new answer is awaited)
  const fresh = answers(sugg, q);
  // every moment of the page is kept (the calendar marks the far ones); only the good ones are offered
  const shown = useMemo(() => offered(sugg.list, 6), [sugg.list]);
  const stale = sugg.status === 'loading';

  /* ---------- the calendar (device copy) ---------- */
  const [page, setPage] = useState(0);
  const pageOf = (day: string) => Math.max(0, Math.floor(daysBetween(today, day) / PAGE));
  // a block chosen from outside (address bar, a suggestion far away): show its page
  useEffect(() => { if (p.value && daysBetween(today, p.value.day) >= 0) setPage(pageOf(p.value.day)); }, [p.value?.day]);
  const start = addDays(today, page * PAGE);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < PAGE; i++) { const d = addDays(start, i); if (d > lastDay) break; out.push(d); }
    return out;
  }, [start, lastDay]);
  const ask = { ...p, kinds, exclude: p.excludeJob };
  const cellOf = (day: string, block: BlockKey) => blockCell(blockLoad(day, block), dur, drive, ask);
  const rows: CalRow[] = days.map((day) => ({ day, blocks: bl.map((b) => ({ key: b.key, start: b.start, end: b.end, ...cellOf(day, b.key) })) }));
  const isPicked = (day: string, block: string) => !!p.value && p.value.day === day && p.value.block === block;
  // moving a job: where it is now
  const moving = p.excludeJob ? jobRow(p.excludeJob) : undefined;
  const isCurrent = (day: string, block: string) => !!moving && moving.day === day && moving.block === block;
  const pickedCell = p.value ? cellOf(p.value.day, p.value.block) : null;

  /* ---------- « garde-route »: the server's scores, for the first two weeks and for any later page shown ---------- */
  const later = useLaterScores(base, page > 0 ? start : null, PAGE, online, again);
  const scored = useMemo(() => (usable ? [...sugg.list, ...later] : later), [sugg.list, later, usable]);
  const moments = useMemo(() => momentsByKey(scored), [scored]);
  /* the warning and the question before booking only from the answer to the question of now: while a new one is awaited
     (another address, another duration) the old scores may speak of another place, so nothing is said until it lands */
  const freshMoments = useMemo(() => (fresh ? moments : momentsByKey(later)), [fresh, moments, later]);
  const pickedMoment = p.value ? freshMoments.get(keyOf(p.value.day, p.value.block)) : undefined;
  const far = farInfo(pickedMoment, farLimits(settings.value.booking), l);
  const better = far && pickedMoment ? betterThan(pickedMoment, sugg.list, moving, (m) => ({ day: m.day, block: m.block })) : [];
  useEffect(() => { p.onFar?.(far); }, [far?.day, far?.block, far?.text]);

  /* ---------- choosing; the selection is said out loud ---------- */
  const [said, setSaid] = useState('');
  const blockOf = (k: BlockKey) => bl.find((b) => b.key === k) || bl[0];
  const phrase = (day: string, k: BlockKey) => { const b = blockOf(k); return blockPhraseWithHours(day, k, b.start, b.end, today, l); };
  const pick = (day: string, block: BlockKey) => {
    p.onPick({ day, block });
    setSaid(t('booking.picker.chosen', { when: phrase(day, block) }));
  };

  /* ---------- « Voir sur la carte »: a right-click or a long press on a moment, or the button under the moment chosen ---------- */
  const [preview, setPreview] = useState<PreviewAsk | null>(null);
  const truckOf = (day: string, block: BlockKey) => p.truckId || sugg.list.find((s) => s.day === day && s.block === block)?.truck || null;
  const askOf = (day: string, block: BlockKey): PreviewAsk => ({ day, block, truckId: truckOf(day, block), lat: p.lat!, lng: p.lng!, name: '', address: p.address || '',
    when: phrase(day, block), exclude: p.excludeJob ?? null });
  const see = (day: string, block: BlockKey) => setPreview(askOf(day, block));
  /* on a computer, the mouse over a moment opens a small map of that day beside it (no scrolling to the big map) */
  const canHover = useFinePointer();
  const hov = useHover<{ day: string; block: BlockKey }>(250, canHover && hasPos);
  const hoverProps = (day: string, block: BlockKey) => hov.props(keyOf(day, block), { day, block });
  const hoverMoment = hov.hover ? moments.get(hov.hover.key) : undefined;
  const menuProps = (day: string, block: BlockKey) => {
    const actions = () => momentActions(() => pick(day, block), hasPos ? () => see(day, block) : null);
    return { onContextMenu: (e: MouseEvent) => openMenu(e, actions(), phrase(day, block)), ...pressProps((x, y) => { openMenuAt(x, y, actions(), phrase(day, block)); }) };
  };

  /* which stop of its route the appointment would be at each moment offered (the phone's copy of the day, the same
     estimate as « Voir sur la carte ») */
  const ranks = useMemo(() => shown.map((s) => (hasPos
    ? stopRank(dayOf(s.day, p.excludeJob), { day: s.day, block: s.block, truckId: s.truck, lat: p.lat!, lng: p.lng!, name: '', address: '' }) : null)),
  [shown, p.lat, p.lng, p.excludeJob]);

  return (
    <div class="bp" data-testid="block-picker">
      <p class="sr-only" aria-live="polite">{said}</p>
      <ChosenBar on={!!p.value} text={p.value ? t('booking.picker.chosen', { when: phrase(p.value.day, p.value.block) }) : t('booking.picker.nothing')}
        sub={t('booking.picker.duration', { d: duration(dur, l) })} onSee={p.value && hasPos ? () => see(p.value!.day, p.value!.block) : null} />
      {hov.hover && !preview && <RouteHover ask={askOf(hov.hover.item.day, hov.hover.item.block)} at={hov.hover.at} road={hoverMoment ? roadWords(hoverMoment, l) : undefined} far={isFar(hoverMoment)} />}
      {preview && <RoutePreview ask={preview} onClose={() => setPreview(null)} onPick={() => pick(preview.day, preview.block as BlockKey)} />}
      {p.value && pickedCell?.state === 'full' && <Banner kind="warn">{t('booking.picker.fullWarn')}</Banner>}
      {p.value && pickedCell?.state === 'tight' && <Banner kind="info">{t('booking.picker.tightWarn')}</Banner>}
      {far && <FarBanner text={far.text} better={better.map((b) => ({ key: keyOf(b.moment.day, b.moment.block), text: betterText(b, today, l), onPick: () => pick(b.moment.day, b.moment.block) }))} />}

      {/* the map first: the days, the appointments around, the day's routes with the new stop (needs a position) */}
      {hasPos && (
        <MomentMap lat={p.lat!} lng={p.lng!} address={p.address || ''} cells={rows} list={scored}
          value={p.value} onPick={pick} excludeJob={p.excludeJob} truckId={p.truckId} pop={canHover} hoverProps={hoverProps} />
      )}

      {/* suggestions */}
      <section class="bp-sugg" aria-labelledby="bp-sugg-title">
        <div class="bp-head">
          <h3 id="bp-sugg-title" class="bp-title"><Sparkles size={18} aria-hidden="true" />{t('booking.picker.title')}</h3>
          {!usable && online && <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => setRetry((n) => n + 1)}>{t('booking.picker.retry')}</Button>}
        </div>
        {kinds && p.onKind && <KindSwitch need={p.need} kind={p.kind} onKind={p.onKind} />}
        <SuggNotes status={sugg.status} empty={!shown.length} hasPos={hasPos} skeleton={{ h: 52, lines: 3 }}
          words={{ loading: t('booking.picker.loading'), offline: t('booking.picker.offline'), error: t('booking.picker.error'), none: t('booking.picker.none', { d: duration(dur, l) }) }} />
        {shown.length > 0 && usable && (
          <div class={`bp-sugg-list${stale ? ' is-stale' : ''}`} role="group" aria-label={t('booking.picker.title')}>
            {shown.map((s, i) => {
              const on = isPicked(s.day, s.block);
              const bits = [hasPos ? roadWords(s, l) : '', t('booking.picker.near', { n: s.near }), s.left != null && s.left > 0 ? t('booking.picker.free', { d: duration(s.left, l) }) : ''].filter(Boolean);
              if (bits[0]) bits[0] = bits[0].charAt(0).toUpperCase() + bits[0].slice(1);
              const rank = ranks[i];
              return (
                <button key={keyOf(s.day, s.block)} type="button" class={`bp-sugg-row${on ? ' is-on' : ''}`} aria-pressed={on} aria-disabled={stale || undefined}
                  onClick={staleClick(stale, () => pick(s.day, s.block))} {...menuProps(s.day, s.block)} {...hoverProps(s.day, s.block)} data-testid="bp-sugg">
                  <span class="bp-sugg-main">
                    {isCurrent(s.day, s.block) ? <span class="bp-best"><Pill tone="muted" dot={false}>{t('booking.picker.current')}</Pill></span>
                      : i === 0 && <span class="bp-best"><Pill tone="ok" dot={false}>{t('booking.picker.best')}</Pill></span>}
                    <span class="bp-sugg-title">{phrase(s.day, s.block)}</span>
                    {kinds && s.truck && <KindTag kind={kindOf(trucks, s.truck)} size={16} testid="bp-sugg-kind" />}
                    {rank && <span class="bp-order-tag" data-testid="bp-sugg-order"><ListOrdered size={16} aria-hidden="true" />{rank.total === 1 ? t('booking.picker.orderOnly') : t('booking.picker.order', { n: rank.n, total: rank.total })}</span>}
                    <span class="bp-sugg-sub">{bits.join(', ')}</span>
                  </span>
                  <span class="bp-tick" aria-hidden="true">{on && <Check size={22} />}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <BlockCalendar rows={rows} blocks={bl} today={today} range={days.length ? t('booking.picker.range', spanEnds(days[0], days[days.length - 1], l, today)) : ''}
        isPicked={isPicked} isCurrent={isCurrent} isFar={(day, block) => isFar(moments.get(keyOf(day, block)))} anyFar={anyFar(moments.values())}
        onPick={pick} cellProps={(day, block) => ({ ...menuProps(day, block), ...hoverProps(day, block) })}
        canEarlier={page > 0} canLater={addDays(start, PAGE) <= lastDay} onEarlier={() => setPage(page - 1)} onLater={() => setPage(page + 1)} />
    </div>
  );
}

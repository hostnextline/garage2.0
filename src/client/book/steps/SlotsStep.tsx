/* « Réserver en ligne », step 3: the best moments where a truck already goes nearby, soonest first; « Voir d'autres
   dates » for the next two weeks. « Plages d’arrivée »: each day with its 4-hour window, « Voir d’autres heures » when a
   day has several, and « Je suis disponible toute la journée ». A failed request says so with « Réessayer », never
   « no moment free ». */
import { useEffect, useRef, useState } from 'preact/hooks';
import { RefreshCw, Sparkles, Users } from 'lucide-preact';
import { Button } from '../../../ui/Button';
import { longDay } from '../../../lib/dates';
import { attemptCall, callBook, type ClientError, type Garage } from '../../api';
import { dayTitle, montrealToday, relDay, slotText } from '../../format';
import { ct, type CLang } from '../../i18n';
import { CallUs, Note } from '../../ui';
import {
  PAGE_DAYS, afterPage, dayOffers, errorKey, flexSlot, mergeSlots, slotKey, stepOfError, whenWords, windowMode,
  type Place, type WebInfo, type WebSlot
} from '../book-state';
import type { TitleRef } from './ServicesStep';

/** empty fortnights skipped by one tap of « Voir d'autres dates » (the server allows 20 asks in 10 minutes) */
const MAX_SKIPS = 3;

export function SlotsStep(p: { l: CLang; info: WebInfo; ids: string[]; place: Place; value: WebSlot | null; onPick: (s: WebSlot) => void; titleRef: TitleRef; msg: string | null;
  garage: Garage | null; onRefused: (e: ClientError) => void }) {
  const { l, info } = p;
  const [slots, setSlots] = useState<WebSlot[] | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [end, setEnd] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flex, setFlex] = useState(p.value?.flex === true);
  const [open, setOpen] = useState<string | null>(null);
  // « Voir d’autres dates » found nothing in the weeks it looked at (and the horizon is still ahead): said, so the tap is
  // not met with silence (client-r7)
  const [nothingNew, setNothingNew] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  /** asks the moments from `f` (null: from today), skipping later fortnights with nothing free */
  const ask = async (f: string | null) => {
    setBusy(true); setErr(null); setNothingNew(false);
    const today = montrealToday();
    let at = f;
    for (let skipped = 0; ; skipped++) {
      const r = await attemptCall(() => callBook<{ slots: WebSlot[] }>('slots', { lat: p.place.lat, lng: p.place.lng, services: p.ids, from: at, days: PAGE_DAYS }));
      if (!alive.current) return;
      if (!r.ok) {
        // a refusal that belongs to another step (address too far, no service) goes back there; anything else is said
        // here with « Réessayer »
        const to = stepOfError(r.error.code);
        if (to && to !== 'slots') p.onRefused(r.error); else setErr(ct(l, errorKey(r.error.code)));
        setBusy(false);
        return;
      }
      const got = r.value.slots || [];
      const page = afterPage(at, got.length, today, info.horizon_days, skipped, MAX_SKIPS);
      if (page.again) { at = page.next; continue; }
      setSlots((cur) => (f && cur ? mergeSlots(cur, got) : got));
      setFrom(page.next);
      setNothingNew(!!f && got.length === 0 && !page.end);
      if (page.end) setEnd(true);
      setBusy(false);
      return;
    }
  };
  useEffect(() => { void ask(null); }, []);

  const blockOf = (k: string) => info.blocks.find((b) => b.key === k);
  const windows = windowMode(info, slots);
  const offers = windows && slots ? dayOffers(slots) : [];
  const dayName = (day: string) => { const rel = relDay(day); return rel ? `${ct(l, rel)}, ${longDay(day, l)}` : dayTitle(day, l); };
  const failed = err && <Note kind="bad">{err}</Note>;
  return (
    <section class="cl-panel glass" aria-labelledby="bk-t3" data-testid="book-slots">
      <h1 id="bk-t3" class="bk-title" ref={p.titleRef} tabIndex={-1}>{ct(l, 'book.slots.title')}</h1>
      <p class="cl-sub">{ct(l, windows ? 'book.slots.subWindows' : 'book.slots.sub')}</p>
      {p.msg && <Note kind="warn">{p.msg}</Note>}
      {slots === null ? (
        err ? (
          <div class="cl-stack">
            {failed}
            <Button block busy={busy} icon={<RefreshCw />} onClick={() => ask(null)} data-testid="book-retry">{ct(l, 'errors.retry')}</Button>
          </div>
        ) : <p class="cl-muted" role="status">{ct(l, 'book.slots.loading')}</p>
      ) : (
        <>
          {slots.length === 0 && !busy && <div class="cl-stack"><Note kind="info">{ct(l, from && !end ? 'book.slots.none' : 'book.slots.noneMore')}</Note></div>}
          {windows && offers.length > 0 && (
            <label class={`bk-flex${flex ? ' is-on' : ''}`}>
              <input type="checkbox" checked={flex} onChange={(e) => { setFlex((e.currentTarget as HTMLInputElement).checked); setOpen(null); }} data-testid="book-flex" />
              <span><b>{ct(l, 'book.slots.flex')}</b><span class="cl-small cl-muted" data-testid="book-flex-note">{ct(l, 'book.slots.flexNote')}</span></span>
            </label>
          )}
          {windows && (
            <ul class="bk-slots" data-testid="book-days">
              {offers.map((d, i) => (
                <li key={d.day} data-testid="book-day">
                  <button type="button" class={`bk-slot${i === 0 ? ' is-best' : ''}`} onClick={() => p.onPick(flex ? flexSlot(d.best) : d.best)} data-testid="book-slot">
                    <span class="bk-slot-main">
                      {i === 0 && <span class="bk-best"><Sparkles aria-hidden="true" />{ct(l, 'book.slots.best')}</span>}
                      <b>{dayName(d.day)}</b>
                      <span data-testid="book-slot-when">{whenWords(flex ? flexSlot(d.best) : d.best, info.blocks, l)}</span>
                      {d.near && <span class="bk-near"><Users aria-hidden="true" />{ct(l, 'book.slots.near')}</span>}
                    </span>
                    <span class="bk-slot-go" aria-hidden="true">›</span>
                  </button>
                  {!flex && d.others.length > 0 && (
                    <div class="bk-hours">
                      <Button variant="ghost" size="sm" aria-expanded={open === d.day} onClick={() => setOpen(open === d.day ? null : d.day)} data-testid="book-other-hours">
                        {ct(l, open === d.day ? 'book.slots.fewerHours' : 'book.slots.otherHours')}
                      </Button>
                      {open === d.day && (
                        <ul class="bk-hours-list">
                          {d.others.map((s) => (
                            <li key={slotKey(s)}>
                              <button type="button" class="bk-slot bk-slot-sm" onClick={() => p.onPick(s)} data-testid="book-slot-other">
                                <span class="bk-slot-main"><span>{whenWords(s, info.blocks, l)}</span></span>
                                <span class="bk-slot-go" aria-hidden="true">›</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!windows && <ul class="bk-slots">
            {slots.map((s, i) => {
              const b = blockOf(s.block);
              return (
                <li key={`${s.day}-${s.block}`}>
                  <button type="button" class={`bk-slot${i === 0 ? ' is-best' : ''}`} onClick={() => p.onPick(s)} data-testid="book-slot">
                    <span class="bk-slot-main">
                      {i === 0 && <span class="bk-best"><Sparkles aria-hidden="true" />{ct(l, 'book.slots.best')}</span>}
                      <b>{dayName(s.day)}</b>
                      <span>{ct(l, `blocks.${s.block}`)}</span>
                      {b && <span class="cl-small cl-muted">{slotText(b.start, b.end, l)}</span>}
                      {s.near && <span class="bk-near"><Users aria-hidden="true" />{ct(l, 'book.slots.near')}</span>}
                    </span>
                    <span class="bk-slot-go" aria-hidden="true">›</span>
                  </button>
                </li>
              );
            })}
          </ul>}
          {failed}
          {end && slots.length > 0 && <Note kind="info">{ct(l, 'book.slots.noneMore')}</Note>}
          {(end || (slots.length === 0 && !busy)) && <CallUs garage={p.garage} l={l} primary={false} />}
          {nothingNew && slots.length > 0 && <Note kind="info" data-testid="book-none-new">{ct(l, 'book.slots.none')}</Note>}
          {!end && from && <Button block busy={busy} onClick={() => ask(from)} data-testid="book-more">{ct(l, 'book.slots.more')}</Button>}
        </>
      )}
    </section>
  );
}

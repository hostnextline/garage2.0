/* « Réserver en ligne », step 1: the services (several may be chosen), with the running total. */
import { Check } from 'lucide-preact';
import { Button } from '../../../ui/Button';
import { duration, shortDate } from '../../../lib/dates';
import { cad } from '../../format';
import { ct, type CLang } from '../../i18n';
import { Note } from '../../ui';
import { chosenTotal, serviceName, toggle, type WebInfo } from '../book-state';

export type TitleRef = { current: HTMLHeadingElement | null };

export function ServicesStep(p: { l: CLang; info: WebInfo; ids: string[]; onIds: (x: string[]) => void; titleRef: TitleRef; msg: string | null; onNext: () => void }) {
  const { l, info } = p;
  const sum = chosenTotal(info.services, p.ids, info.taxes);
  return (
    <section class="cl-panel glass" aria-labelledby="bk-t1" data-testid="book-services">
      <h1 id="bk-t1" class="bk-title" ref={p.titleRef} tabIndex={-1}>{ct(l, 'book.services.title')}</h1>
      <p class="cl-sub">{ct(l, 'book.services.sub')}</p>
      <ul class="bk-svcs">
        {info.services.map((s) => {
          const on = p.ids.includes(s.id);
          const inc = (s.includes || []).map((x) => (l === 'en' ? x.en || x.fr : x.fr || x.en)).filter(Boolean);
          return (
            <li key={s.id}>
              <button type="button" class={`bk-svc${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => p.onIds(toggle(p.ids, s.id))} data-testid="book-svc">
                <span class="bk-tick" aria-hidden="true">{on && <Check />}</span>
                <span class="bk-svc-main">
                  <span class="bk-svc-name">{s.promo && <span class="bk-promo">{ct(l, 'book.services.promo')}</span>}{serviceName(s, l)}</span>
                  {inc.length > 0 && <span class="bk-svc-inc">{inc.join(', ')}</span>}
                  <span class="bk-svc-meta">{ct(l, 'book.services.about', { time: duration(s.duration_min, l) })}</span>
                  {s.promo && s.promo_until && <span class="bk-svc-meta">{ct(l, 'book.services.until', { date: shortDate(s.promo_until, l) })}</span>}
                </span>
                <span class="bk-svc-price">{s.price_cents == null ? <span class="cl-muted cl-small">{ct(l, 'book.services.toConfirm')}</span> : cad(s.price_cents, l)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {p.ids.length > 0 && (
        <div class="cl-total" data-testid="book-total">
          <div>
            <div class="cl-total-label">{ct(l, 'book.services.chosen', { n: p.ids.length })}</div>
            {sum.any && <div class="cl-small cl-muted">{ct(l, 'book.services.total')}{info.taxes ? `, ${ct(l, 'book.services.totalTaxes')}` : ''}{sum.hourly ? `, ${ct(l, 'book.services.plusHourly')}` : ''}</div>}
          </div>
          {sum.any && <div class="cl-total-amt">{cad(sum.total, l)}</div>}
        </div>
      )}
      {p.msg && <Note kind="warn">{p.msg}</Note>}
      <Button variant="primary" block class="bk-next" onClick={p.onNext} data-testid="book-next">{ct(l, 'book.next')}</Button>
    </section>
  );
}

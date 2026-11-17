/* The lines editor of an invoice or an estimate: description, quantity, price, taxable, a discount (with 5/10/15/20 %
   chips), remove with « Annuler ». The lines' amounts come from the one totals rule (domain/money/invoice.ts).
   A price typed wrong (« 12,,5 ») leaves the field red and the line at its last good price: it is never saved as 0 $
   (an empty field is 0 $, as before) (R126). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Plus, Trash2, Tag, ListPlus } from 'lucide-preact';
import type { Lang } from '../../data/types';
import { t, tl, lang as uiLang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { Field, Input, MoneyInput, Check, IconButton, Button, toast } from '../../ui';
import { lineCents } from '../../domain/money/invoice';
import { syncPercents, percentOf, discountBase, putBack } from '../../domain/money/draft';
import { newLine, type EditLine } from '../../domain/money/editLines';

/** the words the « % » chips write, in both languages: a discount that says them stays that percent of the lines
    (read when used: a dictionary may arrive after this file) */
export const percentWords = () => (['fr', 'en'] as Lang[]).map((l) => tl(l, 'invoices.lines.discountPct'));
const CHIPS = [5, 10, 15, 20];

/** a quantity: « 1 », « 1,5 » (hours of labour) */
function QtyInput(p: { value: number; onValue: (v: number) => void; label: string; id?: string }) {
  const fmt = (v: number) => (uiLang.value === 'en' ? String(v) : String(v).replace('.', ','));
  const [text, setText] = useState(fmt(p.value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(fmt(p.value)); }, [p.value, focused]);
  const parse = (s: string) => { const n = Number(s.replace(',', '.').trim()); return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : null; };
  return (
    <input class="input inv-qty num" inputMode="decimal" id={p.id} aria-label={p.label} value={text} aria-invalid={parse(text) == null || undefined}
      onFocus={(e) => { setFocused(true); (e.currentTarget as HTMLInputElement).select(); }}
      onInput={(e) => { const s = (e.currentTarget as HTMLInputElement).value; setText(s); const n = parse(s); if (n != null) p.onValue(n); }}
      onBlur={() => { setFocused(false); const n = parse(text); setText(fmt(n ?? p.value)); }} />
  );
}

export interface LinesEditorProps {
  lines: EditLine[];
  onLines: (lines: EditLine[]) => void;
  /** the document's language: words written for the customer (« Rabais ») */
  docLang: Lang;
  /** lines to point at (no description) */
  errorLines?: number[];
  onCatalog?: () => void;
  /** a line of the job's work taken off the invoice: the work leaves the job too (gives back how to undo it), or null */
  onRemoveWork?: (line: EditLine) => { undo: () => void } | null;
}
export function LinesEditor(p: LinesEditorProps) {
  // « Annuler » runs seconds later, from the toast: it must work on the lines as they are then, not as they were
  const latest = useRef(p);
  latest.current = p;
  const emit = (lines: EditLine[]) => latest.current.onLines(syncPercents(lines, percentWords()));
  const set = (i: number, patch: Partial<EditLine>) => emit(p.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => {
    const line = p.lines[i];
    if (!line) return;
    const work = line.item_id && p.onRemoveWork ? p.onRemoveWork(line) : null;
    emit(p.lines.filter((_, j) => j !== i));
    toast(t(work ? 'invoices.lines.removedWork' : 'invoices.lines.removed'), {
      action: { label: t('invoices.lines.undo'), run: () => { work?.undo(); emit(putBack(latest.current.lines, line, i)); } }
    });
  };
  const add = (l: EditLine) => {
    emit([...p.lines, l]);
    // the new line's description gets the focus (a tap less with gloves)
    setTimeout(() => document.getElementById(`ld-${l._k}`)?.focus(), 30);
  };
  // an amount typed on a « Rabais de 10 % » line: it is no longer 10 %, its words stop saying so
  const setDiscount = (i: number, cents: number) => {
    const l = p.lines[i];
    const words = percentOf(l?.description, percentWords()) != null ? { description: tl(p.docLang, 'invoices.lines.discountDefault') } : {};
    set(i, { unit_cents: Math.abs(cents), ...words });
  };
  const base = discountBase(p.lines);
  const err = new Set(p.errorLines || []);
  return (
    <div class="inv-editor">
      {p.lines.length > 0 && (
        <div class="inv-lines-head" aria-hidden="true">
          <span>{t('invoices.lines.description')}</span><span>{t('invoices.lines.qty')}</span><span>{t('invoices.lines.price')}</span>
          <span>{t('invoices.lines.taxable')}</span><span class="right">{t('invoices.lines.amount')}</span><span />
        </div>
      )}
      <div class="inv-lines" role="list" data-testid="lines-editor">
        {p.lines.map((l, i) => {
          const disc = l.kind === 'discount';
          return (
            <div key={l._k} class={`inv-line${disc ? ' is-discount' : ''}`} role="listitem" data-testid="line">
              <Field label={disc ? t('invoices.lines.discountLabel') : t('invoices.lines.description')} class="inv-line-desc" error={err.has(i) ? t('invoices.lines.needDescription') : null}>
                <Input id={`ld-${l._k}`} value={l.description} onValue={(v) => set(i, { description: v })} maxLength={300}
                  placeholder={disc ? tl(p.docLang, 'invoices.lines.discountDefault') : t('invoices.lines.descriptionPh')} invalid={err.has(i)} data-testid="line-desc" />
              </Field>
              <label class="field inv-line-qty"><span class="field-label">{t('invoices.lines.qty')}</span>
                <QtyInput value={l.qty} onValue={(v) => set(i, { qty: v })} label={t('invoices.lines.qty')} />
              </label>
              <label class="field inv-line-price"><span class="field-label">{disc ? t('invoices.lines.discountAmount') : t('invoices.lines.price')}</span>
                <MoneyInput cents={disc ? Math.abs(l.unit_cents) : l.unit_cents} allowNegative={!disc}
                  onCents={(c, info) => { if (info?.valid === false) return; if (disc) setDiscount(i, c ?? 0); else set(i, { unit_cents: c ?? 0 }); }}
                  aria-label={disc ? t('invoices.lines.discountAmount') : t('invoices.lines.price')} />
              </label>
              <div class="inv-line-tax"><Check checked={l.taxable} onChange={(v) => set(i, { taxable: v })} label={t('invoices.lines.taxable')} data-testid="line-taxable" /></div>
              <span class={`inv-line-total money${disc ? ' is-neg' : ''}`} data-testid="line-total">{money(lineCents(l), uiLang.value)}</span>
              <IconButton class="inv-line-x" icon={<Trash2 />} label={t('invoices.lines.remove')} onClick={() => remove(i)} data-testid="line-remove" />
              {disc && base > 0 && (
                <div class="inv-line-pct chips" role="group" aria-label={t('invoices.lines.percent')}>
                  {CHIPS.map((pc) => (
                    <button key={pc} type="button" class="chip" onClick={() => set(i, { unit_cents: Math.round((base * pc) / 100), qty: 1, description: tl(p.docLang, 'invoices.lines.discountPct', { n: pc }) })}>
                      {uiLang.value === 'en' ? `${pc}%` : `${pc} %`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div class="inv-add row-wrap">
        <Button icon={<Plus />} onClick={() => add(newLine())} data-testid="add-line">{t('invoices.lines.addLine')}</Button>
        <Button icon={<Tag />} onClick={() => add(newLine('discount', tl(p.docLang, 'invoices.lines.discountDefault')))} data-testid="add-discount">{t('invoices.lines.addDiscount')}</Button>
        {p.onCatalog && <Button icon={<ListPlus />} onClick={p.onCatalog} data-testid="add-catalog">{t('invoices.lines.addCatalog')}</Button>}
      </div>
    </div>
  );
}

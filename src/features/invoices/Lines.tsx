/* Lines of an invoice or an estimate: the editor (description, quantity, price, taxable, a discount, remove), the
   read-only list, and « Du catalogue » (the price list, through the booking section's ServicePicker). */
import { useEffect, useState } from 'preact/hooks';
import { Plus, Trash2, Tag, ListPlus } from 'lucide-preact';
import type { ItemKind, Lang } from '../../data/types';
import { t, tl, lang as uiLang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { Field, Input, MoneyInput, Check, IconButton, Button, Sheet, toast } from '../../ui';
import { ServicePicker, type ItemDraft } from '../booking/ServicePicker';
import { lineCents, type LineLike } from './logic';

export interface EditLine {
  _k: string; description: string; qty: number; unit_cents: number; taxable: boolean; kind?: ItemKind;
  item_id?: string; service_id?: string | null; duration_min?: number | null;
}
let seq = 0;
const key = () => `l${Date.now().toString(36)}${(++seq).toString(36)}`;
/** gives each line a key for the screen (removed before saving) */
export function withKeys<T extends LineLike>(lines: T[] | null | undefined): EditLine[] {
  return (lines || []).map((l) => ({ ...(l as unknown as EditLine), qty: Number(l.qty ?? 1), unit_cents: Number(l.unit_cents ?? 0), taxable: l.taxable !== false, description: String(l.description ?? ''), _k: key() }));
}
export function newLine(kind: ItemKind = 'service', description = ''): EditLine {
  return { _k: key(), description, qty: 1, unit_cents: 0, taxable: true, kind };
}
export function fromDrafts(items: ItemDraft[]): EditLine[] {
  return items.map((i) => ({
    _k: key(), description: i.description, qty: Number(i.qty || 1), unit_cents: Number(i.unit_cents || 0), taxable: i.taxable !== false,
    kind: i.kind || 'service', service_id: i.service_id ?? null, duration_min: i.duration_min ?? null
  }));
}

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
}
export function LinesEditor(p: LinesEditorProps) {
  const set = (i: number, patch: Partial<EditLine>) => p.onLines(p.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => {
    const before = p.lines;
    p.onLines(before.filter((_, j) => j !== i));
    toast(t('invoices.lines.removed'), { action: { label: t('invoices.lines.undo'), run: () => p.onLines(before) } });
  };
  const add = (l: EditLine) => {
    p.onLines([...p.lines, l]);
    // the new line's description gets the focus (a tap less with gloves)
    setTimeout(() => document.getElementById(`ld-${l._k}`)?.focus(), 30);
  };
  const base = p.lines.filter((l) => l.kind !== 'discount').reduce((n, l) => n + lineCents(l), 0);
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
                <Input id={`ld-${l._k}`} value={l.description} onValue={(v) => set(i, { description: v })} placeholder={disc ? tl(p.docLang, 'invoices.lines.discountDefault') : t('invoices.lines.descriptionPh')} invalid={err.has(i)} data-testid="line-desc" />
              </Field>
              <label class="field inv-line-qty"><span class="field-label">{t('invoices.lines.qty')}</span>
                <QtyInput value={l.qty} onValue={(v) => set(i, { qty: v })} label={t('invoices.lines.qty')} />
              </label>
              <label class="field inv-line-price"><span class="field-label">{disc ? t('invoices.lines.discountAmount') : t('invoices.lines.price')}</span>
                <MoneyInput cents={disc ? Math.abs(l.unit_cents) : l.unit_cents} allowNegative={!disc} onCents={(c) => set(i, { unit_cents: disc ? Math.abs(c ?? 0) : c ?? 0 })}
                  aria-label={disc ? t('invoices.lines.discountAmount') : t('invoices.lines.price')} />
              </label>
              <div class="inv-line-tax"><Check checked={l.taxable} onChange={(v) => set(i, { taxable: v })} label={t('invoices.lines.taxable')} data-testid="line-taxable" /></div>
              <span class={`inv-line-total money${disc ? ' is-neg' : ''}`} data-testid="line-total">{money(lineCents(l), uiLang.value)}</span>
              <IconButton class="inv-line-x" icon={<Trash2 />} label={t('invoices.lines.remove')} onClick={() => remove(i)} data-testid="line-remove" />
              {disc && base > 0 && (
                <div class="inv-line-pct chips" role="group" aria-label={t('invoices.lines.percent')}>
                  {[5, 10, 15, 20].map((pc) => (
                    <button key={pc} type="button" class="chip" onClick={() => set(i, { unit_cents: Math.round((base * pc) / 100), description: tl(p.docLang, 'invoices.lines.discountPct', { n: pc }) })}>
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

/** the lines, read-only (descriptions as written for the customer; amounts in the person's own language) */
export function LinesView(p: { lines: LineLike[]; docLang?: Lang | string }) {
  const l = uiLang.value;
  const qtyFmt = new Intl.NumberFormat(l === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 3 });
  if (!p.lines.length) return <p class="muted" style={{ margin: 0 }}>{t('invoices.lines.none')}</p>;
  return (
    <div class="inv-view" role="list" data-testid="lines-view">
      {p.lines.map((x, i) => {
        const disc = x.kind === 'discount';
        const qty = Number(x.qty ?? 1);
        const unit = disc ? -Math.abs(Number(x.unit_cents || 0)) : Number(x.unit_cents || 0);
        return (
          <div key={i} class="inv-view-line" role="listitem">
            <span class="grow">
              <span class="inv-view-desc">{x.description}</span>
              {(qty !== 1 || x.taxable === false) && (
                <span class="inv-view-sub">
                  {qty !== 1 && <span>{t('invoices.lines.qtyTimes', { q: qtyFmt.format(qty), p: money(unit, l) })}</span>}
                  {x.taxable === false && <span>{t('invoices.lines.notTaxable')}</span>}
                </span>
              )}
            </span>
            <span class={`money${disc ? ' is-neg' : ''}`}>{money(lineCents(x), l)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** « Du catalogue »: services of the price list, added as lines */
export function CatalogSheet(p: { open: boolean; onClose: () => void; docLang: Lang; onAdd: (lines: EditLine[]) => void }) {
  const [picked, setPicked] = useState<ItemDraft[]>([]);
  useEffect(() => { if (p.open) setPicked([]); }, [p.open]);
  return (
    <Sheet open={p.open} onClose={p.onClose} title={t('invoices.catalog.title')} sub={t('invoices.catalog.sub')} wide data-testid="catalog-sheet"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!picked.length} onClick={() => { p.onAdd(fromDrafts(picked)); p.onClose(); }} data-testid="catalog-add">
          {picked.length ? t('invoices.catalog.add', { n: picked.length }) : t('invoices.catalog.pick')}
        </Button>
      </>}>
      <ServicePicker value={picked} onValue={setPicked} lang={p.docLang} allowCustom={false} />
    </Sheet>
  );
}

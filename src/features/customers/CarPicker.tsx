/* « Année → Marque → Modèle »: three taps, no typing. The three boxes show what is chosen; a tap opens the sheet at that
   step. The years as big buttons, the makes (most common first, with a search), then the models of that make for that
   year. « Autre » lets the person type what is not in a list. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ChevronDown, ChevronRight, PenLine } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { fold } from '../../lib/text';
import { Sheet, Button, Input, SearchInput, Banner, Skeleton, Field } from '../../ui';
import { yearsList, POPULAR_MAKES, OTHER_MAKES, makeName, modelsFor, refModels, type ModelList } from './carModels';
import './customers.css';

export interface CarChoice { year: string; make: string; model: string }
type Step = 'year' | 'make' | 'model';

/** the three boxes (Année, Marque, Modèle) */
export function CarPicker(p: { value: CarChoice; onValue: (v: CarChoice) => void; errors?: Partial<Record<Step, string | null>>; testid?: string; autoOpen?: boolean }) {
  const [open, setOpen] = useState<Step | null>(p.autoOpen ? 'year' : null);
  const v = p.value;
  const box = (step: Step, label: string, value: string, placeholder: string) => (
    <Field label={label} error={p.errors?.[step] || null}>
      <button type="button" class={`input carpick-box${value ? '' : ' is-empty'}${p.errors?.[step] ? ' is-invalid' : ''}`} onClick={() => setOpen(step)}
        data-testid={`${p.testid || 'car'}-${step}`} aria-haspopup="dialog">
        <span class="grow ellipsis">{value || placeholder}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
    </Field>
  );
  return (
    <>
      <div class="customers-ymm">
        {box('year', t('vehicles.fields.year'), v.year, t('vehicles.pick.yearPh'))}
        {box('make', t('vehicles.fields.make'), v.make, t('vehicles.pick.makePh'))}
        {box('model', t('vehicles.fields.model'), v.model, t('vehicles.pick.modelPh'))}
      </div>
      {open && <CarPickSheet start={open} value={v} onClose={() => setOpen(null)} onDone={(x) => { setOpen(null); p.onValue(x); }} />}
    </>
  );
}

export function CarPickSheet(p: { start: Step; value: CarChoice; onClose: () => void; onDone: (v: CarChoice) => void }) {
  // a step needs the ones before it: the model list needs the year and the make
  const first: Step = p.start === 'model' && (!p.value.year || !p.value.make) ? (!p.value.year ? 'year' : 'make') : p.start === 'make' && !p.value.year ? 'year' : p.start;
  const [step, setStep] = useState<Step>(first);
  const [v, setV] = useState<CarChoice>(p.value);
  const [q, setQ] = useState('');
  const [typing, setTyping] = useState<string | null>(null);
  const go = (s: Step) => { setStep(s); setQ(''); setTyping(null); };
  const pickYear = (y: string) => { const n = { ...v, year: y }; setV(n); go(n.make ? 'model' : 'make'); };
  const pickMake = (m: string) => { const n = { ...v, make: m, model: m === v.make ? v.model : '' }; setV(n); go('model'); };
  const pickModel = (m: string) => p.onDone({ ...v, model: m });
  const crumbs: [Step, string][] = [['year', v.year || t('vehicles.fields.year')], ['make', v.make || t('vehicles.fields.make')], ['model', v.model || t('vehicles.fields.model')]];
  return (
    <Sheet open onClose={p.onClose} title={t('vehicles.pick.title')} data-testid="carpick-sheet"
      footer={<Button onClick={p.onClose}>{t('common.cancel')}</Button>}>
      <div class="stack">
        <nav class="carpick-crumbs" aria-label={t('vehicles.pick.steps')}>
          {crumbs.map(([s, label], i) => (
            <span key={s} class="carpick-crumb-wrap">
              {i > 0 && <ChevronRight size={16} class="faint" aria-hidden="true" />}
              <button type="button" class={`carpick-crumb${step === s ? ' is-on' : ''}`} aria-current={step === s ? 'step' : undefined}
                disabled={(s === 'make' && !v.year) || (s === 'model' && (!v.year || !v.make))} onClick={() => go(s)} data-testid={`carpick-crumb-${s}`}>{label}</button>
            </span>
          ))}
        </nav>
        {step === 'year' && <YearStep value={v.year} onPick={pickYear} typing={typing} setTyping={setTyping} />}
        {step === 'make' && <MakeStep value={v.make} q={q} setQ={setQ} onPick={pickMake} typing={typing} setTyping={setTyping} />}
        {step === 'model' && <ModelStep make={v.make} year={Number(v.year)} value={v.model} q={q} setQ={setQ} onPick={pickModel} typing={typing} setTyping={setTyping} />}
      </div>
    </Sheet>
  );
}

/** « Autre » : a box to type what the list does not have */
function Other(p: { label: string; value: string | null; set: (s: string | null) => void; onOk: (s: string) => void; numeric?: boolean; testid: string }) {
  if (p.value == null) {
    return <Button variant="ghost" icon={<PenLine size={18} />} onClick={() => p.set('')} data-testid={`${p.testid}-other`}>{p.label}</Button>;
  }
  const ok = p.numeric ? /^\d{4}$/.test(p.value) && Number(p.value) >= 1950 && Number(p.value) <= new Date().getFullYear() + 2 : p.value.trim().length > 0;
  return (
    <div class="carpick-other">
      <Input value={p.value} onValue={(x) => p.set(p.numeric ? x.replace(/\D/g, '').slice(0, 4) : x)} autoFocus inputMode={p.numeric ? 'numeric' : 'text'}
        autoCapitalize="words" autoComplete="off" aria-label={p.label} data-testid={`${p.testid}-other-input`}
        onEnter={() => { if (ok) p.onOk(p.value!.trim()); }} />
      <Button variant="primary" disabled={!ok} onClick={() => p.onOk(p.value!.trim())} data-testid={`${p.testid}-other-ok`}>{t('common.ok')}</Button>
    </div>
  );
}

function YearStep(p: { value: string; onPick: (y: string) => void; typing: string | null; setTyping: (s: string | null) => void }) {
  const years = useMemo(() => yearsList(), []);
  return (
    <div class="stack" data-testid="carpick-years">
      <div class="carpick-grid carpick-years" role="listbox" aria-label={t('vehicles.fields.year')}>
        {years.map((y) => (
          <button key={y} type="button" role="option" aria-selected={p.value === String(y)} class={`carpick-cell${p.value === String(y) ? ' is-on' : ''}`}
            onClick={() => p.onPick(String(y))} data-testid={`carpick-year-${y}`}>{y}</button>
        ))}
      </div>
      <Other label={t('vehicles.pick.olderYear')} value={p.typing} set={p.setTyping} onOk={p.onPick} numeric testid="carpick-year" />
    </div>
  );
}

function MakeStep(p: { value: string; q: string; setQ: (s: string) => void; onPick: (m: string) => void; typing: string | null; setTyping: (s: string | null) => void }) {
  const f = fold(p.q);
  const list = (arr: string[]) => arr.filter((m) => !f || fold(m).includes(f));
  const popular = list(POPULAR_MAKES), others = list(OTHER_MAKES);
  const cell = (m: string) => (
    <button key={m} type="button" role="option" aria-selected={p.value === m} class={`carpick-cell${p.value === m ? ' is-on' : ''}`} onClick={() => p.onPick(m)} data-testid={`carpick-make-${m}`}>{m}</button>
  );
  return (
    <div class="stack" data-testid="carpick-makes">
      <SearchInput value={p.q} onValue={p.setQ} placeholder={t('vehicles.pick.searchMake')} data-testid="carpick-make-search" />
      {popular.length > 0 && <div class="carpick-grid carpick-makes" role="listbox" aria-label={t('vehicles.fields.make')}>{popular.map(cell)}</div>}
      {others.length > 0 && (
        <>
          <h3 class="divider-title">{t('vehicles.pick.otherMakes')}</h3>
          <div class="carpick-grid carpick-makes" role="listbox" aria-label={t('vehicles.pick.otherMakes')}>{others.map(cell)}</div>
        </>
      )}
      {!popular.length && !others.length && <p class="muted" style={{ margin: 0 }}>{t('vehicles.pick.noMake')}</p>}
      <Other label={t('vehicles.pick.typeMake')} value={p.typing ?? (popular.length || others.length ? null : p.q ? p.q : null)} set={p.setTyping}
        onOk={(m) => p.onPick(makeName(m))} testid="carpick-make" />
    </div>
  );
}

function ModelStep(p: { make: string; year: number; value: string; q: string; setQ: (s: string) => void; onPick: (m: string) => void; typing: string | null; setTyping: (s: string | null) => void }) {
  const [list, setList] = useState<ModelList | null>(null);
  useEffect(() => {
    let alive = true;
    setList(null);
    modelsFor(p.make, p.year).then((r) => { if (alive) setList(r); }, () => { if (alive) setList({ models: refModels(p.make, p.year), complete: false }); });
    return () => { alive = false; };
  }, [p.make, p.year]);
  const f = fold(p.q);
  const shown = (list?.models || []).filter((m) => !f || fold(m).includes(f));
  return (
    <div class="stack" data-testid="carpick-models">
      <SearchInput value={p.q} onValue={p.setQ} placeholder={t('vehicles.pick.searchModel')} data-testid="carpick-model-search" />
      {!list && <div aria-busy="true"><span class="sr-only">{t('vehicles.pick.loading')}</span><Skeleton h={44} lines={5} /></div>}
      {list && !list.complete && <Banner kind="warn" data-testid="carpick-short">{t('vehicles.pick.short')}</Banner>}
      {list && shown.length > 0 && (
        <div class="carpick-grid carpick-models" role="listbox" aria-label={t('vehicles.fields.model')}>
          {shown.map((m) => (
            <button key={m} type="button" role="option" aria-selected={p.value === m} class={`carpick-cell${p.value === m ? ' is-on' : ''}`}
              onClick={() => p.onPick(m)} data-testid="carpick-model">{m}</button>
          ))}
        </div>
      )}
      {list && !shown.length && <p class="muted" style={{ margin: 0 }}>{list.models.length ? t('vehicles.pick.noMatch') : t('vehicles.pick.noModel', { make: p.make, year: p.year })}</p>}
      <Other label={t('vehicles.pick.typeModel')} value={p.typing} set={p.setTyping} onOk={p.onPick} testid="carpick-model" />
    </div>
  );
}

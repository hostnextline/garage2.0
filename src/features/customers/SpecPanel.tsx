/* « Fiche technique »: the engine's sheet (oil, filters, fluids). A sheet confirmed by a mechanic is shown for every
   car with the same engine. Without one, the old app's list suggests values « à confirmer »; the mechanic picks the
   engine when several are possible, checks the values on the engine, then confirms (or corrects) them. */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { BadgeCheck, Pencil, ClipboardCheck, RefreshCw, Wrench } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { specByKey, staffName } from '../../data/select';
import { saveSpec, saveVehicle } from '../../data/api';
import { me } from '../../data/auth';
import type { SpecData, Vehicle, EngineSpec } from '../../data/types';
import { Panel, Kv, Button, Pill, Banner, Skeleton, Sheet, Field, Input, Textarea, Rows, RowItem, attempt } from '../../ui';
import { engineRef, ensureEngineRef, matchEngine, specFromRow, specKeyOf, type EngineRow } from './engineRef';
import { refLine, refCode, sampleNumber } from './vehicleText';
import { engineWords } from './VehicleBits';
import { stampDay } from './bits';
import './customers.css';

const FIELDS: (keyof SpecData)[] = ['oil_filter', 'drain_torque', 'air_filter', 'cabin_filter', 'plugs', 'coolant', 'trans', 'brake', 'tires', 'pressure', 'wipers', 'battery'];
const litres = (n: number) => new Intl.NumberFormat(lang.value === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 2 }).format(n);

/** the values of a sheet, as lines */
export function SpecValues(p: { data: SpecData; engine?: string | null }) {
  const d = p.data || {};
  const oil = [d.oil_l != null ? `${litres(Number(d.oil_l))} L` : '', d.oil_visc || ''].filter(Boolean).join(' ');
  const items: [string, ComponentChildren][] = [
    [t('vehicles.spec.engine'), p.engine || null],
    [t('vehicles.spec.fields.oil'), oil || null],
    ...FIELDS.map((k) => [t(`vehicles.spec.fields.${k}`), (d[k] as string) || null] as [string, string | null]),
    [t('vehicles.spec.fields.parts'), d.parts?.length ? <span class="stack" style={{ gap: '2px' }}>{d.parts.map((x, i) => <span key={i}>{x.name}{x.ref ? ` (${x.ref})` : ''}{x.qty ? ` × ${x.qty}` : ''}</span>)}</span> : null],
    [t('vehicles.spec.fields.notes'), d.notes ? <span class="customers-prewrap">{d.notes}</span> : null]
  ];
  return <Kv items={items} class="customers-kv customers-spec" />;
}

export function SpecPanel(p: { v: Vehicle; canEdit: boolean }) {
  const v = p.v;
  const linked = specByKey(v.spec_key);
  const sameKey = specKeyOf(v);
  const same = !linked && sameKey ? specByKey(sameKey) : undefined;
  const spec = linked || same;
  const [chosen, setChosen] = useState<EngineRow | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [others, setOthers] = useState(false);
  const [editing, setEditing] = useState<{ engine: string; data: SpecData; row: EngineRow | null } | null>(null);
  const ref = engineRef.value;
  useEffect(() => { if (!spec) void ensureEngineRef(); }, [!!spec]);
  const known = !!(v.year && v.make && v.model);
  const m = known && ref.status === 'ready' ? matchEngine(v, ref.rows) : { best: [], others: [] };
  const pick = chosen || (!choosing && m.best.length === 1 ? m.best[0] : null);

  /** confirms a sheet for this engine and links the car to it */
  const confirm = (data: SpecData, engine: string, row: EngineRow | null) => attempt(async () => {
    const key = specKeyOf({ ...v, displacement: v.displacement || row?.displacement || null });
    if (!key) throw new Error(t('vehicles.spec.needCar'));
    const existing = specByKey(key);
    await saveSpec({ ...(existing ? { id: existing.id } : {}), key, year: v.year, make: v.make, model: v.model, engine: engine || null, data, confirmed_by: me.value?.id ?? null });
    await saveVehicle({
      id: v.id, spec_key: key,
      ...(row && !v.displacement ? { displacement: row.displacement } : {}),
      ...(row && !v.cylinders ? { cylinders: row.cylinders } : {}),
      ...(row && !v.engine ? { engine: refLine(row, engineWords()) } : {})
    });
  }, { ok: t('vehicles.spec.saved') });

  let body: ComponentChildren;
  if (spec) {
    body = (
      <div class="stack">
        <ConfirmedSpec spec={spec} shared={!linked} />
        {p.canEdit && <Button icon={<Pencil size={18} />} class="customers-self-start" onClick={() => setEditing({ engine: spec.engine || '', data: { ...spec.data }, row: null })} data-testid="spec-edit">{t('vehicles.spec.edit')}</Button>}
      </div>
    );
  } else if (!known) {
    body = <p class="muted" style={{ margin: 0 }}>{t('vehicles.spec.needCar')}</p>;
  } else if (ref.status === 'error') {
    body = <Banner kind="warn" title={t('vehicles.spec.error')} action={<Button size="sm" icon={<RefreshCw size={16} />} onClick={() => void ensureEngineRef()}>{t('common.retry')}</Button>} />;
  } else if (ref.status !== 'ready') {
    body = <div aria-busy="true" aria-label={t('vehicles.spec.loading')}><Skeleton h={18} lines={4} /></div>;
  } else if (!m.best.length && !chosen) {
    body = (
      <div class="stack">
        <p style={{ margin: 0 }}><b>{t('vehicles.spec.none')}</b></p>
        <p class="muted" style={{ margin: 0 }}>{t('vehicles.spec.noneText')}</p>
        {p.canEdit && <Button icon={<Wrench size={18} />} class="customers-self-start" onClick={() => setEditing({ engine: v.engine || '', data: {}, row: null })} data-testid="spec-fill">{t('vehicles.spec.fill')}</Button>}
      </div>
    );
  } else if (!pick) {
    const list = others ? [...m.best, ...m.others] : m.best;
    body = (
      <div class="stack">
        <p style={{ margin: 0 }}><b>{t('vehicles.spec.which')}</b></p>
        <p class="muted small" style={{ margin: 0 }}>{t('vehicles.spec.whichText')}</p>
        <EngineChoices rows={list} onPick={setChosen} />
        {!others && m.others.length > 0 && <Button variant="ghost" class="customers-self-start" onClick={() => setOthers(true)}>{t('vehicles.spec.others', { n: m.others.length })}</Button>}
      </div>
    );
  } else {
    const data = specFromRow(pick);
    const engine = refLine(pick, engineWords());
    body = (
      <div class="stack">
        <div class="row-wrap"><Pill tone="warn">{t('vehicles.spec.toConfirm')}</Pill>{refMore(pick) && <span class="small muted">{pick.engine}</span>}</div>
        <SpecValues data={data} engine={engine} />
        <p class="small muted" style={{ margin: 0 }}>{t('vehicles.spec.fromList')}</p>
        {p.canEdit && (
          <div class="customers-actions">
            <Button variant="primary" icon={<BadgeCheck size={18} />} onClick={() => confirm(data, engine, pick)} data-testid="spec-confirm">{t('vehicles.spec.confirm')}</Button>
            <Button icon={<Pencil size={18} />} onClick={() => setEditing({ engine, data: { ...data }, row: pick })} data-testid="spec-correct">{t('vehicles.spec.correct')}</Button>
          </div>
        )}
        {(chosen || m.others.length > 0) && <Button variant="ghost" class="customers-self-start" onClick={() => { setChosen(null); setChoosing(true); if (m.best.length < 2) setOthers(true); }} data-testid="spec-other-engine">{t('vehicles.spec.otherEngine')}</Button>}
      </div>
    );
  }
  return (
    <Panel title={t('vehicles.spec.title')} help={t('vehicles.spec.help')} data-testid="spec-panel">
      {body}
      {editing && (
        <SpecSheet initial={editing} onClose={() => setEditing(null)}
          onSave={async (engine, data) => { if (await confirm(data, engine, editing.row)) { setEditing(null); setChosen(null); setChoosing(false); } }} />
      )}
    </Panel>
  );
}

/** the list's own words about the engine, when they say more than its code (« aluminum oil pan », « Duramax ») */
function refMore(r: EngineRow): boolean {
  const rest = r.engine.replace(/^\d[.,]\dT?\s*/i, '').replace(/^V\d+\s*/i, '').replace(/[()]/g, '').trim();
  return !!rest && rest !== refCode(r);
}

function ConfirmedSpec(p: { spec: EngineSpec; shared: boolean }) {
  const who = staffName(p.spec.confirmed_by);
  const when = stampDay(p.spec.confirmed_at || p.spec.updated_at, !!who);
  return (
    <div class="stack">
      <div class="row-wrap">
        <Pill tone="ok" dot={false}><BadgeCheck size={14} aria-hidden="true" />{t('vehicles.spec.confirmedPill')}</Pill>
        <span class="small muted">{who ? t('vehicles.spec.confirmedBy', { name: who, date: when }) : when ? t('vehicles.spec.confirmedOn', { date: when }) : ''}</span>
      </div>
      {p.shared && <p class="small muted" style={{ margin: 0 }}>{t('vehicles.spec.shared')}</p>}
      <SpecValues data={p.spec.data} engine={p.spec.engine} />
    </div>
  );
}

function EngineChoices(p: { rows: EngineRow[]; onPick: (r: EngineRow) => void }) {
  return (
    <div class="customers-choices">
      <Rows>
        {p.rows.map((r, i) => {
          const oil = [r.oil_l != null ? `${litres(r.oil_l)} L` : '', r.oil_visc].filter(Boolean).join(' ');
          return (
            <RowItem key={i} onClick={() => p.onPick(r)} chevron data-testid="engine-choice"
              title={refLine(r, engineWords())}
              sub={[r.aliases.length ? r.aliases.join(', ') : r.model, `${r.year_from}–${r.year_to}`, oil && t('vehicles.spec.oilShort', { oil })].filter(Boolean).join(', ')} />
          );
        })}
      </Rows>
    </div>
  );
}

/* ---------- writing the sheet ---------- */
function SpecSheet(p: { initial: { engine: string; data: SpecData }; onClose: () => void; onSave: (engine: string, data: SpecData) => Promise<void> }) {
  const [engine, setEngine] = useState(p.initial.engine);
  const [d, setD] = useState<SpecData>(p.initial.data);
  const [oilText, setOilText] = useState(p.initial.data.oil_l != null ? litres(Number(p.initial.data.oil_l)) : '');
  const oil = oilText.trim() ? Number(oilText.replace(',', '.').replace(/[^\d.]/g, '')) : null;
  const oilBad = oil != null && (!Number.isFinite(oil) || oil <= 0 || oil > 30);
  const set = (k: keyof SpecData, val: string) => setD((x) => ({ ...x, [k]: val }));
  const save = async () => {
    if (oilBad) return;
    const clean: SpecData = {};
    for (const [k, val] of Object.entries(d)) if (k !== 'oil_l' && k !== 'parts' && typeof val === 'string' && val.trim()) (clean as Record<string, unknown>)[k] = val.trim();
    if (oil != null) clean.oil_l = Math.round(oil * 100) / 100;
    if (d.parts?.length) clean.parts = d.parts;
    await p.onSave(engine.trim(), clean);
  };
  const text = (k: keyof SpecData, placeholder?: string) => (
    <Field label={t(`vehicles.spec.fields.${k}`)} optional>
      <Input value={(d[k] as string) || ''} onValue={(val) => set(k, val)} placeholder={placeholder} autoComplete="off" />
    </Field>
  );
  return (
    <Sheet open onClose={p.onClose} title={t('vehicles.spec.editTitle')} wide data-testid="spec-sheet"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" icon={<ClipboardCheck size={18} />} onClick={save} disabled={oilBad} data-testid="spec-save">{t('vehicles.spec.save')}</Button>
      </>}>
      <div class="stack">
        <p class="muted small" style={{ margin: 0 }}>{t('vehicles.spec.editLead')}</p>
        <Field label={t('vehicles.spec.engine')} optional>
          <Input value={engine} onValue={setEngine} placeholder="2.0 L 4 cyl. (K20C2)" autoComplete="off" />
        </Field>
        <div class="grid-2">
          <Field label={t('vehicles.spec.fields.oil_l')} error={oilBad ? t('vehicles.spec.oilError') : null} optional>
            <Input value={oilText} onValue={setOilText} inputMode="decimal" placeholder={sampleNumber(4.2, 1, lang.value)} autoComplete="off" invalid={oilBad} data-testid="spec-oil" />
          </Field>
          {text('oil_visc', '0W-20')}
          {text('oil_filter')}
          {text('drain_torque', '40 N·m')}
          {text('air_filter')}
          {text('cabin_filter')}
          {text('plugs')}
          {text('coolant')}
          {text('trans')}
          {text('brake', 'DOT 3')}
          {text('tires', '225/65R17')}
          {text('pressure', '35 psi')}
          {text('wipers')}
          {text('battery')}
        </div>
        <Field label={t('vehicles.spec.fields.notes')} optional>
          <Textarea value={d.notes || ''} onValue={(val) => set('notes', val)} rows={2} />
        </Field>
      </div>
    </Sheet>
  );
}

/* The moment: the block (or with « Plages d'arrivée » the day and its window), chosen in the shared picker. Drawn
   again only when what it shows changes: typing the problem or the name leaves the calendar and its map alone. */
import { memo } from 'preact/compat';
import type { MutableRef } from 'preact/hooks';
import { Panel, Banner } from '../../ui';
import { BlockPicker, type BlockChoice, type VehicleKind } from '../../shared/moment/BlockPicker';
import type { Action } from './draft';
import type { FarAsk } from './far';

export interface MomentPanelProps {
  title: string; sub?: string; error: string | null;
  lat: number | null; lng: number | null; address: string; duration: number; truckId: string | null;
  value: BlockChoice | null; need: boolean; kind: VehicleKind; openDay: string | null; reload: number;
  anchor: MutableRef<HTMLDivElement | null>;
  act: (a: Action) => void;
}
export const MomentPanel = memo(function MomentPanel(p: MomentPanelProps) {
  const { act } = p;
  // a score is for the question the picker was shown: written down with it, so « Réserver » believes it only while it
  // would still ask the same thing (booking-r2-1)
  const ask: FarAsk = { lat: p.lat, lng: p.lng, minutes: p.duration, need: p.need, kind: p.kind, truck: p.truckId };
  return (
    <div ref={p.anchor} class="book-block-anchor">
      <Panel title={p.title} sub={p.sub} data-tour="book-block">
        {p.error && <div style={{ marginBottom: 'var(--sp-3)' }}><Banner kind="bad">{p.error}</Banner></div>}
        <BlockPicker lat={p.lat} lng={p.lng} address={p.address} duration={p.duration} truckId={p.truckId} value={p.value}
          need={p.need} kind={p.kind} onKind={(kind) => act({ t: 'kind', kind })}
          onPick={(choice) => act({ t: 'choice', choice })} onClear={() => act({ t: 'clearChoice' })} openDay={p.openDay} reload={p.reload}
          onFar={(far, seen) => act({ t: 'far', far, seen: seen ? { ...seen, ask } : null })} />
      </Panel>
    </div>
  );
});

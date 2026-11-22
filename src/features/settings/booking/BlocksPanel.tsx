/* The hours of the 3 blocks (matin, après-midi, soir), only while the garage books by blocks. */
import { t } from '../../../lib/i18n';
import { Panel } from '../../../ui';
import { TimeInput } from '../fields';
import { blockError } from './model';
import type { PartProps } from './BookingSection';

export function BlocksPanel({ d, set }: PartProps) {
  const setBlock = (i: number, part: 'start' | 'end', v: number) => set((x) => ({ ...x, blocks: x.blocks.map((bl, k) => (k === i ? { ...bl, [part]: v } : bl)) }));
  return (
    <Panel title={t('settings.booking.blocks')} help={t('settings.booking.blocksHelp')}>
      <div class="settings-blocks">
        {d.blocks.map((bl, i) => {
          const e = blockError(d.blocks, i);
          const name = t(`common.blocks.${bl.key}`);
          return (
            <div key={bl.key} class="settings-block" data-testid={`block-${bl.key}`}>
              <b class="settings-block-name">{name}</b>
              <label class="settings-block-time"><span class="small muted">{t('settings.booking.from')}</span>
                <TimeInput value={bl.start} onValue={(v) => setBlock(i, 'start', v)} invalid={!!e} aria-label={`${name}, ${t('settings.booking.from')}`} /></label>
              <label class="settings-block-time"><span class="small muted">{t('settings.booking.to')}</span>
                <TimeInput value={bl.end} onValue={(v) => setBlock(i, 'end', v)} invalid={!!e} aria-label={`${name}, ${t('settings.booking.to')}`} /></label>
              {e && <span class="field-error settings-block-err" role="alert">{e}</span>}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

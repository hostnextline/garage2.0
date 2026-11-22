/* The moment of an appointment, for booking and moving a job: a block (matin, après-midi, soir), or with « Plages
   d'arrivée » a day and its window. The screens import the picker and the names of a choice from here; each mode has
   its own picker (BlocksPicker, WindowPicker) with the same props. */
import { windowsOn } from '../../data/select';
import type { BlockPickerProps } from '../../domain/moment/choice';
import { BlocksPicker } from './BlocksPicker';
import { WindowPicker } from './WindowPicker';
import './booking.css';

export type { BlockChoice, BlockPickerProps, VehicleKind } from '../../domain/moment/choice';
export type { FarInfo } from '../../domain/moment/logic';
export { choiceWords } from '../../domain/moment/choice';

/** the moment of an appointment: a block (matin, après-midi, soir), or with « Plages d'arrivée » a day and its window */
export function BlockPicker(p: BlockPickerProps) {
  return windowsOn.value ? <WindowPicker {...p} /> : <BlocksPicker {...p} />;
}

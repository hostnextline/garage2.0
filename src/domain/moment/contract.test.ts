/* The names other packages import from domain/moment (wave1 contract « booking », plus helpers other branches use:
   map-hours' TruckDaySheet imports listWords). A name hidden or renamed here breaks their build after the merge, so it
   breaks this test first: the types are checked by tsc through this file, the values here. */
import { describe, it, expect } from 'vitest';
import * as choice from './choice';
import * as dayWords from './dayWords';
import * as days from './days';
import * as grid from './grid';
import * as logic from './logic';
import * as outbox from './outbox';
import * as units from './units';
import * as words from './words';
import type { BlockChoice, BlockPickerProps, VehicleKind } from './choice';
import type { Box, Slot } from './grid';
import type { CellState, FarInfo, ItemDraft, Moment } from './logic';
import type { UnitState, Win } from './units';

/** the contract's types, used once so that tsc checks they are still exported */
export type ContractTypes = [BlockChoice, BlockPickerProps, VehicleKind, Box, Slot, CellState, FarInfo, ItemDraft, Moment, UnitState, Win];

const VALUES: [string, Record<string, unknown>, string[]][] = [
  ['choice', choice, ['choiceWords', 'winLen']],
  ['dayWords', dayWords, ['dateShort', 'dayInline', 'dayOfIso', 'dayWord', 'stampDay']],
  ['days', days, ['dayChips', 'dayCounts', 'defaultBlock', 'overviewPins']],
  ['grid', grid, ['UNIT', 'MIN_UNITS', 'dropWindowStart', 'jobBox', 'jobMinute', 'minuteAt', 'openingUnit', 'overlapColumns', 'unitCount', 'unitIndex', 'unitMinute', 'unitMinutes', 'unitsAt', 'workedUnits']],
  ['logic', logic, ['betterMoments', 'betterText', 'cellState', 'choiceWindow', 'draftOfService', 'farInfo', 'farLimits', 'farQuestion', 'isFar', 'itemsDuration', 'momentsByKey', 'moveWindow', 'offered', 'roadWords', 'sameMoment', 'suggWindow', 'workMinutes']],
  ['outbox', outbox, ['forgetRefusal', 'noLongWaitOffline']],
  ['units', units, ['byHour', 'cacheKey', 'lastPage', 'moveFocus', 'pageDays', 'pageOf', 'possibleUnits', 'rowsByStart', 'unitOfWindow', 'unitStates']],
  ['words', words, ['blockPhrase', 'blockPhraseLower', 'blockPhraseWithHours', 'dayMonth', 'freeWords', 'rangesWords', 'relativeDay', 'spanEnds', 'weekdaysWords', 'windowPhrase', 'windowWords', 'listWords', 'shortDuration']]
];

describe('the names other packages import from domain/moment', () => {
  it('are all still exported', () => {
    const gone = VALUES.flatMap(([file, mod, names]) => names.filter((n) => mod[n] === undefined).map((n) => `${file}.${n}`));
    expect(gone).toEqual([]);
  });
  it('listWords and shortDuration keep their words (map-hours, agenda)', () => {
    expect(words.listWords(['8 h à 12 h', '13 h à 20 h'], 'fr')).toBe('8 h à 12 h et 13 h à 20 h');
    expect(words.listWords(['a'], 'fr')).toBe('a');
    expect(words.shortDuration(128)).toBe('2 h 08');
    expect(words.shortDuration(45)).toBe('45 min');
    expect(grid.MIN_UNITS).toBe(2);
  });
});

import type { timesheet as fr } from '../fr/timesheet';
export const timesheet: typeof fr = {
  title: 'Hours worked',
  mine: 'My hours',
  help: 'The hours come from the “Start my day” and “End my day” buttons of “My day”. A day counts on the day it started. The week goes from Monday to Sunday.',
  helpAll: 'The hours come from the “Start my day” and “End my day” buttons. Each mechanic sees only their own hours; the owners and the treasurer see everyone’s and can correct them. Every correction is kept.',
  week: { prev: 'Week before', next: 'Week after', now: 'This week' },
  total: 'Total for the week',
  days: { zero: 'No day worked', one: '{n} day worked', other: '{n} days worked' },
  month: 'Total for {month}',
  team: 'The team',
  teamSub: 'Tap a person to see their days.',
  teamTotal: 'The whole team',
  nobody: 'Nobody to show',
  nobodyText: 'The team’s mechanics show up here, with their hours for the week.',
  onShift: 'On the clock since {time}',
  list: 'The days',
  off: 'Not worked',
  open: 'Under way since {time}',
  nextDay: 'the next day',
  check: 'To check',
  checkCount: { one: '{n} to check', other: '{n} to check' },
  checkAll: {
    one: '{n} day to check: “End my day” was forgotten and the day closed by itself during the night. Tap it to write the real end time.',
    other: '{n} days to check: “End my day” was forgotten and they closed by themselves during the night. Tap each one to write the real end time.'
  },
  checkMine: {
    one: '{n} day to check: “End my day” was forgotten and it closed by itself during the night. Tell the owner or the treasurer your real end time: they correct it here.',
    other: '{n} days to check: “End my day” was forgotten and they closed by themselves during the night. Tell the owner or the treasurer your real end times: they correct them here.'
  },
  fixed: 'Corrected by {who}, {when}',
  fixedShort: 'Corrected',
  add: 'Add hours',
  addHere: 'Add',
  seeMine: 'See my hours',
  sheet: {
    edit: 'Correct the day',
    add: 'Add hours',
    day: 'The day',
    start: 'Start',
    end: 'End',
    openEnd: 'Under way: the end is set when {name} taps “End my day”.',
    nextDay: 'Ends the next day, {day}.',
    total: 'Length: {time}',
    forgot: 'Closed by itself at {time}: “End my day” was forgotten. Write the real end time.',
    save: 'Save',
    saved: 'Hours saved',
    remove: 'Remove this day',
    removeConfirm: 'Tap again to remove',
    removed: 'Day removed from the hours',
    kept: 'Every correction is kept: who, when, before and after.',
    errors: {
      no_start: 'Write the start time.',
      no_end: 'Write the end time.',
      zero: 'The start and the end are the same time.',
      too_long: 'A day can’t be longer than 24 hours.',
      future: 'This time hasn’t come yet.',
      overlap: 'These hours overlap another day of this person.'
    }
  }
};

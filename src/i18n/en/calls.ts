import type { calls as fr } from '../fr/calls';
export const calls: typeof fr = {
  title: 'Calls',
  sub: 'What was said on the phone, written by itself after each call.',
  count: { one: '{n} call noted', other: '{n} calls noted' },
  in: 'Call received', out: 'Call made',
  told: 'We told them:', todo: 'To do:',
  showAll: 'See everything that was said', hideAll: 'Hide', noTranscript: 'Nothing written for this call.',
  file: 'Their file', book: 'Book', newCustomer: 'Create the customer',
  unknown: 'Unknown number',
  writing: 'The note is being written… it arrives in a minute or two.',
  failed: 'Note not written', redo: 'Try again',
  short: 'Call too short for a note.', noRecording: 'No recording for this call.',
  sync: 'Look for calls', syncing: 'Looking…',
  synced: '{n} notes written, {m} waiting.',
  noKey: 'The OpenAI key is missing: put it in Settings, Connections.',
  tabs: { all: 'All calls', todo: 'To do' },
  empty: 'No call noted yet', emptyTodo: 'Nothing to do: all settled.',
  emptyText: 'After a call on the garage’s number, its note arrives here by itself. It needs the OpenAI key and call recording switched on in GoHighLevel.',
  toSettings: 'Open the connections'
};

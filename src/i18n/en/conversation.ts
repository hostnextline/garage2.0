import type { conversation as fr } from '../fr/conversation';
export const conversation: typeof fr = {
  title: 'Conversation',
  open: 'Conversation',
  from: 'Through the garage’s number (GoHighLevel)',
  refresh: 'Refresh',
  empty: 'No texts with this customer yet.',
  placeholder: 'Write your answer…',
  send: 'Send',
  sent: 'Text sent from the garage’s number',
  them: 'Customer',
  us: 'Garage',
  smsOff: 'This customer does not want texts.',
  file: { photo: 'Photo', openPhoto: 'Open the photo full size', video: 'Video', audio: 'Voice message', doc: 'Document', open: 'Open' },
  bubble: {
    title: 'Conversation with {name}',
    open: 'Open the conversation with {name}',
    unread: { one: '{n} new text', other: '{n} new texts' },
    min: 'Minimise',
    close: 'Close the conversation',
    file: 'Their file',
    book: 'Book for this number',
    noFile: 'No file yet',
    noWords: '📎 Photo or document',
    off: 'Texts are not connected (Settings, Connections): you see what came in, but cannot answer from here.',
    error: 'The texting service did not answer: here is what came in. The rest comes back in a moment.'
  },
  status: {
    ok: '',
    off: 'Automatic texts are not connected (Settings, Connections).',
    no_phone: 'This customer has no cell number.',
    error: 'The text service did not answer. Try again in a moment.',
    offline: 'No signal: the conversation will come back with the signal.'
  }
};

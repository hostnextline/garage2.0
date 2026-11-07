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
  status: {
    ok: '',
    off: 'Automatic texts are not connected (Settings, Connections).',
    no_phone: 'This customer has no cell number.',
    error: 'The text service did not answer. Try again in a moment.',
    offline: 'No signal: the conversation will come back with the signal.'
  }
};

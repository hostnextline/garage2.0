/* What the buttons of a job do, the same from « Ma journée » and from the job sheet. Kept as the one door other sections
   import from (« Ma journée », « La journée »); the job section's own files import the pieces directly:
   actions.ts (the steps), texts.ts (the texts to the customer), signatures.ts, returnTrip.ts. */
export { sendText, sendTracking, outcome, trackingSent, type TextOutcome } from './texts';
export { doReturn, doReturnEnd } from './returnTrip';
export { doLeave, doArrive, doVin, doFinish, letGo, doCancel, doNoShow, doBack, doReopen, startInvoice } from './actions';
export { signWaiver, answerBySignature, answerByVoice } from './signatures';

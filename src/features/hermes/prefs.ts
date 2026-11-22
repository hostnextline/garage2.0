/* 🤖 Hermes: the two choices remembered on this device (the keys are the ones of the app since Hermes came). */

const LANG = 'his-hermes-lang', VOICE = 'his-hermes-voice';
export type DictLang = 'fr-CA' | 'en-CA';

function read(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
// a private window or full storage: the choice holds until the app closes, nothing to tell the person
function write(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* not kept on this device */ } }

/** the language of the dictation */
export function dictLang(): DictLang { return read(LANG) === 'en-CA' ? 'en-CA' : 'fr-CA'; }
export function setDictLang(v: DictLang) { write(LANG, v); }
/** answers read out loud */
export function voiceOn(): boolean { return read(VOICE) === '1'; }
export function setVoiceOn(v: boolean) { write(VOICE, v ? '1' : '0'); }

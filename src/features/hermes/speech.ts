/* 🤖 Hermes: the browser's voice, like the CRM's: reading an answer out loud, and dictation (the microphone).
   Both are the browser's own; a browser without them simply has no button. */

/* ---------- reading out loud ---------- */
/** French or English, from the small words of the text (to pick the voice) */
export function isFrench(s: string): boolean {
  const w = (s.toLowerCase().match(/\b(le|la|les|des|est|pour|vous|tu|une|avec|que|qui|pas|dans|sur|votre|ton)\b/g) || []).length;
  return w >= Math.max(3, s.split(/\s+/).length * 0.08);
}
/** the parts read one after the other: one sentence each, without the marks of formatting */
export function sentences(text: string): string[] {
  return (text.replace(/[*#_`>|]/g, '').match(/[^.!?\n]+[.!?]?/g) || []).map((x) => x.trim()).filter(Boolean);
}
function synth(): SpeechSynthesis | null {
  try { return typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null; } catch { return null; }
}
export function speak(text: string) {
  const ss = synth();
  if (!ss) return;
  ss.cancel();
  const l = isFrench(text) ? 'fr-CA' : 'en-CA';
  const voices = ss.getVoices();
  const v = voices.find((x) => x.lang === l) || voices.find((x) => x.lang?.startsWith(l.slice(0, 2)));
  for (const part of sentences(text)) {
    const u = new SpeechSynthesisUtterance(part); u.lang = l; if (v) u.voice = v; ss.speak(u);
  }
}
export function stopSpeaking() { synth()?.cancel(); }

/* ---------- dictation ---------- */
export interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionClass = new () => Recognition;
type Policy = { allowsFeature?: (f: string) => boolean };

/** the browser's dictation, when it has one AND the site lets it use the microphone (the hosting's Permissions-Policy
    header can switch the microphone off for the whole site: then the button would only ever answer « not allowed ») */
export function recognition(w: Window & typeof globalThis = window): RecognitionClass | null {
  const g = w as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass; document?: { permissionsPolicy?: Policy; featurePolicy?: Policy } };
  const R = g.SpeechRecognition || g.webkitSpeechRecognition || null;
  if (!R) return null;
  const policy = g.document?.permissionsPolicy || g.document?.featurePolicy;
  try { if (policy?.allowsFeature && !policy.allowsFeature('microphone')) return null; } catch { /* an old browser: try anyway */ }
  return R;
}

/** the words heard so far, after what was already in the box */
export function heard(before: string, results: ArrayLike<ArrayLike<{ transcript: string }>>): string {
  let s = '';
  for (let i = 0; i < results.length; i++) s += results[i][0]?.transcript || '';
  return (before ? before.trimEnd() + ' ' : '') + s;
}

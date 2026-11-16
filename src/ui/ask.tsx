/* ask() / askText(): a short question with two answers, returned as a promise, drawn by AskHost (mounted once by the
   app). Questions wait in line; the buttons of a new question ignore taps for a moment (`hold`), so the second tap of a
   double tap on « OK » never answers the next question too. */
import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { t } from '../lib/i18n';
import { Button } from './Button';
import { Textarea } from './forms';
import { Sheet } from './Sheet';

/** a question just shown ignores answers this long */
export const ASK_DEAD_MS = 400;

interface Ask { id: number; title: string; text?: string; ok: string; cancel: string; danger: boolean; input?: { label: string; value: string; required: boolean }; resolve: (v: string | boolean | null) => void }
const asks = signal<Ask[]>([]);
let askSeq = 0;
/** a yes/no question: resolves true (ok) or false */
export function ask(o: { title: string; text?: string; ok?: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    asks.value = [...asks.value, { id: ++askSeq, title: o.title, text: o.text, ok: o.ok || t('common.ok'), cancel: o.cancel || t('common.cancel'), danger: !!o.danger, resolve: (v) => resolve(v === true) }];
  });
}
/** a question that needs a few words (a reason…): resolves the text, or null when cancelled */
export function askText(o: { title: string; text?: string; label: string; value?: string; ok?: string; required?: boolean; danger?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    asks.value = [...asks.value, {
      id: ++askSeq, title: o.title, text: o.text, ok: o.ok || t('common.ok'), cancel: t('common.cancel'), danger: !!o.danger,
      input: { label: o.label, value: o.value || '', required: o.required !== false }, resolve: (v) => resolve(typeof v === 'string' ? v : null)
    }];
  });
}
export function AskHost() {
  const a = asks.value[0];
  const [text, setText] = useState('');
  useEffect(() => { setText(a?.input?.value || ''); }, [a?.id]);
  if (!a) return null;
  const done = (v: string | boolean | null) => {
    if (asks.value[0] !== a) return;                                   // already answered (a second tap)
    asks.value = asks.value.slice(1);
    a.resolve(v);
  };
  const okDisabled = !!a.input?.required && !text.trim();
  return (
    <Sheet open onClose={() => done(a.input ? null : false)} title={a.title}
      footer={<>
        <Button key={`c${a.id}`} hold={ASK_DEAD_MS} onClick={() => done(a.input ? null : false)}>{a.cancel}</Button>
        <Button key={`o${a.id}`} hold={ASK_DEAD_MS} variant={a.danger ? 'danger' : 'primary'} disabled={okDisabled} onClick={() => done(a.input ? text.trim() : true)} data-testid="ask-ok">{a.ok}</Button>
      </>}>
      {a.text && <p class="muted">{a.text}</p>}
      {a.input && (
        <label class="field">
          <span class="field-label">{a.input.label}</span>
          <Textarea value={text} onValue={setText} rows={2} autoFocus />
        </label>
      )}
    </Sheet>
  );
}

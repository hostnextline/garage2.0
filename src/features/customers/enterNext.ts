/* Entrée (or the phone keyboard's « suivant ») in a field of a long form goes to the next field instead of sending the
   form: a half-filled customer was created by a tap on « suivant ». Only the button creates. A key already used by the
   field itself (the address field choosing a suggestion) is left alone. */
const FIELDS = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

export function enterGoesNext(e: KeyboardEvent, submit: string) {
  const el = e.target as HTMLElement | null;
  if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || !el || el.tagName !== 'INPUT') return;
  const type = (el as HTMLInputElement).type;
  if (type === 'submit' || type === 'button' || type === 'checkbox' || type === 'radio') return;
  const scope = e.currentTarget as HTMLElement;
  e.preventDefault();
  const all = [...scope.querySelectorAll<HTMLElement>(FIELDS)].filter((x) => !x.closest('[hidden], [aria-hidden="true"]'));
  const next = all[all.indexOf(el) + 1] || scope.querySelector<HTMLElement>(submit);
  next?.focus();
}

import { describe, it, expect } from 'vitest';
import { enterGoesNext } from './enterNext';

function form() {
  const box = document.createElement('form');
  box.innerHTML = '<div><input id="a"><input id="b" type="tel"><textarea id="c"></textarea><button id="go" type="submit">Créer</button></div>';
  document.body.appendChild(box);
  let sent = 0;
  box.addEventListener('submit', (e) => { e.preventDefault(); sent++; });
  const inner = box.firstElementChild as HTMLElement;
  inner.addEventListener('keydown', (e) => enterGoesNext(e, '#go'));
  return { box, sent: () => sent };
}
const enter = (el: Element) => { const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); el.dispatchEvent(e); return e; };

describe('Entrée in the new customer form (customers-a-14)', () => {
  it('moves to the next field and never sends the form', () => {
    const f = form();
    const e = enter(f.box.querySelector('#a')!);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('b');
    enter(f.box.querySelector('#b')!);
    expect(document.activeElement?.id).toBe('c');
    f.box.remove();
  });
  it('a key the field already used is left alone', () => {
    const f = form();
    const a = f.box.querySelector('#a')!;
    a.addEventListener('keydown', (e) => e.preventDefault());
    (f.box.querySelector('#b') as HTMLElement).focus();
    enter(a);
    expect(document.activeElement?.id).toBe('b');
    f.box.remove();
  });
});

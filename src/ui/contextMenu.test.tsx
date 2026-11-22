/* The agenda's menu and the invisible layer under it: the late right-click Android sends after a long press keeps the
   menu that just opened; a real right-click elsewhere opens the menu of what is under the mouse, as before the layer. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ContextMenuHost, openMenu, openMenuAt, pressProps, PRESS_MS, type MenuAction } from './ContextMenu';

const acts = (key: string): MenuAction[] => [{ key, label: key, run: () => undefined, testid: `menu-${key}` }];
const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] }) as unknown as TouchEvent;
const rightClick = (el: Element, x = 30, y = 40) => {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
  act(() => { el.dispatchEvent(e); });
  return e;
};

let root: HTMLDivElement;
let n = 0;
const realPoint = document.elementsFromPoint;
beforeEach(() => {
  vi.useFakeTimers();
  // each test well apart from the one before (a long press of a test before never counts)
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 16, 12, n++ * 5, 0)));
  root = document.createElement('div');
  document.body.appendChild(root);
  act(() => { render(<ContextMenuHost />, root); });
});
afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  document.elementsFromPoint = realPoint;
  vi.useRealTimers();
});
const shade = () => document.querySelector('.agenda-menu-shade')!;
const items = () => Array.from(document.querySelectorAll('.agenda-menu-item')).map((b) => b.textContent);

describe('the layer under the menu', () => {
  it('Android’s right-click right after a long press keeps the menu that just opened', () => {
    const p = pressProps((x, y) => { openMenuAt(x, y, acts('copier')); });
    act(() => { p.onTouchStart(touch(30, 40)); vi.advanceTimersByTime(PRESS_MS); });
    expect(items()).toEqual(['copier']);
    const e = rightClick(shade());
    expect(e.defaultPrevented).toBe(true);
    expect(items()).toEqual(['copier']);
  });
  it('a real right-click on another appointment while a menu is open opens that one’s menu at the mouse', () => {
    const other = document.createElement('div');
    other.addEventListener('contextmenu', (ev) => openMenu(ev, acts('autre')));
    document.body.appendChild(other);
    act(() => { openMenuAt(10, 10, acts('premier')); });
    expect(items()).toEqual(['premier']);
    document.elementsFromPoint = () => [shade(), other];
    const e = rightClick(shade(), 120, 140);
    expect(items()).toEqual(['autre']);
    expect(e.defaultPrevented).toBe(true);
    other.remove();
  });
  it('a right-click on a spot with nothing to offer closes the menu and leaves the browser’s own', () => {
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    act(() => { openMenuAt(10, 10, acts('premier')); });
    document.elementsFromPoint = () => [shade(), plain];
    const e = rightClick(shade());
    expect(document.querySelector('[data-testid="agenda-menu"]')).toBeNull();
    expect(e.defaultPrevented).toBe(false);
    plain.remove();
  });
});

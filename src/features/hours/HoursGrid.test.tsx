/* The glass window: a dimmed day (« one day »: the other weekdays) cannot be painted (map-hours-24). */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { HoursGrid } from './HoursGrid';
import { emptyPanes, type Panes } from './grid';

const box = document.createElement('div');
document.body.appendChild(box);
const down = (el: Element) => { const e = new Event('pointerdown', { bubbles: true, cancelable: true }); Object.assign(e, { pointerType: 'mouse', button: 0, pointerId: 1 }); el.dispatchEvent(e); };

describe('the glass window', () => {
  afterEach(() => render(null, box));
  it('paints the day that will be applied, never a dimmed one', async () => {
    const got: Panes[] = [];
    await act(async () => { render(<HoursGrid panes={emptyPanes()} onPanes={(p) => got.push(p)} color="#D3000E" truckName="Camion" editable week day={2} dim={[0, 1, 3, 4, 5, 6]} />, box); });
    await act(async () => { down(box.querySelector('[data-d="1"][data-u="600"]')!); });
    expect(got).toHaveLength(0);
    await act(async () => { down(box.querySelector('[data-d="2"][data-u="600"]')!); });
    expect(got).toHaveLength(1);
    expect(got[0][2]).toEqual([600]);
  });
});

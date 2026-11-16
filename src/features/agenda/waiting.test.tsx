/* A move kept on the phone is said on the job (agenda-14): « En attente d’envoi » on the chip of the week, the block of
   the time grid and the ticket, and no « Déplacer » in its menu while it waits (a second move would queue behind it). */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { access } from '../../data/auth';
import { t } from '../../lib/i18n';
import type { Access, Job } from '../../data/types';
import { movesWaiting } from './move';
import { Chip } from './Chip';
import { GridJob } from './GridJob';
import { Ticketed } from './Lanes';
import { jobActions } from './actions';
import { canDragJob } from './drag';

const owner = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const job = { id: 'j1', number: 7, day: '2026-11-20', block: 'am', status: 'booked', truck_id: 't1', stop_order: 1, duration_min: 60, customer_id: null, eta_min: 600 } as unknown as Job;
const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => { act(() => render(null, box)); movesWaiting.value = new Set(); access.value = null; });
const noop = () => {};

describe('a move waiting on the phone (agenda-14)', () => {
  it('is said on the chip, the grid block and the ticket, and goes away once sent', () => {
    access.value = owner;
    act(() => render(<div>
      <Chip job={job} draggable dragging={false} onDragStart={noop} onDragEnd={noop} />
      <GridJob job={job} box={{ top: 0, height: 4 }} slot={{ col: 0, cols: 1 }} compact={false} draggable dragging={false} onDragStart={noop} onDragEnd={noop} />
      <Ticketed job={job} />
    </div>, box));
    expect(box.querySelector('[data-testid="chip-wait-j1"]')).toBeNull();
    expect(box.textContent).not.toContain(t('agenda.move.waiting'));
    act(() => { movesWaiting.value = new Set(['j1']); });
    expect(box.querySelector('[data-testid="chip-wait-j1"]')?.textContent).toBe(t('agenda.move.waiting'));
    expect(box.querySelector('[data-testid="grid-wait-j1"]')).not.toBeNull();
    expect(box.querySelector('[data-testid="ticket-wait-j1"]')).not.toBeNull();
    expect(box.querySelector('[data-testid="chip-j1"]')?.getAttribute('title')?.startsWith(`${t('agenda.move.waiting')}, `)).toBe(true);
    expect(box.querySelector('[data-testid="chip-j1"]')?.classList.contains('is-waiting')).toBe(true);
    expect(canDragJob(job)).toBe(false);
    act(() => { movesWaiting.value = new Set(); });
    expect(box.querySelector('[data-testid="chip-wait-j1"]')).toBeNull();
    expect(box.querySelector('[data-testid="grid-wait-j1"]')).toBeNull();
    expect(canDragJob(job)).toBe(true);
  });
  it('hides « Déplacer » from the job’s menu while its move waits', () => {
    access.value = owner;
    expect(jobActions(job).actions.map((a) => a.key)).toContain('move');
    movesWaiting.value = new Set(['j1']);
    expect(jobActions(job).actions.map((a) => a.key)).not.toContain('move');
  });
});

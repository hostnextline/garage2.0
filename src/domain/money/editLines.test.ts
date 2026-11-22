import { describe, it, expect } from 'vitest';
import { withKeys, keepKeys, newLine, fromDrafts } from './editLines';

describe('lines in the editor', () => {
  it('every line gets its own key; numbers and words are read like the server', () => {
    const l = withKeys([{ description: 'a', qty: '2' as unknown as number, unit_cents: '100' as unknown as number }, { description: null, unit_cents: 5 }]);
    expect(l.map((x) => [x.qty, x.unit_cents, x.taxable, x.description])).toEqual([[2, 100, true, 'a'], [1, 5, true, '']]);
    expect(new Set(l.map((x) => x._k)).size).toBe(2);
    expect(newLine('discount', 'Rabais')).toMatchObject({ kind: 'discount', description: 'Rabais', qty: 1, unit_cents: 0 });
    expect(fromDrafts([{ description: 'Vidange', qty: 1, unit_cents: 8999, taxable: true, kind: 'service', service_id: 's-1', duration_min: 30, item_id: null }])[0])
      .toMatchObject({ service_id: 's-1', duration_min: 30, kind: 'service' });
  });
  it('a version from the server keeps the keys on screen (the field being typed in keeps the focus)', () => {
    const shown = withKeys([{ description: 'Freins', item_id: 'ji-1', unit_cents: 100 } as never, { description: 'à la main', unit_cents: 5 }]);
    const server = withKeys([{ description: 'Freins', item_id: 'ji-1', unit_cents: 120 } as never, { description: 'à la main', unit_cents: 7 }, { description: 'nouvelle', unit_cents: 1 }]);
    const out = keepKeys(server, shown);
    expect(out[0]._k).toBe(shown[0]._k);
    expect(out[1]._k).toBe(shown[1]._k);
    expect(out[2]._k).toBe(server[2]._k);
    expect(out[0].unit_cents).toBe(120);
  });
  it('a job line that moved keeps its key; a key is never used twice', () => {
    const shown = withKeys([{ description: 'A', item_id: 'a' } as never, { description: 'B', item_id: 'b' } as never]);
    const server = withKeys([{ description: 'B', item_id: 'b' } as never, { description: 'A', item_id: 'a' } as never, { description: 'A bis', item_id: 'a' } as never]);
    const out = keepKeys(server, shown);
    expect(out.map((l) => l._k)).toEqual([shown[1]._k, shown[0]._k, server[2]._k]);
  });
});

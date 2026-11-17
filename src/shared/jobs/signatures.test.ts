/* The authorization signed with the finger (jobs-a-38: the signature's way had no test): nothing drawn is refused before
   anything is sent; signed without signal, the job shows it signed at once. The server is pretended. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({ saveSignature: vi.fn((..._a: unknown[]) => Promise.resolve({ queued: false } as { queued: boolean })) }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), ...api }));
const sign = vi.hoisted(() => ({ exportSignature: vi.fn((..._a: unknown[]) => ({ dataUrl: 'data:image/png;base64,AAAA', width: 300, height: 120 }) as { dataUrl: string; width: number; height: number } | null) }));
vi.mock('../sign/signature', async (orig) => ({ ...(await orig<typeof import('../sign/signature')>()), ...sign }));

import { net } from '../../data/sync';
import { clearAll } from '../../data/store';
import { toasts } from '../../ui/toast';
import { t } from '../../lib/i18n';
import type { Job } from '../../data/types';
import { signWaiver } from './signatures';
import { seen } from './select';

const JOB = { id: 'j1', status: 'on_site', waiver_signed_at: null, updated_at: '2026-11-15T13:00:00Z' } as unknown as Job;
beforeEach(() => { clearAll(); api.saveSignature.mockClear(); toasts.value = []; });

describe('« Faire signer l’autorisation »', () => {
  it('nothing drawn: refused with its reason, nothing sent', async () => {
    sign.exportSignature.mockReturnValueOnce(null);
    expect(await signWaiver(JOB, [], 'Julie Roy')).toBe(false);
    expect(api.saveSignature).not.toHaveBeenCalled();
    expect(toasts.value.some((x) => x.text === t('errors.signature'))).toBe(true);
  });
  it('signed: the picture, the signer and the waiver’s version go to the server', async () => {
    expect(await signWaiver(JOB, [[{ x: 0, y: 0 }, { x: 9, y: 9 }]] as never, 'Julie Roy')).toBe(true);
    expect(api.saveSignature).toHaveBeenCalledWith('j1', 'data:image/png;base64,AAAA', 'Julie Roy', '1');
  });
  it('signed without signal: the job shows it signed at once (the red button goes on)', async () => {
    api.saveSignature.mockResolvedValueOnce({ queued: true });
    net.value = { ...net.value, pending: 1 };
    expect(await signWaiver(JOB, [[{ x: 0, y: 0 }, { x: 9, y: 9 }]] as never, 'Julie Roy')).toBe(true);
    expect(seen(JOB).waiver_signed_at).toBeTruthy();
    net.value = { ...net.value, pending: 0 };
  });
});

/* The pictures and documents of a message, as drawn in the conversation. */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Attachments } from './Attachments';

const box = document.createElement('div');
document.body.appendChild(box);
const draw = (files: string[] | undefined) => act(() => render(<Attachments files={files} />, box));
afterEach(() => act(() => render(null, box)));
const q = (id: string) => [...box.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];

describe('pictures and documents in the conversation', () => {
  it('nothing for a message with words only', () => {
    draw(undefined);
    expect(box.innerHTML).toBe('');
    draw([]);
    expect(box.innerHTML).toBe('');
  });
  it('a picture shows (a tap opens it full size), a document is a link with its name, a video and a voice note play', () => {
    draw(['https://x.test/pneu.jpg', 'https://x.test/Facture%20123.pdf', 'https://x.test/clip.mp4', 'https://x.test/note.m4a', 'javascript:alert(1)']);
    const pic = q('conversation-photo');
    expect(pic).toHaveLength(1);
    expect(pic[0].getAttribute('href')).toBe('https://x.test/pneu.jpg');
    expect(pic[0].getAttribute('target')).toBe('_blank');
    expect(pic[0].querySelector('img')?.getAttribute('src')).toBe('https://x.test/pneu.jpg');
    const doc = q('conversation-doc');
    expect(doc).toHaveLength(1);
    expect(doc[0].getAttribute('href')).toBe('https://x.test/Facture%20123.pdf');
    expect(doc[0].textContent).toContain('Facture 123.pdf');
    expect(q('conversation-video')[0].getAttribute('src')).toBe('https://x.test/clip.mp4');
    expect(q('conversation-audio')[0].getAttribute('src')).toBe('https://x.test/note.m4a');
    expect(box.innerHTML).not.toContain('javascript:');
  });
  it('an address with no ending is tried as a picture; one that does not load becomes a link', () => {
    draw(['https://x.test/media/8f2c91']);
    const img = box.querySelector('img')!;
    expect(img).toBeTruthy();
    act(() => { img.dispatchEvent(new Event('error')); });
    expect(box.querySelector('img')).toBeNull();
    expect(q('conversation-doc')[0].getAttribute('href')).toBe('https://x.test/media/8f2c91');
  });
});

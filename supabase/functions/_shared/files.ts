// The pictures and documents that come with a text (MMS): read from what GoHighLevel gives. No import: tested by the app's unit tests.
/** the pictures and documents of a message (their web addresses), wherever GoHighLevel put them */
export function filesOf(x: unknown): string[] {
  const m = (x && typeof x === 'object' ? x : {}) as Record<string, any>;
  const list = [m.attachments, m.attachment, m.mediaUrls, m.media_urls, m.media].flatMap((v) => (Array.isArray(v) ? v : v ? [v] : []));
  const urls = list.map((v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.url || v.link || v.href : '')).map((v) => String(v || '').trim())
    .filter((v) => /^https?:\/\/\S+$/i.test(v) && v.length <= 2000);
  return [...new Set(urls)].slice(0, 10);
}

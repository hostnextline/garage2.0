// Runs every server function of supabase/functions/<name>/handler.ts on one port (8011): /<name> → its handler.
const root = new URL('../../supabase/functions/', import.meta.url);
const handlers = new Map<string, (req: Request) => Response | Promise<Response>>();
for await (const e of Deno.readDir(root)) {
  if (!e.isDirectory || e.name.startsWith('_')) continue;
  try {
    const m = await import(new URL(`${e.name}/handler.ts`, root).href);
    if (typeof m.handler === 'function') handlers.set(e.name, m.handler);
  } catch (err) { console.error('could not load', e.name, err); }
}
console.log('functions:', [...handlers.keys()].join(', ') || '(none)');
Deno.serve({ hostname: '127.0.0.1', port: 8011 }, (req) => {
  const u = new URL(req.url);
  const name = u.pathname.split('/').filter(Boolean)[0] || '';
  const h = handlers.get(name);
  if (!h) return new Response(JSON.stringify({ error: 'no function ' + name }), { status: 404, headers: { 'content-type': 'application/json' } });
  return h(req);
});

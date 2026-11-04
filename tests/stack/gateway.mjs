// Local stand-in for the Supabase front door (port 54331): /auth/v1 → Auth, /rest/v1 → PostgREST,
// /functions/v1 → the garage's functions (Deno). Same CORS and key handling as the real one.
import http from 'node:http';

const ROUTES = [
  ['/auth/v1', 9997],
  ['/rest/v1', 3011],
  ['/functions/v1', 8011]
];
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile, x-upsert, x-supabase-api-version',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS, HEAD',
  'access-control-expose-headers': 'content-range, content-location, x-total-count'
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const route = ROUTES.find(([p]) => req.url === p || req.url.startsWith(p + '/') || req.url.startsWith(p + '?'));
  if (!route) { res.writeHead(404, { ...CORS, 'content-type': 'application/json' }); return res.end('{"message":"no route"}'); }
  const [prefix, port] = route;
  const headers = { ...req.headers };
  delete headers.host;
  // like the real gateway: the public key alone stands for the "anon" role
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url.slice(prefix.length) || '/', headers }, (r) => {
    const h = { ...r.headers, ...CORS };
    res.writeHead(r.statusCode || 502, h);
    r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502, { ...CORS, 'content-type': 'application/json' }); res.end(JSON.stringify({ message: 'upstream down: ' + e.message })); });
  req.pipe(up);
}).listen(54331, '127.0.0.1', () => console.log('gateway on http://127.0.0.1:54331'));

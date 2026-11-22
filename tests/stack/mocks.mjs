// Fake outside services for the tests (port 8021): GoHighLevel, Stripe, TomTom, OSRM, NHTSA vPIC, Hermes. They answer like the real
// ones and keep a log of every call (GET /log, POST /log/clear) so the tests can check what would have been sent.
// Maps (« Vraies routes »): TomTom's routing (« Je pars ») and Matrix v2 (the planner's times: POST /tomtom/routing/matrix/2,
// at most 100 cells, HTTP 200 even when a cell fails, each cell its own `detailedError`), OSRM's route and table. Their times
// follow one made-up road (roadKm below) and differ on purpose from the planner's straight-line estimate, between TomTom's
// three hours (11 h 30, 8 h ×1.5, 17 h ×1.8: read in `departAt`), and between the two directions of a trip (+2 min going
// north), so a test can tell which one was used. Each Matrix request is logged { svc: 'tomtom', kind: 'matrix', origins,
// destinations, cells, departAt, traffic, inflight (requests being answered at that moment, this one included) }; each OSRM
// table { svc: 'osrm', kind: 'table', points, sources, destinations, cells }.
// GET /control?tomtom=ok|fail|refuse|busy|noroad|cells: TomTom answers, or 503, 403 (the key refused), 429, « no road » for
// every cell (HTTP 200, NO_ROUTE_FOUND), or every Matrix cell failed with TomTom's own trouble (HTTP 200,
// COMPUTATION_TIMEOUT: not « no road », nothing usable). ?osrm=ok|fail (503). ?tomtom_ms=N: each TomTom answer after N ms.
// ?noroad=lat,lng[;lat,lng…]: no road to or from those places (100 m), for TomTom AND OSRM (an island); ?noroad= clears.
// A TomTom key other than « tt-test » is refused (403), like a key revoked.
// GET /control?ghl=fail makes GoHighLevel refuse the next messages; ?ghl=ok puts it back.
// GET /control?stripe=refunds makes Stripe's list of refunds answer 500, ?stripe=all every Stripe call; ?stripe=refuse makes
// Stripe refuse the key (401, as for a key revoked or mistyped); ?stripe=ok puts it back.
// GET /control?ghl_ms=N makes every GoHighLevel call answer after N ms (0: at once); a call the function gave up on (it closed
// the connection) is logged with `aborted: true` and does nothing; meanwhile each call is logged `ghl-arrived` when it comes.
// GET /control?ghl_msg_ms=N: only the text itself (POST /conversations/messages) answers after N ms (the contact at once):
// a text GoHighLevel took whose answer comes too late (« peut-être parti »); logged `ghl-arrived` at once, like ghl_ms.
// GET /control?ghl_fail=5145550101,4385550102: the texts to those numbers are refused (422 DND), the others go (a
// customer who answered STOP among the day's clients); ?ghl_fail= clears it.
// Stripe, as the real one behaves: a card page (Checkout session) is open, complete or expired (POST …/expire), and an
// expired one cannot be paid; the same Idempotency-Key gives back the answer saved the first time (the page as it was
// then), and with other parameters is refused (400 idempotency_error);
// « charge.refunded » carries the charge WITHOUT the list of its refunds (they are read with GET /v1/refunds).
// Each secret key is its own Stripe account: a card page is seen (listed, read, expired) only with the key that made it, and
// it carries `created` (seconds); the list takes created[gte|gt|lte|lt] like Stripe. So what one test file leaves here is
// never in another file's list when that file uses a key of its own. Lists (card pages, refunds) come newest first, a page at
// a time like Stripe's: `limit` (1 to 100, 10 when not said), `starting_after` (the id of the last object of the page before),
// `has_more`.
//   GET /pay/<session>[?twice=1][&replay=1][&quiet=1] the customer pays (twice: two notices; replay: the same notice again;
//                                                     quiet: Stripe's notice never comes)
//   GET /age/<session>?hours=N                       the page was made N hours ago (its `created`)
//   GET /complete/<session>                          paid with a slow means (a bank debit): complete, not paid yet
//   GET /debit-failed/<session>                      that slow payment failed (the bank refused the debit): the page stays
//                                                    complete and unpaid, its payment goes back to requires_payment_method
// A page that is not open has no `url` (null), like Stripe's. GET /v1/payment_intents/<id> gives the payment behind a page
// (its `status`: requires_payment_method while open, processing for a slow means on its way, succeeded, canceled).
//   GET /refund/<session>[?amount=][&status=pending][&twice=1]   the garage gives money back from Stripe's own screens
//   GET /refund-update/<refund>?status=succeeded|failed          Stripe says what became of a refund
import http from 'node:http';
import { createHmac, generateKeyPairSync, createSign } from 'node:crypto';

const log = [];
// GitHub's OIDC tickets (backups): a key pair made at start; /github/jwks gives the public key like GitHub does,
// /github/token?repository=…&aud=… gives a ticket signed like GitHub's (the tests ask for good and bad ones)
const gh = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ghJwk = { ...gh.publicKey.export({ format: 'jwk' }), kid: 'test-kid', use: 'sig', alg: 'RS256' };
const b64u = (b) => Buffer.from(b).toString('base64url');
function ghToken({ repository = 'hostnextline/garage2.0-sauvegardes', aud = 'garage2.0-backup', exp = 300, iss = 'https://token.actions.githubusercontent.com', kid = 'test-kid', repository_id, repository_owner_id } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  // the repository's numbers (GitHub's tickets carry them) only when the test gives them
  const ids = { ...(repository_id ? { repository_id: String(repository_id) } : {}), ...(repository_owner_id ? { repository_owner_id: String(repository_owner_id) } : {}) };
  const body = b64u(JSON.stringify({ iss, aud, repository, ...ids, sub: `repo:${repository}:ref:refs/heads/main`, iat: now, nbf: now - 5, exp: now + Number(exp) }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(gh.privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const state = { ghl: 'ok', ghlMs: 0, ghlMsgMs: 0, ghlFail: [], stripe: 'ok', sessions: new Map(), refunds: [], idem: new Map(), hook: null, n: 0, chats: new Map(),
  tomtom: 'ok', tomtomMs: 0, osrm: 'ok', osrmBackup: 'ok', noroad: [], ttIn: 0 };
// ---- the made-up road of the map services ----
/** km of road between two points (the straight line × 1.25, about Montréal's latitude) */
const roadKm = (a, b) => Math.hypot((b.lng - a.lng) * 78, (b.lat - a.lat) * 111) * 1.25;
/** TomTom's seconds: 4 min to get going + 110 s a km, +2 min going north; × 1.5 at 8 h, × 1.8 at 17 h */
const ttSeconds = (a, b, at = '') => Math.round((240 + roadKm(a, b) * 110 + (b.lat > a.lat ? 120 : 0)) * (/T08:/.test(at) ? 1.5 : /T17:/.test(at) ? 1.8 : 1));
/** OSRM's seconds: 32 km/h, no traffic (the same as its /route answer) */
const osrmSeconds = (a, b) => (roadKm(a, b) / 32) * 3600;
const near = (p, q) => Math.abs(p.lat - q.lat) < 0.001 && Math.abs(p.lng - q.lng) < 0.001;
const island = (a, b) => state.noroad.some((x) => near(x, a) || near(x, b));
/** a road by the streets from (x1, y1) to (x2, y2) ([lng, lat]), without its first point: along the first street (east or
    west) to the corner, then along the second (north or south), a point every 1/40 of each street */
const streets = (x1, y1, x2, y2) => {
  const along = (ax, ay, bx, by) => Array.from({ length: 40 }, (_, i) => [ax + ((bx - ax) * (i + 1)) / 40, ay + ((by - ay) * (i + 1)) / 40]);
  return [...along(x1, y1, x2, y1), ...along(x2, y1, x2, y2)];
};
const chat = (cid) => { if (!state.chats.has(cid)) state.chats.set(cid, []); return state.chats.get(cid); };
const send = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
/** one page of a Stripe list (`all` newest first), as Stripe answers it: limit, starting_after, has_more */
function listPage(res, u, all, url) {
  const asked = u.searchParams.has('limit') ? Number(u.searchParams.get('limit')) : 10;
  if (!Number.isInteger(asked) || asked < 1 || asked > 100) return send(res, 400, { error: { type: 'invalid_request_error', param: 'limit', message: 'This value must be greater than or equal to 1 and less than or equal to 100.' } });
  const after = u.searchParams.get('starting_after');
  let from = 0;
  if (after) {
    const i = all.findIndex((x) => x.id === after);
    if (i < 0) return send(res, 400, { error: { type: 'invalid_request_error', param: 'starting_after', message: `No such object: '${after}'` } });
    from = i + 1;
  }
  return send(res, 200, { object: 'list', url, has_more: from + asked < all.length, data: all.slice(from, from + asked) });
}
/** newest first by `created` (seconds), then the one made last */
const newestFirst = (list) => list.map((x, i) => [x, i]).sort((a, b) => (b[0].created || 0) - (a[0].created || 0) || b[1] - a[1]).map(([x]) => x);
const formParse = (s) => { const o = {}; for (const p of s.split('&').filter(Boolean)) { const [k, v = ''] = p.split('='); o[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } return o; };

/** a signed notice to the garage's own function, as Stripe sends it */
async function stripeHook(object, type = 'checkout.session.completed', id = 'evt_' + (++state.n)) {
  if (!state.hook) return;
  const event = { id, object: 'event', api_version: '2024-06-20', type, data: { object } };
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', state.hook.secret).update(`${t}.${raw}`).digest('hex');
  const r = await fetch('http://127.0.0.1:54331/functions/v1/stripe', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}`, 'content-type': 'application/json' }, body: raw });
  const body = await r.text();
  log.push({ svc: 'stripe-webhook', status: r.status, event: event.id, type, body });
  return { raw, t, sig, status: r.status, id: event.id, body };
}
/** the charge of a paid card page, as « charge.refunded » carries it since Stripe's version 2022-11-15: no `refunds` */
const chargeOf = (s) => ({ id: 'ch_' + s.id, object: 'charge', payment_intent: s.payment_intent, amount: s.amount_total, currency: 'cad', status: 'succeeded',
  amount_refunded: state.refunds.filter((r) => r.payment_intent === s.payment_intent && r.status === 'succeeded').reduce((n, r) => n + r.amount, 0),
  refunded: false, metadata: {} });

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const raw = await readBody(req);
  const p = u.pathname;
  if (p === '/log') return send(res, 200, log);
  if (p === '/log/clear') { log.length = 0; return send(res, 200, { ok: true }); }
  if (p === '/control') {
    if (u.searchParams.get('ghl')) state.ghl = u.searchParams.get('ghl');
    if (u.searchParams.get('stripe')) state.stripe = u.searchParams.get('stripe');
    if (u.searchParams.has('ghl_ms')) state.ghlMs = Math.max(0, Number(u.searchParams.get('ghl_ms')) || 0);
    if (u.searchParams.has('ghl_msg_ms')) state.ghlMsgMs = Math.max(0, Number(u.searchParams.get('ghl_msg_ms')) || 0);
    if (u.searchParams.has('ghl_fail')) state.ghlFail = (u.searchParams.get('ghl_fail') || '').split(',').map((x) => x.replace(/\D/g, '')).filter(Boolean);
    if (u.searchParams.get('tomtom')) state.tomtom = u.searchParams.get('tomtom');
    if (u.searchParams.get('osrm')) state.osrm = u.searchParams.get('osrm');
    if (u.searchParams.get('osrm_backup')) state.osrmBackup = u.searchParams.get('osrm_backup');
    if (u.searchParams.has('tomtom_ms')) state.tomtomMs = Math.max(0, Number(u.searchParams.get('tomtom_ms')) || 0);
    if (u.searchParams.has('noroad')) state.noroad = (u.searchParams.get('noroad') || '').split(';').filter(Boolean).map((x) => { const [lat, lng] = x.split(',').map(Number); return { lat, lng }; });
    return send(res, 200, { ghl: state.ghl, ghl_ms: state.ghlMs, ghl_msg_ms: state.ghlMsgMs, ghl_fail: state.ghlFail, stripe: state.stripe, tomtom: state.tomtom, tomtom_ms: state.tomtomMs, osrm: state.osrm, osrm_backup: state.osrmBackup, noroad: state.noroad });
  }

  // ---- a phone maker's notification service (Web Push): 201 = taken; /push/gone = that device no longer wants them ----
  if (p.startsWith('/push/')) {
    log.push({ svc: 'push', path: p.slice(5), auth: req.headers.authorization, encoding: req.headers['content-encoding'], ttl: req.headers.ttl, bytes: Buffer.byteLength(raw || '') });
    return send(res, p === '/push/gone' ? 410 : 201, {});
  }

  // ---- GoHighLevel ----
  if (p.startsWith('/ghl/')) {
    const body = raw ? JSON.parse(raw) : {};
    // a slow GoHighLevel: every call (ghl_ms), or only the text itself (ghl_msg_ms)
    const wait = p === '/ghl/_reply' ? 0 : p === '/ghl/conversations/messages' && req.method === 'POST' && state.ghlMsgMs ? state.ghlMsgMs : state.ghlMs;
    if (wait) {
      // the answer comes after the wait; a call given up meanwhile (connection closed) does nothing.
      // What arrived is logged at once (`ghl-arrived`): a test sees which calls were started, even before they end
      log.push({ svc: 'ghl-arrived', path: p.slice(4), ...(p === '/ghl/conversations/messages' ? { contact: body.contactId } : {}) });
      let gone = false;
      res.on('close', () => { if (!res.writableEnded) gone = true; });
      await new Promise((r) => setTimeout(r, wait));
      if (gone || res.destroyed) { log.push({ svc: 'ghl', path: p.slice(4), aborted: true, body }); return; }
    }
    log.push({ svc: 'ghl', path: p.slice(4), version: req.headers.version, auth: req.headers.authorization, body });
    if (!/^Bearer pit-/.test(req.headers.authorization || '')) return send(res, 401, { message: 'Invalid token' });
    if (p === '/ghl/contacts/upsert') return send(res, 200, { contact: { id: 'ct_' + (body.phone || body.email || 'x').replace(/\W/g, '') } });
    if (p === '/ghl/conversations/messages' && req.method === 'POST') {
      if (state.ghl === 'fail' || state.ghlFail.some((d) => String(body.contactId || '').endsWith(d))) return send(res, 422, { message: 'Contact is in DND' });
      const id = 'msg_' + (++state.n);
      if (body.type === 'SMS') chat(body.contactId).push({ id, direction: 'outbound', body: body.message, messageType: 'TYPE_SMS', status: 'delivered', dateAdded: new Date(Date.now() + state.n).toISOString() });
      return send(res, 200, { messageId: id, conversationId: 'cv_' + body.contactId });
    }
    // reading a conversation: the contact by its number, its conversation, the messages (an answer of the customer included)
    if (p === '/ghl/contacts/search/duplicate') {
      const n = (u.searchParams.get('number') || '').replace(/\W/g, '');
      return send(res, 200, { contact: state.chats.has('ct_' + n) ? { id: 'ct_' + n } : null });
    }
    if (p === '/ghl/conversations/search') {
      const cid = u.searchParams.get('contactId');
      return send(res, 200, { conversations: state.chats.has(cid) ? [{ id: 'cv_' + cid, contactId: cid }] : [], total: state.chats.has(cid) ? 1 : 0 });
    }
    const cm = /^\/ghl\/conversations\/cv_([^/]+)\/messages$/.exec(p);
    if (cm && req.method === 'GET') {
      const list = (state.chats.get(cm[1]) || []).slice().reverse();
      return send(res, 200, { messages: { lastMessageId: list[0]?.id || null, nextPage: false, messages: list } });
    }
    // the customer answers (the tests): POST /ghl/_reply { contactId, body, attachments? }
    if (p === '/ghl/_reply') { chat(body.contactId).push({ id: 'msg_' + (++state.n), direction: 'inbound', body: body.body || '', attachments: body.attachments || [], messageType: 'TYPE_SMS', dateAdded: new Date(Date.now() + state.n).toISOString() }); return send(res, 200, { ok: true }); }
    return send(res, 404, { message: 'no route' });
  }

  // ---- Stripe ----
  if (p.startsWith('/stripe/')) {
    const f = formParse(raw);
    log.push({ svc: 'stripe', method: req.method, path: p.slice(7), form: f, version: req.headers['stripe-version'], idem: req.headers['idempotency-key'] });
    if (!/^Bearer (sk|rk)_(test|live)_/.test(req.headers.authorization || '')) return send(res, 401, { error: { message: 'Invalid API Key' } });
    if (state.stripe === 'refuse') return send(res, 401, { error: { type: 'invalid_request_error', message: 'Invalid API Key provided: sk_test_****' } });
    if (p === '/stripe/v1/webhook_endpoints' && req.method === 'POST') { state.hook = { id: 'we_' + (++state.n), secret: 'whsec_test_' + state.n, url: f.url }; return send(res, 200, state.hook); }
    if (p.startsWith('/stripe/v1/webhook_endpoints/') && req.method === 'DELETE') return send(res, 200, { deleted: true });
    if (state.stripe === 'all' || (state.stripe === 'refunds' && p === '/stripe/v1/refunds')) return send(res, 500, { error: { type: 'api_error', message: 'An unknown error occurred' } });
    const account = String(req.headers.authorization).slice(7);   // the key = the account (see the top of this file)
    const mine = (s) => s && s.account === account ? s : undefined;
    if (p === '/stripe/v1/checkout/sessions' && req.method === 'POST') {
      // the same key again: the same answer for the same request, a refusal for another one (as Stripe does)
      const idem = req.headers['idempotency-key'];
      if (idem && state.idem.has(idem)) {
        const was = state.idem.get(idem);
        if (was.raw !== raw) return send(res, 400, { error: { type: 'idempotency_error', message: 'Keys for idempotent requests can only be used with the same parameters they were first used with.' } });
        // the answer saved the first time (the page as it was then, even if it was closed or paid since), like Stripe
        res.setHeader('idempotent-replayed', 'true');
        return send(res, 200, JSON.parse(was.answer));
      }
      const id = 'cs_test_' + (++state.n);
      const md = {}; for (const [k, v] of Object.entries(f)) { const m = /^metadata\[(\w+)\]$/.exec(k); if (m && v !== '') md[m[1]] = v; }
      const s = { id, object: 'checkout.session', created: Math.floor(Date.now() / 1000), url: `http://127.0.0.1:8021/pay/${id}`, status: 'open', payment_status: 'unpaid',
        amount_total: Number(f['line_items[0][price_data][unit_amount]']), currency: 'cad', metadata: md, success_url: f.success_url, cancel_url: f.cancel_url,
        expires_at: Number(f.expires_at) || Math.floor(Date.now() / 1000) + 86400, payment_intent: 'pi_' + id };
      Object.defineProperty(s, 'account', { value: account, enumerable: false });   // kept here, never in the answer
      state.sessions.set(id, s);
      if (idem) state.idem.set(idem, { raw, answer: JSON.stringify(s) });
      return send(res, 200, s);
    }
    // the card pages of the account (GET /v1/checkout/sessions?payment_intent=…&created[gte]=…), newest first, as Stripe lists them
    if (p === '/stripe/v1/checkout/sessions' && req.method === 'GET') {
      const pi = u.searchParams.get('payment_intent');
      const when = (op) => (u.searchParams.has(`created[${op}]`) ? Number(u.searchParams.get(`created[${op}]`)) : null);
      const [gte, gt, lte, lt] = ['gte', 'gt', 'lte', 'lt'].map(when);
      const data = [...state.sessions.values()].filter((s) => mine(s) && (!pi || s.payment_intent === pi)
        && (gte == null || s.created >= gte) && (gt == null || s.created > gt) && (lte == null || s.created <= lte) && (lt == null || s.created < lt));
      return listPage(res, u, newestFirst(data), '/v1/checkout/sessions');
    }
    const x = /^\/stripe\/v1\/checkout\/sessions\/([\w-]+)\/expire$/.exec(p);
    if (x && req.method === 'POST') {
      const s = mine(state.sessions.get(x[1]));
      if (!s) return send(res, 404, { error: { type: 'invalid_request_error', message: 'No such checkout.session' } });
      if (s.status !== 'open') return send(res, 400, { error: { type: 'invalid_request_error', message: 'Only Checkout Sessions with a status in ["open"] can be expired.' } });
      s.status = 'expired'; s.url = null;
      return send(res, 200, s);
    }
    const m = /^\/stripe\/v1\/checkout\/sessions\/([\w-]+)$/.exec(p);
    if (m && req.method === 'GET') { const s = mine(state.sessions.get(m[1])); return s ? send(res, 200, s) : send(res, 404, { error: { type: 'invalid_request_error', message: 'No such checkout.session' } }); }
    // the payment behind a card page of the account
    const pim = /^\/stripe\/v1\/payment_intents\/([\w-]+)$/.exec(p);
    if (pim && req.method === 'GET') {
      const s = [...state.sessions.values()].find((x) => mine(x) && x.payment_intent === pim[1]);
      if (!s) return send(res, 404, { error: { type: 'invalid_request_error', message: `No such payment_intent: '${pim[1]}'` } });
      const status = s.payment_status === 'paid' ? 'succeeded' : s.status === 'open' ? 'requires_payment_method' : s.status === 'expired' ? 'canceled' : (s.pi_status || 'processing');
      return send(res, 200, { id: s.payment_intent, object: 'payment_intent', amount: s.amount_total, currency: 'cad', status });
    }
    // the refunds of a payment (newest first, like Stripe)
    if (p === '/stripe/v1/refunds' && req.method === 'GET') {
      const pi = u.searchParams.get('payment_intent');
      return listPage(res, u, newestFirst(state.refunds.filter((r) => r.payment_intent === pi)), '/v1/refunds');
    }
    return send(res, 404, { error: { message: 'no route' } });
  }
  // the customer "pays" on the fake Stripe page: the session is paid and the signed notice goes to the garage
  if (p.startsWith('/stripe/pay/') || p.startsWith('/pay/')) {
    const id = p.split('/').pop();
    const s = state.sessions.get(id);
    if (!s) return send(res, 404, { error: 'no session' });
    if (s.status === 'expired') return send(res, 410, { error: 'expired' });      // a closed page cannot be paid any more
    s.status = 'complete'; s.payment_status = 'paid'; s.url = null;
    if (u.searchParams.get('quiet')) return send(res, 200, { ok: true, hook: null });   // the notice is late or lost
    const h = await stripeHook(s);
    if (u.searchParams.get('twice')) await stripeHook(s);                                         // a second notice about the same page
    if (u.searchParams.get('replay')) await stripeHook(s, 'checkout.session.completed', h?.id);   // the very same notice again
    return send(res, 200, { ok: true, hook: h?.status, result: h?.body });
  }
  // the customer finished the card page with a slow means of payment (a bank debit): complete, not paid yet
  if (p.startsWith('/complete/')) {
    const s = state.sessions.get(p.split('/').pop());
    if (!s || s.status !== 'open') return send(res, 404, { error: 'not open' });
    s.status = 'complete'; s.payment_status = 'unpaid'; s.url = null;
    return send(res, 200, { ok: true });
  }
  // that slow payment failed: the page stays complete and unpaid (as at Stripe), its payment can no longer pass
  if (p.startsWith('/debit-failed/')) {
    const s = state.sessions.get(p.split('/').pop());
    if (!s || s.status !== 'complete' || s.payment_status === 'paid') return send(res, 404, { error: 'not on its way' });
    Object.defineProperty(s, 'pi_status', { value: 'requires_payment_method', enumerable: false, writable: true, configurable: true });
    return send(res, 200, { ok: true });
  }
  // a card page made N hours ago (GET /age/<session>?hours=N): the tests' way to have pages older than a check's window
  if (p.startsWith('/age/')) {
    const s = state.sessions.get(p.split('/').pop());
    if (!s) return send(res, 404, { error: 'no session' });
    s.created = Math.floor(Date.now() / 1000) - Math.round(Number(u.searchParams.get('hours') || 0) * 3600);
    return send(res, 200, { ok: true, created: s.created });
  }
  // the garage gives money back (all or part) from Stripe's own screens: the signed « charge.refunded » notice goes to
  // the garage — the charge, WITHOUT its refunds; ?status=pending: a refund still on its way
  if (p.startsWith('/refund/')) {
    const id = p.split('/').pop();
    const s = state.sessions.get(id);
    if (!s || s.payment_status !== 'paid') return send(res, 404, { error: 'not paid' });
    const refund = { id: 're_' + (++state.n) + 'test', object: 'refund', amount: Number(u.searchParams.get('amount')) || s.amount_total, currency: 'cad',
      charge: 'ch_' + s.id, payment_intent: s.payment_intent, status: u.searchParams.get('status') || 'succeeded', created: Math.floor(Date.now() / 1000) };
    state.refunds.push(refund);
    const h = await stripeHook(chargeOf(s), 'charge.refunded');
    if (u.searchParams.get('twice')) await stripeHook(chargeOf(s), 'charge.refunded');             // a second notice about the same refund
    return send(res, 200, { ok: true, hook: h?.status, result: h?.body, refund: refund.id, event: h?.id });
  }
  // Stripe says what became of a refund (« charge.refund.updated » carries the refund itself)
  if (p.startsWith('/refund-update/')) {
    const refund = state.refunds.find((r) => r.id === p.split('/').pop());
    if (!refund) return send(res, 404, { error: 'no refund' });
    refund.status = u.searchParams.get('status') || 'succeeded';
    const h = await stripeHook(refund, 'charge.refund.updated');
    return send(res, 200, { ok: true, hook: h?.status, result: h?.body });
  }

  // ---- GitHub OIDC ----
  if (p === '/github/jwks') return send(res, 200, { keys: [ghJwk] });
  if (p === '/github/token') { const o = Object.fromEntries(u.searchParams); if (o.audience) o.aud = o.audience; delete o.audience; return send(res, 200, { value: ghToken(o) }); }

  // ---- TomTom (the server's key « tt-test ») ----
  if (p.startsWith('/tomtom/')) {
    const refuse = u.searchParams.get('key') !== 'tt-test' || state.tomtom === 'refuse';
    // the routing of « Je pars »: GET /tomtom/routing/1/calculateRoute/<lat,lng:lat,lng>/json
    const rm = /^\/tomtom\/routing\/1\/calculateRoute\/([^/]+)\/json$/.exec(p);
    if (rm) {
      const [a, b] = rm[1].split(':').map((x) => { const [lat, lng] = x.split(',').map(Number); return { lat, lng }; });
      log.push({ svc: 'tomtom', kind: 'route', pts: [[a.lat, a.lng], [b.lat, b.lng]], departAt: u.searchParams.get('departAt'), representation: u.searchParams.get('routeRepresentation') });
      if (refuse) return send(res, 403, { detailedError: { code: 'Forbidden', message: 'You are not allowed to access this endpoint' } });
      if (state.tomtom === 'fail') return send(res, 503, { detailedError: { code: 'ServiceUnavailable' } });
      if (state.tomtom === 'busy') return send(res, 429, { detailedError: { code: 'TooManyRequests' } });
      if (state.tomtom === 'noroad' || island(a, b)) return send(res, 400, { detailedError: { code: 'NO_ROUTE_FOUND', message: 'No route found.' } });
      const km = roadKm(a, b);
      // the road in full, as TomTom's polyline gives it: by the streets, like OSRM's full road below (east or west
      // first, a corner, then north or south), a point every 1/40 of each street
      const points = [[a.lat, a.lng], ...streets(a.lng, a.lat, b.lng, b.lat).map(([x, y]) => [y, x])].map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
      return send(res, 200, { routes: [{ summary: { lengthInMeters: Math.round(km * 1000), travelTimeInSeconds: ttSeconds(a, b) }, legs: [{ points }] }] });
    }
    // Matrix v2, synchronous: POST /tomtom/routing/matrix/2 { origins, destinations, options }
    if (p === '/tomtom/routing/matrix/2' && req.method === 'POST') {
      state.ttIn++;
      try {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch { /* checked below */ }
        const pt = (x) => ({ lat: Number(x?.point?.latitude), lng: Number(x?.point?.longitude) });
        const os = Array.isArray(body.origins) ? body.origins.map(pt) : [], ds = Array.isArray(body.destinations) ? body.destinations.map(pt) : [];
        const o = body.options || {};
        log.push({ svc: 'tomtom', kind: 'matrix', origins: os.length, destinations: ds.length, cells: os.length * ds.length, departAt: o.departAt, traffic: o.traffic,
          inflight: state.ttIn, from: os.map((x) => [x.lat, x.lng]), to: ds.map((x) => [x.lat, x.lng]) });
        if (state.tomtomMs) await new Promise((r) => setTimeout(r, state.tomtomMs));
        if (refuse) return send(res, 403, { detailedError: { code: 'Forbidden', message: 'You are not allowed to access this endpoint' } });
        if (state.tomtom === 'fail') return send(res, 503, { detailedError: { code: 'ServiceUnavailable' } });
        if (state.tomtom === 'busy') return send(res, 429, { detailedError: { code: 'TooManyRequests' } });
        // as TomTom: no cell, more than 100 cells, a departure with an offset, or no historical traffic → 400
        if (!os.length || !ds.length || os.length * ds.length > 100 || [...os, ...ds].some((x) => !Number.isFinite(x.lat) || !Number.isFinite(x.lng))) return send(res, 400, { detailedError: { code: 'BAD_REQUEST', message: 'origins × destinations: 1 to 100 cells' } });
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(String(o.departAt || '')) || o.traffic !== 'historical') return send(res, 400, { detailedError: { code: 'BAD_REQUEST', message: 'departAt / traffic' } });
        const data = [];
        os.forEach((a, oi) => ds.forEach((b, di) => {
          if (state.tomtom === 'cells') data.push({ originIndex: oi, destinationIndex: di, detailedError: { code: 'COMPUTATION_TIMEOUT', message: 'Computation timed out.' } });
          else if (state.tomtom === 'noroad' || island(a, b)) data.push({ originIndex: oi, destinationIndex: di, detailedError: { code: 'NO_ROUTE_FOUND', message: 'No route found.' } });
          else data.push({ originIndex: oi, destinationIndex: di, routeSummary: { lengthInMeters: Math.round(roadKm(a, b) * 1000), travelTimeInSeconds: ttSeconds(a, b, o.departAt),
            trafficDelayInSeconds: 0, departureTime: o.departAt, arrivalTime: o.departAt } });
        }));
        return send(res, 200, { data, statistics: { totalCount: data.length, successes: data.filter((x) => x.routeSummary).length, failures: data.filter((x) => !x.routeSummary).length } });
      } finally { state.ttIn--; }
    }
    return send(res, 404, { detailedError: { code: 'NOT_FOUND' } });
  }
  // ---- OSRM, and its second server (« <OSRM_BASE>-backup »: the FOSSGIS copy on live) ----
  // GET /control?osrm=fail makes the first planner answer 503 (a page that is not JSON; its table too, for « drive »),
  // ?osrm_backup=fail the second; =ok puts each back. An address of ?noroad=: no road (code NoRoute).
  for (const [prefix, svc, key] of [['/osrm/route/v1/driving/', 'osrm', 'osrm'], ['/osrm-backup/route/v1/driving/', 'osrm-backup', 'osrmBackup']]) {
    if (!p.startsWith(prefix)) continue;
    const pts = p.split('/').pop().split(';').map((x) => x.split(',').map(Number));
    const [[x1, y1], [x2, y2]] = pts;
    const km = Math.hypot((x2 - x1) * 78, (y2 - y1) * 111) * 1.25;
    const overview = u.searchParams.get('overview') || 'simplified';
    const failed = state[key] === 'fail';
    log.push({ svc, kind: 'route', pts, overview, ...(failed ? { failed: true } : {}) });
    if (failed) { res.writeHead(503, { 'content-type': 'text/html' }); return res.end('<html><body>503 Service Unavailable</body></html>'); }
    if (island({ lat: y1, lng: x1 }, { lat: y2, lng: x2 })) return send(res, 200, { code: 'NoRoute', routes: [] });
    // the road in full, as the real planner gives it: by the streets (east or west first, a corner, then north or
    // south), a point every 1/40 of each street. « simplified »: the planner's rough line, which cuts the corner.
    const coordinates = overview === 'full' ? [[x1, y1], ...streets(x1, y1, x2, y2)] : [[x1, y1], [(x1 + x2) / 2, (y1 + y2) / 2], [x2, y2]];
    return send(res, 200, { code: 'Ok', routes: [{ distance: km * 1000, duration: (km / 32) * 3600, geometry: { coordinates } }] });
  }
  // the table: GET /osrm/table/v1/driving/<lng,lat;…>?sources=i;j&destinations=k;l&annotations=duration,distance
  if (p.startsWith('/osrm/table/v1/driving/')) {
    const points = decodeURIComponent(p.split('/').pop()).split(';').map((x) => { const [lng, lat] = x.split(',').map(Number); return { lat, lng }; });
    const idx = (name) => (u.searchParams.get(name) ? u.searchParams.get(name).split(';').map(Number) : points.map((_, i) => i));
    const src = idx('sources'), dst = idx('destinations');
    log.push({ svc: 'osrm', kind: 'table', points: points.length, sources: src.length, destinations: dst.length, cells: src.length * dst.length });
    if (state.osrm === 'fail') return send(res, 503, { code: 'Error', message: 'down' });
    if (points.length > 100 || [...src, ...dst].some((i) => !points[i])) return send(res, 400, { code: 'TooBig', message: 'Too many table coordinates' });
    const cell = (f) => src.map((i) => dst.map((j) => (island(points[i], points[j]) ? null : f(points[i], points[j]))));
    return send(res, 200, { code: 'Ok', durations: cell(osrmSeconds), distances: cell((a, b) => roadKm(a, b) * 1000) });
  }
  // ---- Hermes (the owner's assistant, OpenAI-compatible): answers « Réponse à : <the last question> » ----
  if (p === '/hermes/v1/chat/completions' && req.method === 'POST') {
    const body = raw ? JSON.parse(raw) : {};
    log.push({ svc: 'hermes', auth: req.headers.authorization, session: req.headers['x-hermes-session-id'] || null, body });
    if (req.headers.authorization !== 'Bearer hk-test') return send(res, 401, { error: { message: 'Invalid API key' } });
    const last = [...(body.messages || [])].reverse().find((m) => m.role === 'user');
    return send(res, 200, { id: 'chatcmpl-' + (++state.n), object: 'chat.completion', model: body.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Réponse à : ' + (last?.content || '') } }] });
  }
  // ---- NHTSA vPIC ----
  if (p.startsWith('/vpic/api/vehicles/DecodeVinValues/')) {
    const vin = p.split('/').pop();
    log.push({ svc: 'vpic', vin });
    if (vin === '1HGCM82633A004352') return send(res, 200, { Results: [{ ModelYear: '2003', Make: 'HONDA', Model: 'Accord', Trim: 'EX', DisplacementL: '2.998', EngineCylinders: '6', FuelTypePrimary: 'Gasoline', DriveType: 'FWD/Front-Wheel Drive', ErrorCode: '0', BodyClass: 'Coupe' }] });
    return send(res, 200, { Results: [{ ErrorCode: '8', ErrorText: 'No detailed data available currently' }] });
  }
  send(res, 404, { message: 'no route' });
}).listen(8021, '127.0.0.1', () => console.log('mocks on 8021'));

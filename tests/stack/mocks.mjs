// Fake outside services for the tests (port 8021): GoHighLevel, Stripe, OSRM, NHTSA vPIC, Hermes. They answer like the real ones
// and keep a log of every call (GET /log, POST /log/clear) so the tests can check what would have been sent.
// GET /control?ghl=fail makes GoHighLevel refuse the next messages; ?ghl=ok puts it back.
// GET /control?stripe=refunds makes Stripe's list of refunds answer 500, ?stripe=all every Stripe call; ?stripe=refuse makes
// Stripe refuse the key (401, as for a key revoked or mistyped); ?stripe=ok puts it back.
// GET /control?ghl_ms=N makes every GoHighLevel call answer after N ms (0: at once); a call the function gave up on (it closed
// the connection) is logged with `aborted: true` and does nothing; meanwhile each call is logged `ghl-arrived` when it comes.
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
const state = { ghl: 'ok', ghlMs: 0, stripe: 'ok', sessions: new Map(), refunds: [], idem: new Map(), hook: null, n: 0, chats: new Map() };
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
    return send(res, 200, { ghl: state.ghl, ghl_ms: state.ghlMs, stripe: state.stripe });
  }

  // ---- a phone maker's notification service (Web Push): 201 = taken; /push/gone = that device no longer wants them ----
  if (p.startsWith('/push/')) {
    log.push({ svc: 'push', path: p.slice(5), auth: req.headers.authorization, encoding: req.headers['content-encoding'], ttl: req.headers.ttl, bytes: Buffer.byteLength(raw || '') });
    return send(res, p === '/push/gone' ? 410 : 201, {});
  }

  // ---- GoHighLevel ----
  if (p.startsWith('/ghl/')) {
    const body = raw ? JSON.parse(raw) : {};
    if (state.ghlMs && p !== '/ghl/_reply') {
      // a slow GoHighLevel: the answer comes after ghl_ms; a call given up meanwhile (connection closed) does nothing.
      // What arrived is logged at once (`ghl-arrived`): a test sees which calls were started, even before they end
      log.push({ svc: 'ghl-arrived', path: p.slice(4) });
      let gone = false;
      res.on('close', () => { if (!res.writableEnded) gone = true; });
      await new Promise((r) => setTimeout(r, state.ghlMs));
      if (gone || res.destroyed) { log.push({ svc: 'ghl', path: p.slice(4), aborted: true, body }); return; }
    }
    log.push({ svc: 'ghl', path: p.slice(4), version: req.headers.version, auth: req.headers.authorization, body });
    if (!/^Bearer pit-/.test(req.headers.authorization || '')) return send(res, 401, { message: 'Invalid token' });
    if (p === '/ghl/contacts/upsert') return send(res, 200, { contact: { id: 'ct_' + (body.phone || body.email || 'x').replace(/\W/g, '') } });
    if (p === '/ghl/conversations/messages' && req.method === 'POST') {
      if (state.ghl === 'fail') return send(res, 422, { message: 'Contact is in DND' });
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

  // ---- OSRM ----
  if (p.startsWith('/osrm/route/v1/driving/')) {
    const pts = p.split('/').pop().split(';').map((x) => x.split(',').map(Number));
    const [[x1, y1], [x2, y2]] = pts;
    const km = Math.hypot((x2 - x1) * 78, (y2 - y1) * 111) * 1.25;
    const overview = u.searchParams.get('overview') || 'simplified';
    log.push({ svc: 'osrm', pts, overview });
    // the road in full, as the real planner gives it: by the streets (east or west first, a corner, then north or
    // south), a point every 1/40 of each street. « simplified »: the planner's rough line, which cuts the corner.
    const along = (ax, ay, bx, by) => Array.from({ length: 40 }, (_, i) => [ax + ((bx - ax) * (i + 1)) / 40, ay + ((by - ay) * (i + 1)) / 40]);
    const coordinates = overview === 'full' ? [[x1, y1], ...along(x1, y1, x2, y1), ...along(x2, y1, x2, y2)] : [[x1, y1], [(x1 + x2) / 2, (y1 + y2) / 2], [x2, y2]];
    return send(res, 200, { code: 'Ok', routes: [{ distance: km * 1000, duration: (km / 32) * 3600, geometry: { coordinates } }] });
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

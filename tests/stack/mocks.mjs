// Fake outside services for the tests (port 8021): GoHighLevel, Stripe, OSRM, NHTSA vPIC, Hermes. They answer like the real ones
// and keep a log of every call (GET /log, POST /log/clear) so the tests can check what would have been sent.
// GET /control?ghl=fail makes GoHighLevel refuse the next messages; ?ghl=ok puts it back.
import http from 'node:http';
import { createHmac, generateKeyPairSync, createSign } from 'node:crypto';

const log = [];
// GitHub's OIDC tickets (backups): a key pair made at start; /github/jwks gives the public key like GitHub does,
// /github/token?repository=…&aud=… gives a ticket signed like GitHub's (the tests ask for good and bad ones)
const gh = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ghJwk = { ...gh.publicKey.export({ format: 'jwk' }), kid: 'test-kid', use: 'sig', alg: 'RS256' };
const b64u = (b) => Buffer.from(b).toString('base64url');
function ghToken({ repository = 'hostnextline/garage2.0-sauvegardes', aud = 'garage2.0-backup', exp = 300, iss = 'https://token.actions.githubusercontent.com', kid = 'test-kid' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const body = b64u(JSON.stringify({ iss, aud, repository, sub: `repo:${repository}:ref:refs/heads/main`, iat: now, nbf: now - 5, exp: now + Number(exp) }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(gh.privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const state = { ghl: 'ok', sessions: new Map(), hook: null, n: 0, chats: new Map() };
const chat = (cid) => { if (!state.chats.has(cid)) state.chats.set(cid, []); return state.chats.get(cid); };
const send = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
const formParse = (s) => { const o = {}; for (const p of s.split('&').filter(Boolean)) { const [k, v = ''] = p.split('='); o[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } return o; };

async function stripeHook(session, type = 'checkout.session.completed', object = session) {
  if (!state.hook) return;
  const event = { id: 'evt_' + (++state.n), type, data: { object } };
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', state.hook.secret).update(`${t}.${raw}`).digest('hex');
  const r = await fetch('http://127.0.0.1:54331/functions/v1/stripe', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}`, 'content-type': 'application/json' }, body: raw });
  log.push({ svc: 'stripe-webhook', status: r.status, event: event.id, body: await r.text() });
  return { raw, t, sig, status: r.status };
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const raw = await readBody(req);
  const p = u.pathname;
  if (p === '/log') return send(res, 200, log);
  if (p === '/log/clear') { log.length = 0; return send(res, 200, { ok: true }); }
  if (p === '/control') { if (u.searchParams.get('ghl')) state.ghl = u.searchParams.get('ghl'); return send(res, 200, state.ghl); }

  // ---- GoHighLevel ----
  if (p.startsWith('/ghl/')) {
    const body = raw ? JSON.parse(raw) : {};
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
    // the customer answers (the tests): POST /ghl/_reply { contactId, body }
    if (p === '/ghl/_reply') { chat(body.contactId).push({ id: 'msg_' + (++state.n), direction: 'inbound', body: body.body, messageType: 'TYPE_SMS', dateAdded: new Date(Date.now() + state.n).toISOString() }); return send(res, 200, { ok: true }); }
    return send(res, 404, { message: 'no route' });
  }

  // ---- Stripe ----
  if (p.startsWith('/stripe/')) {
    const f = formParse(raw);
    log.push({ svc: 'stripe', method: req.method, path: p.slice(7), form: f, version: req.headers['stripe-version'], idem: req.headers['idempotency-key'] });
    if (!/^Bearer (sk|rk)_(test|live)_/.test(req.headers.authorization || '')) return send(res, 401, { error: { message: 'Invalid API Key' } });
    if (p === '/stripe/v1/webhook_endpoints' && req.method === 'POST') { state.hook = { id: 'we_' + (++state.n), secret: 'whsec_test_' + state.n, url: f.url }; return send(res, 200, state.hook); }
    if (p.startsWith('/stripe/v1/webhook_endpoints/') && req.method === 'DELETE') return send(res, 200, { deleted: true });
    if (p === '/stripe/v1/checkout/sessions' && req.method === 'POST') {
      const id = 'cs_test_' + (++state.n);
      const md = {}; for (const [k, v] of Object.entries(f)) { const m = /^metadata\[(\w+)\]$/.exec(k); if (m) md[m[1]] = v; }
      const s = { id, object: 'checkout.session', url: `http://127.0.0.1:8021/pay/${id}`, status: 'open', payment_status: 'unpaid',
        amount_total: Number(f['line_items[0][price_data][unit_amount]']), currency: 'cad', metadata: md, success_url: f.success_url, cancel_url: f.cancel_url, payment_intent: 'pi_' + id };
      state.sessions.set(id, s);
      return send(res, 200, s);
    }
    const m = /^\/stripe\/v1\/checkout\/sessions\/([\w-]+)$/.exec(p);
    if (m && req.method === 'GET') { const s = state.sessions.get(m[1]); return s ? send(res, 200, s) : send(res, 404, { error: { message: 'No such session' } }); }
    const x = /^\/stripe\/v1\/checkout\/sessions\/([\w-]+)\/expire$/.exec(p);
    if (x && req.method === 'POST') {
      const s = state.sessions.get(x[1]);
      if (!s) return send(res, 404, { error: { message: 'No such session' } });
      if (s.status !== 'open') return send(res, 400, { error: { message: 'Session is not open' } });
      s.status = 'expired';
      return send(res, 200, s);
    }
    return send(res, 404, { error: { message: 'no route' } });
  }
  // the customer "pays" on the fake Stripe page: the session is paid and the signed notice goes to the garage
  if (p.startsWith('/stripe/pay/') || p.startsWith('/pay/')) {
    const id = p.split('/').pop();
    const s = state.sessions.get(id);
    if (!s) return send(res, 404, { error: 'no session' });
    if (s.status === 'expired') return send(res, 410, { error: 'expired' });   // a closed page cannot be paid any more
    s.status = 'complete'; s.payment_status = 'paid';
    const h = await stripeHook(s);
    if (u.searchParams.get('twice')) await stripeHook(s);
    return send(res, 200, { ok: true, hook: h?.status });
  }
  // the garage refunds (all or part) from the Stripe dashboard: the signed « charge.refunded » notice goes to the garage
  if (p.startsWith('/refund/')) {
    const id = p.split('/').pop();
    const s = state.sessions.get(id);
    if (!s || s.payment_status !== 'paid') return send(res, 404, { error: 'not paid' });
    const amount = Number(u.searchParams.get('amount')) || s.amount_total;
    s.refunded = (s.refunded || 0) + amount;
    const charge = { id: 'ch_' + id, object: 'charge', payment_intent: s.payment_intent, amount: s.amount_total, amount_refunded: s.refunded, currency: 'cad',
      refunds: { data: [{ id: 're_' + (++state.n), object: 'refund', amount, payment_intent: s.payment_intent, status: 'succeeded' }] } };
    const h = await stripeHook(s, 'charge.refunded', charge);
    if (u.searchParams.get('twice')) await stripeHook(s, 'charge.refunded', charge);
    return send(res, 200, { ok: true, hook: h?.status, refund: charge.refunds.data[0].id });
  }

  // ---- GitHub OIDC ----
  if (p === '/github/jwks') return send(res, 200, { keys: [ghJwk] });
  if (p === '/github/token') { const o = Object.fromEntries(u.searchParams); if (o.audience) o.aud = o.audience; delete o.audience; return send(res, 200, { value: ghToken(o) }); }

  // ---- OSRM ----
  if (p.startsWith('/osrm/route/v1/driving/')) {
    const pts = p.split('/').pop().split(';').map((x) => x.split(',').map(Number));
    const [[x1, y1], [x2, y2]] = pts;
    const km = Math.hypot((x2 - x1) * 78, (y2 - y1) * 111) * 1.25;
    log.push({ svc: 'osrm', pts });
    return send(res, 200, { code: 'Ok', routes: [{ distance: km * 1000, duration: (km / 32) * 3600, geometry: { coordinates: [[x1, y1], [(x1 + x2) / 2, (y1 + y2) / 2], [x2, y2]] } }] });
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

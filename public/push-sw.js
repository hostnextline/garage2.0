/* The alert while the app is closed (« Texto entrant »): the server sends { title, body, tag }; a tap opens the app,
   where the conversation bubble is waiting. Loaded by the app's service worker (vite.config.ts, workbox.importScripts).
   Plain JavaScript run by the phone's worker, no build step: a phone keeps this file until its app updates, so every
   addition here is one an old app ignores (a message it does not listen to), and the app never needs it.
   - A tap on a text's alert with the app already open: the app comes to the front and that number's conversation opens
     (message « his-texto-open », the number read from the tag « texto-<number> » the server already sends) (comms-guide-14).
   - The maker's notification service changed this device's address (« pushsubscriptionchange »): the worker asks for the new
     one with the same key, so the device still has an address; the app gives it back to the server the next time it opens
     (features/conversation/pushRepair.ts), the worker having no session to do it itself (comms-guide-08). */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  const tag = d.tag || 'texto';
  const m = /^texto-(.+)$/.exec(tag);
  event.waitUntil(self.registration.showNotification(d.title || 'Mécanique Mobile H.I.S', {
    body: d.body || '', tag: tag, renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    data: { url: self.registration.scope, phone: m ? m[1] : null }
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || self.registration.scope;
  const phone = typeof data.phone === 'string' && data.phone ? data.phone : null;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.indexOf(self.registration.scope) === 0 && c.url.indexOf('client.html') < 0);
    if (!open) return self.clients.openWindow(url);
    // the conversation is asked even when focus() is refused (some browsers): the window is there all the same
    try { if (phone) open.postMessage({ type: 'his-texto-open', phone: phone }); } catch (e) { /* an old window */ }
    return open.focus().catch(() => undefined);
  }));
});
self.addEventListener('pushsubscriptionchange', (event) => {
  const old = event.oldSubscription || null;
  const key = old && old.options ? old.options.applicationServerKey : null;
  event.waitUntil((async () => {
    // a browser that already made the new address gives it here; else one is asked with the garage's key
    if (event.newSubscription) return;
    if (!key) return;
    const had = await self.registration.pushManager.getSubscription();
    if (had) return;
    await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  })().catch(() => undefined));
});

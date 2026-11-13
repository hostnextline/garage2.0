/* The alert while the app is closed (« Texto entrant »): the server sends { title, body, tag }; a tap opens the app,
   where the conversation bubble is waiting. Loaded by the app's service worker (vite.config.ts, workbox.importScripts). */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Mécanique Mobile H.I.S', {
    body: d.body || '', tag: d.tag || 'texto', renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: self.registration.scope }
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.indexOf(self.registration.scope) === 0 && c.url.indexOf('client.html') < 0);
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});

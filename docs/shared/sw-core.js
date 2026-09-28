// Service Worker: получает push от сервера и показывает системное уведомление, даже если приложение закрыто.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  // На iPhone каждый push обязан показать уведомление — иначе Safari отзовёт подписку
  e.waitUntil(self.registration.showNotification(d.title || 'Приёмка', {
    body: d.body || '', tag: d.tag, renotify: !!d.tag, lang: 'ru',
    icon: new URL('../icons/icon-192.png', self.registration.scope).href,
    data: { url: new URL(d.url || './', self.registration.scope).href },
  }));
});

// Нажатие на уведомление — открыть приложение (или переключиться на уже открытое)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  })());
});

// Service Worker for Claude Code Remote notifications

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

// Handle notification clicks - focus app and switch to session
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { sessionId } = event.notification.data || {};

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing window
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus().then((focusedClient) => {
            focusedClient.postMessage({ type: 'switch-session', sessionId });
            return focusedClient;
          });
        }
      }
      // No existing window - open a new one
      return clients.openWindow('/');
    })
  );
});

// Handle messages from main thread to show notifications
self.addEventListener('message', (event) => {
  if (event.data.type === 'show-notification') {
    const { title, body, sessionId, tag } = event.data;
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      data: { sessionId },
      requireInteraction: true,
      vibrate: [100, 50, 100],
    });
  }
});

// Minimal service worker: lets Android Chrome (and installed home-screen apps)
// show notifications, and focuses the chat when one is tapped. No caching.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((w) => w.url === url) || windows[0];
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    }),
  );
});

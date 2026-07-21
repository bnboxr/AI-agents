/**
 * HSMC Pay Service Worker
 *
 * Provides:
 * - Offline support: cached shell + network-first
 * - PWA installation capability
 * - Background sync for pending payments (future)
 */

const CACHE_NAME = "hsmc-pay-v1";
const STATIC_ASSETS = ["/pay-pwa", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_ASSETS).catch((err) =>
        console.warn("[SW] Cache addAll error:", err)
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === "navigate") return caches.match("/pay-pwa");
          return new Response("Offline — please connect to internet", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          });
        })
      )
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-pending-payments") {
    event.waitUntil(
      (async () => {
        console.log("[SW] Syncing pending payments...");
      })()
    );
  }
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};
  const options = {
    body: data.body || "Payment update",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "payment",
    data: data,
    vibrate: [200, 100, 200],
  };
  event.waitUntil(self.registration.showNotification(data.title || "HSMC Pay", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/pay-pwa";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

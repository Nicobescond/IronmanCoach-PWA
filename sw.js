// Service worker : met en cache l'application (pas les donnees) pour
// l'ouvrir hors ligne. Changer VERSION a chaque publication.
const VERSION = "ic-pwa-1.1.0";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./demo.js", "./config.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Supabase et tout autre domaine : toujours le reseau, jamais le cache.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // Application : reseau d'abord (mises a jour immediates), cache si hors ligne.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});

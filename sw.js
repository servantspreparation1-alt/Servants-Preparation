/* =====================================================================
   اعداد خدام ادمن — Service Worker
   • بيخلي التطبيق يفتح بدون إنترنت بعد أول زيارة.
   • ملفات HTML: network-first (علشان التحديثات تظهر بسرعة مع fallback).
   • أصول ثابتة (صور/css/js): cache-first.
   ===================================================================== */
const VERSION = "e3dad-v3.3.0";
const SHELL = [
  "./",
  "index.html",
  "admin.html",
  "شهادة-التخرج.html",
  "manifest.json",
  "assets/css/app.css",
  "assets/css/login.css",
  "assets/js/core.js",
  "assets/js/owner.js",
  "assets/img/logo-512.png",
  "assets/img/logo-192.png",
  "assets/img/church-hero.jpg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "imagekit-upload.js",
  "cloud-sync.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) =>
      Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;
  if (req.url.includes("/api/")) return; /* توقيعات الرفع لحظية — لا تُخزَّن */
  const isDoc = req.mode === "navigate" || /\.html?($|\?)/.test(req.url);

  if (isDoc) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("index.html")))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit)
    )
  );
});

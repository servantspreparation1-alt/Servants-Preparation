/* إعداد خدام للتلمذة — Service Worker v6.4 — نسخة الدخول الجديد (Firebase Auth) (الشبكة أولاً + دعم العمل بدون إنترنت بعد أول فتح) */
var CACHE = 'e3-sw-v11-auth-2026-10';
var SHELL = ['./', './index.html', './admin.html', './manifest.json', './icons/logo-192.png', './icons/logo-384.png', './icons/logo-512.png', './icons/logo-maskable-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.allSettled(SHELL.map(function (u) {
        return fetch(u, { cache: 'reload' }).then(function (res) {
          if (res && res.ok) return cache.put(u, res.clone());
        });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (!req || req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (_err) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* لا تتدخل في اتصالات قاعدة البيانات اللحظية لـ Firebase */
  var host = url.hostname.toLowerCase();
  if (
    host.indexOf('firebasedatabase.app') > -1 ||
    host.indexOf('firebaseio.com') > -1 ||
    host.indexOf('googleapis.com') > -1
  ) {
    return;
  }

  var sameOrigin = url.origin === self.location.origin;
  var staticCdn = (
    host.indexOf('gstatic.com') > -1 ||
    host.indexOf('fonts.googleapis.com') > -1
  );
  if (!sameOrigin && !staticCdn) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && (res.status === 200 || res.type === 'opaque')) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.open(CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          if (sameOrigin) {
            return cache.match(req, { ignoreSearch: true }).then(function (cleanHit) {
              if (cleanHit) return cleanHit;
              if (req.mode === 'navigate') return cache.match('./index.html');
              return Response.error();
            });
          }
          return Response.error();
        });
      });
    })
  );
});

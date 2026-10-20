/* إعداد خدام — سيرفيس ووركر خفيف: شرط التثبيت على الموبايل (بدون كاش — البيانات على Firebase) */
var V = 'e3-sw-v1';
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) { /* مرور عادي — الشبكة هي المصدر */ });

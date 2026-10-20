const CACHE='e3dad-public-v8';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
// v8 deliberately does not cache authenticated pages/data or API responses.
self.addEventListener('fetch',()=>{});

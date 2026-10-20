const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const name of ['index.html','admin.html','setup.html'])test('syntax: '+name,()=>{const html=fs.readFileSync('public/'+name,'utf8');for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);});
for(const name of ['secure-client.js','setup.js','sw.js'])test('syntax: '+name,()=>new vm.Script(fs.readFileSync('public/'+name,'utf8')));
test('manifest icons exist',()=>{const x=JSON.parse(fs.readFileSync('public/manifest.json'));for(const icon of x.icons)assert(fs.existsSync('public/'+icon.src));});
test('no public frontend reads legacy accounts or state',()=>{const a=fs.readFileSync('public/admin.html','utf8'),i=fs.readFileSync('public/index.html','utf8');assert(!/\.ref\(['"]ekhdam/.test(a+i));assert(!/fetchUsersWithOfflineFallback/.test(i));assert(!/fbUsersRef\.child/.test(a));});
test('service account variable absent from public application scripts',()=>{for(const n of ['index.html','admin.html','secure-client.js'])assert(!fs.readFileSync('public/'+n,'utf8').includes('FIREBASE_SERVICE_ACCOUNT_JSON'));});

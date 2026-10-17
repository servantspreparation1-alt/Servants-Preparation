/* ============================================================
   Firebase sync for E3dad Khoddam
   User records are stored at /ekhdam/users/<USERNAME> as native objects.
   Other app data keeps its existing rec/ and val/ layout.
============================================================ */
(function(){
'use strict';
var DB_URL='https://servantspreparation1-773ce-default-rtdb.europe-west1.firebasedatabase.app';
var ROOT='ekhdam';
var cfg={dbKey:'e3dad_khoddam_db_v1',badge:false,auto:true,onRemote:null};
var busy=false,again=false,pushTimer=null,retryTimer=null,badgeEl=null;
var rewrite={},legacyDeletes=[];

function rootUrl(){return DB_URL+'/'+ROOT+'.json'}
function signal(ms){var c=new AbortController();setTimeout(function(){c.abort()},ms||10000);return c.signal}
function parseVal(x){try{return JSON.parse(x)}catch(e){return x}}
function toArr(x){
  if(Array.isArray(x))return x.slice();
  if(x&&typeof x==='object')return Object.keys(x).map(function(k){return x[k]});
  if(typeof x==='string'){var p=parseVal(x);if(Array.isArray(p))return p;if(p&&typeof p==='object')return Object.keys(p).map(function(k){return p[k]})}
  return [];
}
function stableId(username){return 'id'+String(username||'user').toLowerCase().replace(/[^a-z0-9_-]/g,'_').slice(0,60)}
function userKey(username){return String(username||'').trim().toUpperCase().replace(/\./g,'%2E')}
function userNameFromKey(key){return String(key||'').replace(/%2E/gi,'.').toLowerCase()}
function isValidFirebaseKey(k){return typeof k==='string'&&k.length>0&&k.length<=700&&!/[.$#\[\]\/]/.test(k)}
function fallbackHash(pw,salt){var txt=(salt||'')+'::'+pw,h1=0xdeadbeef,h2=0x41c6ce57;for(var i=0;i<txt.length;i++){var c=txt.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}return 'fb'+(h1>>>0).toString(16)+(h2>>>0).toString(16)}
async function hashPassword(pw,salt){var txt=(salt||'')+'::'+pw;try{if(window.crypto&&crypto.subtle){var buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(txt));return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0')}).join('')}}catch(e){}return fallbackHash(pw,salt)}
function canon(v){
  if(Array.isArray(v))return '['+v.map(canon).join(',')+']';
  if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+':'+canon(v[k])}).join(',')+'}';
  return JSON.stringify(v);
}
function hash(s){var h=5381;for(var i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return (h>>>0).toString(36)+'.'+s.length.toString(36)}
function getSnap(){try{return JSON.parse(localStorage.getItem(cfg.dbKey+'_snap')||'null')}catch(e){return null}}
function setSnap(o){try{localStorage.setItem(cfg.dbKey+'_snap',JSON.stringify(o))}catch(e){}}
function isColl(v){return Array.isArray(v)&&v.length>0&&v.every(function(x){return x&&typeof x==='object'&&typeof x.id==='string'&&isValidFirebaseKey(x.id)})}
function asUserList(users){
  if(Array.isArray(users))return users;
  if(users&&typeof users==='object')return Object.keys(users).map(function(k){var x=users[k];if(x&&typeof x==='object'&&!Array.isArray(x))return Object.assign({id:x.id||k},x);return x});
  return [];
}
function toCloudUser(u){
  var username=String(u.username||'').trim().toLowerCase();
  return {
    addedAt:String(u.createdAt||u.addedAt||''),
    disabled:u.active===false||u.disabled===true,
    name:String(u.displayName||u.name||username),
    passHash:String(u.passHash||u.passwordHash||''),
    permissions:toArr(u.permissions),
    phone:String(u.phone||''),
    photoUrl:String(u.photo||u.photoUrl||''),
    role:String(u.role||'follower'),
    scopeYears:toArr(u.scopeYears),
    lastLogin:String(u.lastLogin||''),
    id:String(u.id||stableId(username))
  };
}
function fromCloudUser(c,key){
  var username=userNameFromKey(key);
  return {
    id:String(c.id||stableId(username)),
    username:username,
    displayName:String(c.name||username),
    createdAt:String(c.addedAt||''),
    lastLogin:String(c.lastLogin||''),
    passHash:String(c.passHash||''),
    permissions:toArr(c.permissions),
    scopeYears:toArr(c.scopeYears),
    phone:String(c.phone||''),
    photo:String(c.photoUrl||''),
    role:String(c.role||'follower'),
    active:c.disabled!==true
  };
}
async function normalizeCloudUser(raw,key){
  var x=typeof raw==='string'?parseVal(raw):raw;
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  var username=String(x.username||userNameFromKey(key)||'').trim().toLowerCase();
  if(!username)return null;
  var passHash=String(x.passHash||x.passwordHash||'');
  // One-time conversion for the legacy plaintext schema: hash it, then rewrite
  // the record without ever preserving the plaintext field.
  if(x.password!==undefined&&String(x.password)!=='')passHash=await hashPassword(String(x.password),username);
  var active=typeof x.disabled==='boolean'?!x.disabled:x.active!==false;
  return {
    username:username,
    cloud:{
      addedAt:String(x.addedAt||x.createdAt||''),
      disabled:!active,
      name:String(x.name||x.displayName||username),
      passHash:passHash,
      permissions:toArr(x.permissions),
      phone:String(x.phone||''),
      photoUrl:String(x.photoUrl||x.photo||''),
      role:String(x.role||'follower'),
      scopeYears:toArr(x.scopeYears),
      lastLogin:String(x.lastLogin||''),
      id:String(x.id||stableId(username))
    }
  };
}
function cleanLocal(db){
  if(!db||typeof db!=='object')return db;
  db.users=asUserList(db.users).map(function(u){
    if(typeof u==='string')u=parseVal(u);
    if(!u||typeof u!=='object'||Array.isArray(u))return null;
    var v=Object.assign({},u),username=String(v.username||'').toLowerCase();
    // Older app versions already had passHash; if not, the app-level cleaner
    // adds a compatible fallback hash before this stage.
    if(!v.passHash&&v.password)v.passHash=fallbackHash(String(v.password),username);
    delete v.password;
    return v;
  }).filter(Boolean);
  return db;
}
function readLocal(){try{var d=JSON.parse(localStorage.getItem(cfg.dbKey)||'null');if(d){d=cleanLocal(d);localStorage.setItem(cfg.dbKey,JSON.stringify(d))}return d}catch(e){return null}}
function writeLocal(d){localStorage.setItem(cfg.dbKey,JSON.stringify(cleanLocal(d)))}
function flatten(db){
  var m={};db=cleanLocal(db||{});
  Object.keys(db||{}).forEach(function(k){
    var v=db[k];if(v===undefined)return;
    if(k==='users'){
      asUserList(v).forEach(function(u){if(!u||!u.username)return;var key=userKey(u.username);if(!isValidFirebaseKey(key))return;m['users/'+key]=canon(toCloudUser(u))});
    }else if(isColl(v))v.forEach(function(it){m['rec/'+k+'/'+it.id]=JSON.stringify(it)});
    else m['val/'+k]=JSON.stringify(v);
  });
  return m;
}
function build(map){
  var db={users:[]},colls={},users=[];
  Object.keys(map).forEach(function(p){
    var s=p.split('/');
    try{
      if(s[0]==='users'&&s.length===2){var c=parseVal(map[p]);if(c&&typeof c==='object'&&!Array.isArray(c))users.push(fromCloudUser(c,s[1]))}
      else if(s[0]==='val')db[s[1]]=parseVal(map[p]);
      else if(s[0]==='rec')(colls[s[1]]=colls[s[1]]||[]).push(parseVal(map[p]));
    }catch(e){}
  });
  db.users=users;
  Object.keys(colls).forEach(function(k){db[k]=colls[k]});
  return cleanLocal(db);
}
function hashes(map){var o={};Object.keys(map).forEach(function(p){o[p]=hash(map[p])});return o}
async function fetchRemote(ms){
  var r=await fetch(rootUrl(),{cache:'no-store',signal:signal(ms)});
  if(!r.ok)throw new Error('http '+r.status);
  var j=await r.json(),m={};rewrite={};legacyDeletes=[];
  if(!j)return m;
  var legacyUsers=j.rec&&j.rec.users?j.rec.users:{};
  // Migrate old rec/users/<id> rows into users/<USERNAME>.
  for(var oldId of Object.keys(legacyUsers)){
    var oldRaw=legacyUsers[oldId],normalized=await normalizeCloudUser(oldRaw,oldId);
    if(!normalized)continue;
    var newKey=userKey(normalized.username),path='users/'+newKey;
    if(m[path]===undefined)m[path]=canon(normalized.cloud);
    rewrite[path]=1;
    legacyDeletes.push('rec/users/'+oldId);
  }
  // Also migrate the very old val/users array/object form if present.
  if(j.val&&j.val.users!==undefined){
    var valUsers=parseVal(j.val.users),list=asUserList(valUsers);
    for(var i=0;i<list.length;i++){
      var vu=list[i];if(typeof vu==='string')vu=parseVal(vu);
      if(!vu||typeof vu!=='object')continue;
      var vn=await normalizeCloudUser(vu,vu.username||vu.id||('legacy'+i));if(!vn)continue;
      var vk=userKey(vn.username),vp='users/'+vk;
      if(m[vp]===undefined)m[vp]=canon(vn.cloud);
      rewrite[vp]=1;
    }
    legacyDeletes.push('val/users');
  }
  // The new canonical branch wins over any legacy copy with the same username.
  if(j.users&&typeof j.users==='object'){
    for(var key of Object.keys(j.users)){
      var raw=j.users[key],norm=await normalizeCloudUser(raw,key);
      if(!norm)continue;
      var canonicalKey=userKey(norm.username),p='users/'+canonicalKey,rawObject=typeof raw==='string'?parseVal(raw):raw;
      m[p]=canon(norm.cloud);
      if(typeof raw==='string'||!rawObject||canon(norm.cloud)!==canon(rawObject)||canonicalKey!==key){rewrite[p]=1;if(canonicalKey!==key)legacyDeletes.push('users/'+key)}
    }
  }
  // Other collections and values retain the existing app schema.
  if(j.rec)Object.keys(j.rec).forEach(function(k){if(k==='users')return;Object.keys(j.rec[k]||{}).forEach(function(id){var x=j.rec[k][id];m['rec/'+k+'/'+id]=typeof x==='string'?x:JSON.stringify(x)})});
  if(j.val)Object.keys(j.val).forEach(function(k){if(k!=='users')m['val/'+k]=typeof j.val[k]==='string'?j.val[k]:JSON.stringify(j.val[k])});
  legacyDeletes=Array.from(new Set(legacyDeletes));
  return m;
}
async function request(path,method,body,ms){
  var opt={method:method,headers:{'Content-Type':'application/json'},signal:signal(ms||20000)};
  if(body!==undefined)opt.body=JSON.stringify(body);
  var r=await fetch(path,opt);if(!r.ok)throw new Error('http '+r.status);
}
async function patch(obj,ms){
  var other={},userOps=[],delOps=[];
  Object.keys(obj).forEach(function(p){
    var q=p.split('/'),v=obj[p];
    if(q[0]==='users'&&q.length===2)userOps.push({key:q[1],value:v});
    else if(q[0]==='__legacyDelete__')delOps.push(q.slice(1).join('/'));
    else other[p]=v;
  });
  if(Object.keys(other).length)await request(rootUrl(),'PATCH',other,ms||20000);
  // Write user accounts directly as Firebase objects under /ekhdam/users/<key>.
  for(var op of userOps){
    if(!isValidFirebaseKey(op.key))throw new Error('invalid user key');
    var target=DB_URL+'/'+ROOT+'/users/'+encodeURIComponent(op.key)+'.json';
    if(op.value===null)await request(target,'DELETE',undefined,ms||20000);
    else{
      var value=typeof op.value==='string'?parseVal(op.value):op.value;
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid user object');
      delete value.password;
      await request(target,'PUT',value,ms||20000);
    }
  }
  // Remove previous copies only after their new username-keyed rows were written.
  for(var path of delOps){
    var bits=path.split('/').filter(Boolean),target2=DB_URL+'/'+ROOT+'/'+bits.map(encodeURIComponent).join('/')+'.json';
    await request(target2,'DELETE',undefined,ms||20000);
  }
}
function setBadge(state){
  if(!cfg.badge)return;
  if(!badgeEl){badgeEl=document.createElement('div');badgeEl.style.cssText='position:fixed;bottom:10px;left:10px;z-index:60;font:700 11px "Segoe UI",Tahoma,Arial;padding:5px 10px;border-radius:999px;background:rgba(255,253,248,.95);border:1px solid #e8dcc3;color:#6d5636;box-shadow:0 4px 14px rgba(75,32,20,.15);pointer-events:none;direction:rtl';document.body.appendChild(badgeEl)}
  var t={ok:'☁️ محفوظ على السحابة',busy:'⏳ جارٍ المزامنة…',off:'⚠️ مفيش اتصال — محفوظ على الجهاز وهيترفع لما النت يرجع'};
  badgeEl.textContent=t[state]||'';badgeEl.style.color=state==='off'?'#b3261e':'#6d5636';
}
async function sync(opt){
  opt=opt||{};if(busy)return {ok:false,busy:true};busy=true;setBadge('busy');
  try{
    var rm=await fetchRemote(opt.timeout),local=readLocal(),lm=local?flatten(local):{};
    var base=getSnap(),first=!base;if(first)base={};
    if(!Object.keys(rm).length&&Object.keys(base).length){base={};first=false}
    var all={};[rm,lm,base].forEach(function(o){Object.keys(o).forEach(function(p){all[p]=1})});
    var final={},push={},localChange=false;
    Object.keys(all).forEach(function(p){
      var r=rm[p]==null?undefined:rm[p],l=lm[p]==null?undefined:lm[p],bh=base[p];
      var rh=r===undefined?undefined:hash(r),lh=l===undefined?undefined:hash(l),lc=lh!==bh,rc=rh!==bh,f;
      if(lc&&!rc)f=l;else if(rc&&!lc)f=r;else if(lc&&rc)f=(lh===rh)?l:(first?r:l);else f=l;
      if(f!==undefined)final[p]=f;
      if(f!==r||(rewrite[p]&&f!==undefined))push[p]=f===undefined?null:f;
      if(f!==l)localChange=true;
    });
    legacyDeletes.forEach(function(path){push['__legacyDelete__/'+path]=null});
    if(Object.keys(push).length)await patch(push);
    if(localChange){if(first&&local){try{localStorage.setItem(cfg.dbKey+'_backup_before_cloud',JSON.stringify(local))}catch(e){}}writeLocal(build(final))}
    else if(local)writeLocal(local);
    setSnap(hashes(final));setBadge('ok');return {ok:true,changed:localChange};
  }catch(e){setBadge('off');scheduleRetry();return {ok:false,error:String(e&&e.message||e)}}
  finally{busy=false;if(again){again=false;queuePush()}}
}
async function pushNow(){if(busy){again=true;return}return sync()}
function queuePush(){clearTimeout(pushTimer);pushTimer=setTimeout(pushNow,1200)}
function scheduleRetry(){clearTimeout(retryTimer);retryTimer=setTimeout(function(){sync()},20000)}
function remoteChanged(res){if(res&&res.ok&&res.changed&&typeof cfg.onRemote==='function')cfg.onRemote()}
function init(opt){Object.keys(opt||{}).forEach(function(k){cfg[k]=opt[k]});if(!cfg.auto)return;sync().then(remoteChanged);window.addEventListener('online',function(){sync().then(remoteChanged)});document.addEventListener('visibilitychange',function(){if(!document.hidden)sync().then(remoteChanged)});setInterval(function(){if(!document.hidden&&navigator.onLine)sync().then(remoteChanged)},180000)}
window.E3Cloud={init:init,sync:sync,queuePush:queuePush};
})();

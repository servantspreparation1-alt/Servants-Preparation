/* ============================================================
   مزامنة سحابية — Firebase Realtime Database (REST، من غير مكتبات)
   - العناصر تحفظ منفصلة؛ المستخدمون يحفظون ككائنات Firebase ذات حقول مستقلة
   - ترحيل تلقائي للسجلات القديمة التي كانت JSON كنص
   - كلمات السر لا تحفظ كنص صريح؛ يحتفظ النظام ببصمة passHash فقط
============================================================ */
(function(){
'use strict';
var DB_URL='https://servantspreparation1-773ce-default-rtdb.europe-west1.firebasedatabase.app';
var ROOT='ekhdam';
var cfg={dbKey:'e3dad_khoddam_db_v1',badge:false,auto:true,onRemote:null};
var busy=false, again=false, pushTimer=null, retryTimer=null, badgeEl=null;
var NATIVE={users:1}, rewrite={};

function url(){return DB_URL+'/'+ROOT+'.json'}
function signal(ms){var c=new AbortController();setTimeout(function(){c.abort()},ms||10000);return c.signal}
function parseVal(x){try{return JSON.parse(x)}catch(e){return x}}
function toArr(x){
  if(Array.isArray(x))return x.slice();
  if(x&&typeof x==='object')return Object.keys(x).map(function(k){return x[k]});
  if(typeof x==='string'){var p=parseVal(x);if(Array.isArray(p))return p;if(p&&typeof p==='object')return Object.keys(p).map(function(k){return p[k]})}
  return [];
}
function normRec(coll,value,id){
  if(coll!=='users'||!value||typeof value!=='object'||Array.isArray(value))return value;
  var o=JSON.parse(JSON.stringify(value));
  if(id)o.id=id;
  o.permissions=toArr(o.permissions);
  o.scopeYears=toArr(o.scopeYears);
  // Never replicate readable passwords to Firebase or back to localStorage.
  if(Object.prototype.hasOwnProperty.call(o,'password'))delete o.password;
  return o;
}
function cleanLocal(db){
  if(!db||typeof db!=='object')return db;
  var list=db.users;
  if(!Array.isArray(list)){
    list=list&&typeof list==='object'?Object.keys(list).map(function(k){var v=list[k];if(v&&typeof v==='object'&&!Array.isArray(v))return Object.assign({id:k},v);return v}):[];
  }
  db.users=list.map(function(v){
    if(typeof v==='string')v=parseVal(v);
    return v&&typeof v==='object'&&!Array.isArray(v)?normRec('users',v,v.id):null;
  }).filter(Boolean);
  return db;
}
function readLocal(){
  try{
    var raw=localStorage.getItem(cfg.dbKey);if(!raw)return null;
    var db=cleanLocal(JSON.parse(raw));
    if(db)localStorage.setItem(cfg.dbKey,JSON.stringify(db));
    return db;
  }catch(e){return null}
}
function writeLocal(d){localStorage.setItem(cfg.dbKey,JSON.stringify(cleanLocal(d)))}
function hash(s){var h=5381;for(var i=0;i<s.length;i++){h=((h<<5)+h+s.charCodeAt(i))|0}return (h>>>0).toString(36)+'.'+s.length.toString(36)}
function getSnap(){try{return JSON.parse(localStorage.getItem(cfg.dbKey+'_snap')||'null')}catch(e){return null}}
function setSnap(o){try{localStorage.setItem(cfg.dbKey+'_snap',JSON.stringify(o))}catch(e){}}
function isColl(v){return Array.isArray(v)&&v.length>0&&v.every(function(x){return x&&typeof x==='object'&&typeof x.id==='string'&&/^[^.$#\[\]\/]+$/.test(x.id)})}
function canon(v){
  if(Array.isArray(v))return '['+v.map(canon).join(',')+']';
  if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+':'+canon(v[k])}).join(',')+'}';
  return JSON.stringify(v);
}
function flatten(db){
  var m={};db=cleanLocal(db||{});
  Object.keys(db||{}).forEach(function(k){
    var v=db[k];if(v===undefined)return;
    if(isColl(v))v.forEach(function(it){
      var item=NATIVE[k]?normRec(k,it,it.id):it;
      m['rec/'+k+'/'+it.id]=NATIVE[k]?canon(item):JSON.stringify(item);
    });
    else m['val/'+k]=JSON.stringify(v);
  });
  return m;
}
function build(map){
  var db={},colls={};
  Object.keys(map).forEach(function(p){
    var s=p.split('/');
    try{if(s[0]==='val')db[s[1]]=parseVal(map[p]);else if(s[0]==='rec')(colls[s[1]]=colls[s[1]]||[]).push(parseVal(map[p]))}catch(e){}
  });
  Object.keys(colls).forEach(function(k){db[k]=colls[k]});
  return cleanLocal(db);
}
function hashes(map){var o={};Object.keys(map).forEach(function(p){o[p]=hash(map[p])});return o}

async function fetchRemote(ms){
  var r=await fetch(url(),{cache:'no-store',signal:signal(ms)});
  if(!r.ok)throw new Error('http '+r.status);
  var j=await r.json(),m={};rewrite={};
  if(j){
    var str=function(x){return typeof x==='string'?x:JSON.stringify(x)};
    if(j.rec)Object.keys(j.rec).forEach(function(k){Object.keys(j.rec[k]||{}).forEach(function(id){
      var x=j.rec[k][id],p='rec/'+k+'/'+id;
      if(NATIVE[k]){
        var parsed=typeof x==='string'?parseVal(x):x;
        if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return;
        var normalized=normRec(k,parsed,id);
        if(typeof x==='string'||canon(normalized)!==canon(parsed))rewrite[p]=1;
        m[p]=canon(normalized);
      }else m[p]=str(x);
    })});
    if(j.val)Object.keys(j.val).forEach(function(k){m['val/'+k]=str(j.val[k])});
  }
  return m;
}
async function request(path,method,body,ms){
  var opt={method:method,headers:{'Content-Type':'application/json'},signal:signal(ms||20000)};
  if(body!==undefined)opt.body=JSON.stringify(body);
  var r=await fetch(path,opt);if(!r.ok)throw new Error('http '+r.status);
}
async function patch(obj,ms){
  var other={},users=[];
  Object.keys(obj).forEach(function(p){
    var q=p.split('/'),v=obj[p];
    if(q[0]==='rec'&&q[1]==='users'&&q.length===3){users.push({id:q[2],value:v});}
    else other[p]=v;
  });
  // Use a direct PUT per user: Firebase then stores a real JSON object at
  // rec/users/<id>, not a quoted JSON string. DELETE removes deleted accounts.
  if(Object.keys(other).length)await request(url(),'PATCH',other,ms||20000);
  for(var i=0;i<users.length;i++){
    var op=users[i],key=op.id;
    if(!/^[^.$#\[\]\/]+$/.test(key))throw new Error('invalid user key');
    var target=DB_URL+'/'+ROOT+'/rec/users/'+encodeURIComponent(key)+'.json';
    if(op.value===null)await request(target,'DELETE',undefined,ms||20000);
    else{
      var parsed=typeof op.value==='string'?parseVal(op.value):op.value;
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('invalid user record');
      await request(target,'PUT',normRec('users',parsed,key),ms||20000);
    }
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
      if(f!==r||(rewrite[p]&&f!==undefined))push[p]=(f===undefined?null:f);
      if(f!==l)localChange=true;
    });
    if(Object.keys(push).length)await patch(push);
    if(localChange){if(first&&local){try{localStorage.setItem(cfg.dbKey+'_backup_before_cloud',JSON.stringify(local))}catch(e){}}writeLocal(build(final))}
    else if(local)writeLocal(local); // also persist local credential cleanup
    setSnap(hashes(final));setBadge('ok');return {ok:true,changed:localChange};
  }catch(e){setBadge('off');scheduleRetry();return {ok:false,error:String(e&&e.message||e)}}
  finally{busy=false;if(again){again=false;queuePush()}}
}
async function pushNow(){
  if(busy){again=true;return}var local=readLocal();if(!local)return;
  var snap=getSnap();if(!snap)return sync();busy=true;setBadge('busy');
  try{
    var lm=flatten(local),upd={},nb=Object.assign({},snap);
    Object.keys(lm).forEach(function(p){var h=hash(lm[p]);if(snap[p]!==h){upd[p]=lm[p];nb[p]=h}});
    Object.keys(snap).forEach(function(p){if(!(p in lm)){upd[p]=null;delete nb[p]}});
    if(Object.keys(upd).length){await patch(upd);setSnap(nb)}setBadge('ok');
  }catch(e){setBadge('off');scheduleRetry()}
  finally{busy=false;if(again){again=false;queuePush()}}
}
function queuePush(){clearTimeout(pushTimer);pushTimer=setTimeout(pushNow,1200)}
function scheduleRetry(){clearTimeout(retryTimer);retryTimer=setTimeout(function(){sync()},20000)}
function remoteChanged(res){if(res&&res.ok&&res.changed&&typeof cfg.onRemote==='function')cfg.onRemote()}
function init(opt){
  Object.keys(opt||{}).forEach(function(k){cfg[k]=opt[k]});if(!cfg.auto)return;
  sync().then(remoteChanged);
  window.addEventListener('online',function(){sync().then(remoteChanged)});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)sync().then(remoteChanged)});
  setInterval(function(){if(!document.hidden&&navigator.onLine)sync().then(remoteChanged)},180000);
}
window.E3Cloud={init:init,sync:sync,queuePush:queuePush};
})();

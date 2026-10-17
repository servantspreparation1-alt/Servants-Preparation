/* ============================================================
   مزامنة سحابية — Firebase Realtime Database (REST، من غير مكتبات)
   - البيانات بتتحفظ على الجهاز زي الأول + نسخة على السحابة
   - كل عنصر (دارس / مستخدم / ...) بيتحفظ لوحده، فتعديل اتنين مختلفين مش بيتعارض
   - شغّال بدون نت: التعديلات بتستنى وبتتبعت لما النت يرجع
============================================================ */
(function(){
'use strict';
var DB_URL='https://servantspreparation1-default-rtdb.europe-west1.firebasedatabase.app';
var ROOT='e3dad_v1';
var cfg={dbKey:'e3dad_khoddam_db_v1',badge:false,auto:true,onRemote:null};
var busy=false, again=false, pushTimer=null, retryTimer=null, badgeEl=null;

function url(){return DB_URL+'/'+ROOT+'.json'}
function signal(ms){var c=new AbortController();setTimeout(function(){c.abort()},ms||10000);return c.signal}
function readLocal(){try{return JSON.parse(localStorage.getItem(cfg.dbKey)||'null')}catch(e){return null}}
function writeLocal(d){localStorage.setItem(cfg.dbKey,JSON.stringify(d))}
function hash(s){var h=5381;for(var i=0;i<s.length;i++){h=((h<<5)+h+s.charCodeAt(i))|0}return (h>>>0).toString(36)+'.'+s.length.toString(36)}
function getSnap(){try{return JSON.parse(localStorage.getItem(cfg.dbKey+'_snap')||'null')}catch(e){return null}}
function setSnap(o){try{localStorage.setItem(cfg.dbKey+'_snap',JSON.stringify(o))}catch(e){}}

/* مجموعة = مصفوفة عناصر كل واحد له id صالح كمفتاح */
function isColl(v){return Array.isArray(v)&&v.length>0&&v.every(function(x){return x&&typeof x==='object'&&typeof x.id==='string'&&/^[^.$#\[\]\/]+$/.test(x.id)})}
function flatten(db){
  var m={};
  Object.keys(db||{}).forEach(function(k){
    var v=db[k]; if(v===undefined)return;
    if(isColl(v)){v.forEach(function(it){m['c/'+k+'/'+it.id]=JSON.stringify(it)})}
    else{m['v/'+k]=JSON.stringify(v)}
  });
  return m;
}
function build(map){
  var db={},colls={};
  Object.keys(map).forEach(function(p){
    var s=p.split('/');
    try{
      if(s[0]==='v'){db[s[1]]=JSON.parse(map[p])}
      else if(s[0]==='c'){(colls[s[1]]=colls[s[1]]||[]).push(JSON.parse(map[p]))}
    }catch(e){}
  });
  Object.keys(colls).forEach(function(k){db[k]=colls[k]});
  return db;
}
function hashes(map){var o={};Object.keys(map).forEach(function(p){o[p]=hash(map[p])});return o}

async function fetchRemote(ms){
  var r=await fetch(url(),{cache:'no-store',signal:signal(ms)});
  if(!r.ok)throw new Error('http '+r.status);
  var j=await r.json(), m={};
  if(j){
    if(j.c)Object.keys(j.c).forEach(function(k){Object.keys(j.c[k]).forEach(function(id){m['c/'+k+'/'+id]=j.c[k][id]})});
    if(j.v)Object.keys(j.v).forEach(function(k){m['v/'+k]=j.v[k]});
  }
  return m;
}
async function patch(obj,ms){
  var r=await fetch(url(),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj),signal:signal(ms||20000)});
  if(!r.ok)throw new Error('http '+r.status);
}

function setBadge(state){
  if(!cfg.badge)return;
  if(!badgeEl){
    badgeEl=document.createElement('div');
    badgeEl.style.cssText='position:fixed;bottom:10px;left:10px;z-index:60;font:700 11px "Segoe UI",Tahoma,Arial;padding:5px 10px;border-radius:999px;background:rgba(255,253,248,.95);border:1px solid #e8dcc3;color:#6d5636;box-shadow:0 4px 14px rgba(75,32,20,.15);pointer-events:none;direction:rtl';
    document.body.appendChild(badgeEl);
  }
  var t={ok:'☁️ محفوظ على السحابة',busy:'⏳ جارٍ المزامنة…',off:'⚠️ مفيش اتصال — محفوظ على الجهاز وهيترفع لما النت يرجع'};
  badgeEl.textContent=t[state]||'';
  badgeEl.style.color=state==='off'?'#b3261e':'#6d5636';
}

/* مزامنة كاملة: دمج ثلاثي (المحلي / السحابة / آخر حالة متفق عليها) */
async function sync(opt){
  opt=opt||{};
  if(busy)return {ok:false,busy:true};
  busy=true; setBadge('busy');
  try{
    var rm=await fetchRemote(opt.timeout);
    var local=readLocal(), lm=local?flatten(local):{};
    var base=getSnap(), first=!base; if(first)base={};
    /* لو السحابة اتمسحت بالغلط وإحنا كنا متزامنين — نرجّعها من النسخة المحلية */
    if(!Object.keys(rm).length&&Object.keys(base).length){base={};first=false}
    var all={};
    [rm,lm,base].forEach(function(o){Object.keys(o).forEach(function(p){all[p]=1})});
    var final={},push={},localChange=false;
    Object.keys(all).forEach(function(p){
      var r=rm[p]==null?undefined:rm[p], l=lm[p]==null?undefined:lm[p], bh=base[p];
      var rh=r===undefined?undefined:hash(r), lh=l===undefined?undefined:hash(l);
      var lc=lh!==bh, rc=rh!==bh, f;
      if(lc&&!rc)f=l;
      else if(rc&&!lc)f=r;
      else if(lc&&rc)f=(lh===rh)?l:(first?r:l);
      else f=l;
      if(f!==undefined)final[p]=f;
      if(f!==r)push[p]=(f===undefined?null:f);
      if(f!==l)localChange=true;
    });
    if(Object.keys(push).length)await patch(push);
    if(localChange){
      if(first&&local){try{localStorage.setItem(cfg.dbKey+'_backup_before_cloud',JSON.stringify(local))}catch(e){}}
      writeLocal(build(final));
    }
    setSnap(hashes(final));
    setBadge('ok');
    return {ok:true,changed:localChange};
  }catch(e){
    setBadge('off'); scheduleRetry();
    return {ok:false,error:String(e&&e.message||e)};
  }finally{
    busy=false;
    if(again){again=false; queuePush()}
  }
}

/* رفع سريع للتعديلات المحلية بس (من غير تحميل السحابة) */
async function pushNow(){
  if(busy){again=true;return}
  var local=readLocal(); if(!local)return;
  var snap=getSnap();
  if(!snap){return sync()}
  busy=true; setBadge('busy');
  try{
    var lm=flatten(local), upd={}, nb=Object.assign({},snap);
    Object.keys(lm).forEach(function(p){var h=hash(lm[p]);if(snap[p]!==h){upd[p]=lm[p];nb[p]=h}});
    Object.keys(snap).forEach(function(p){if(!(p in lm)){upd[p]=null;delete nb[p]}});
    if(Object.keys(upd).length){await patch(upd); setSnap(nb)}
    setBadge('ok');
  }catch(e){setBadge('off'); scheduleRetry()}
  finally{busy=false; if(again){again=false; queuePush()}}
}
function queuePush(){clearTimeout(pushTimer); pushTimer=setTimeout(pushNow,1200)}
function scheduleRetry(){clearTimeout(retryTimer); retryTimer=setTimeout(function(){sync()},20000)}

function remoteChanged(res){if(res&&res.ok&&res.changed&&typeof cfg.onRemote==='function')cfg.onRemote()}

function init(opt){
  Object.keys(opt||{}).forEach(function(k){cfg[k]=opt[k]});
  if(!cfg.auto)return;
  sync().then(remoteChanged);
  window.addEventListener('online',function(){sync().then(remoteChanged)});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)sync().then(remoteChanged)});
  setInterval(function(){if(!document.hidden&&navigator.onLine)sync().then(remoteChanged)},180000);
}

window.E3Cloud={init:init,sync:sync,queuePush:queuePush};
})();

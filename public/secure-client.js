/* Browser client: no private key, service account or plaintext password cache. */
(function(){'use strict';
var config={apiKey:'AIzaSyBv2WM1ukqyY9VcfDKjb-5a4RlTXimeEss',authDomain:'servants-preparation-108f3.firebaseapp.com',databaseURL:'https://servants-preparation-108f3-default-rtdb.europe-west1.firebasedatabase.app',projectId:'servants-preparation-108f3'};
if(!firebase.apps.length)firebase.initializeApp(config);
var auth=firebase.auth(),database=firebase.database(),me=null,presenceRef=null,presenceConnection=null,timer=null,lastInteraction=Date.now(),sessionId=null,connected=false;
var ready=new Promise(function(resolve){var off=auth.onAuthStateChanged(function(u){off();resolve(u);});});
async function api(action,data,extra){var user=auth.currentUser,headers={'Content-Type':'application/json'};if(user)headers.Authorization='Bearer '+await user.getIdToken();if(extra)Object.assign(headers,extra);var control=new AbortController(),t=setTimeout(function(){control.abort();},25000);try{var r=await fetch('/api/secure',{method:'POST',headers:headers,body:JSON.stringify({action:action,data:data||{}}),cache:'no-store',signal:control.signal});var out=await r.json();if(!r.ok){var e=new Error(out.message||'فشل الطلب');e.code=out.error;e.status=r.status;throw e;}return out;}finally{clearTimeout(t);}}
var viewDetail={};
function page(){var h=location.hash.slice(1)||'students',q=[];if(viewDetail.level)q.push('level='+viewDetail.level);if(viewDetail.mode)q.push('mode='+viewDetail.mode);return (h+(q.length?'?'+q.join('&'):'')).slice(0,180);}
function state(){return document.hidden?'background':Date.now()-lastInteraction>120000?'idle':'active';}
function beat(){if(!presenceRef||!connected)return Promise.resolve();return presenceRef.update({page:page(),visibility:state(),lastSeen:firebase.database.ServerValue.TIMESTAMP}).catch(function(){});}
function clearPresence(){if(timer)clearInterval(timer);timer=null;if(presenceConnection){database.ref('.info/connected').off('value',presenceConnection);presenceConnection=null;}connected=false;}
function navigation(detail){if(!auth.currentUser||!sessionId)return;if(detail){Object.assign(viewDetail,detail);beat();}api('navigate',Object.assign({page:page()},viewDetail,detail||{})).catch(function(){});}
function startPresence(profile){
 if(sessionId)return;me=profile;sessionId=crypto.randomUUID();presenceRef=database.ref('v8Presence/'+profile.id+'/'+sessionId);
 presenceConnection=function(snap){connected=snap.val()===true;if(!connected)return;
  // Arm disconnect cleanup before publishing online, as recommended by Firebase.
  presenceRef.onDisconnect().update({online:false,endedAt:firebase.database.ServerValue.TIMESTAMP,lastSeen:firebase.database.ServerValue.TIMESTAMP}).then(function(){
   if(!connected)return;return presenceRef.set({uid:profile.id,sessionId:sessionId,name:profile.name,online:true,startedAt:firebase.database.ServerValue.TIMESTAMP,lastSeen:firebase.database.ServerValue.TIMESTAMP,endedAt:0,page:page(),visibility:state(),device:/Mobi|Android/i.test(navigator.userAgent)?'هاتف / جهاز لوحي':'كمبيوتر',browser:/Edg\//.test(navigator.userAgent)?'Edge':/Firefox\//.test(navigator.userAgent)?'Firefox':/Chrome\//.test(navigator.userAgent)?'Chrome':/Safari\//.test(navigator.userAgent)?'Safari':'متصفح آخر'});
  }).catch(function(){window.dispatchEvent(new CustomEvent('secure-presence-error'));});
 };
 database.ref('.info/connected').on('value',presenceConnection);timer=setInterval(beat,25000);navigation();
}
['pointerdown','keydown','touchstart'].forEach(function(k){document.addEventListener(k,function(){lastInteraction=Date.now();},{passive:true});});
window.addEventListener('hashchange',function(){viewDetail={};beat();navigation();});
window.addEventListener('secure-navigation',function(e){navigation(e.detail);});document.addEventListener('visibilitychange',beat);
window.addEventListener('pagehide',function(){if(presenceRef&&connected)presenceRef.update({online:false,endedAt:firebase.database.ServerValue.TIMESTAMP,lastSeen:firebase.database.ServerValue.TIMESTAMP}).catch(function(){});});
window.addEventListener('pageshow',function(e){if(e.persisted&&presenceRef)presenceRef.update({online:true,endedAt:0,lastSeen:firebase.database.ServerValue.TIMESTAMP}).catch(function(){});});
window.Secure={ready:ready,api:api,auth:auth,
 login:async function(username,password,remember){await auth.setPersistence(remember?firebase.auth.Auth.Persistence.LOCAL:firebase.auth.Auth.Persistence.SESSION);var out=await api('login',{username:username,password:password,remember:!!remember});await auth.signInWithCustomToken(out.customToken);me=out.account;return me;},
 me:function(){return me;},setMe:function(p){me=p;},presence:startPresence,
 logout:async function(){if(presenceRef){try{await presenceRef.update({online:false,endedAt:firebase.database.ServerValue.TIMESTAMP,lastSeen:firebase.database.ServerValue.TIMESTAMP});await presenceRef.onDisconnect().cancel();}catch(e){}}clearPresence();try{await api('event',{kind:'logout',page:page()});}catch(e){}await auth.signOut();location.replace('index.html');}
};
})();

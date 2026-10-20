'use strict';
const admin=require('firebase-admin');
const crypto=require('node:crypto');
const P=require('../lib/policy.cjs');
const ROOT='secureV8';
const DB_URL='https://servants-preparation-108f3-default-rtdb.europe-west1.firebasedatabase.app';
function services(){
 if(process.env.VERCEL_ENV&&process.env.VERCEL_ENV!=='production')throw P.error('PRODUCTION_ONLY','الخدمة غير مفعلة في النسخ التجريبية',503);
 if(!admin.apps.length){let c;try{c=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||'');}catch{throw P.error('CONFIG','متغير FIREBASE_SERVICE_ACCOUNT_JSON غير صالح',503);}
 if(c.project_id!=='servants-preparation-108f3')throw P.error('CONFIG','المفتاح ليس للمشروع الصحيح',503);
 admin.initializeApp({credential:admin.credential.cert(c),databaseURL:DB_URL});}
 return {db:admin.database(),auth:admin.auth()};
}
function sameOrigin(req){const origin=req.headers.origin;const host=req.headers.host;if(!origin||new URL(origin).host!==host)throw P.error('ORIGIN','مصدر طلب غير مسموح');}
function constant(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function entry(actor,action,detail={}){return {id:crypto.randomUUID(),at:Date.now(),actorId:actor.id,actorName:P.cleanName(actor.name),action,...detail};}
function audit(root,e){root.audit=root.audit||{};root.audit[e.id]=e;const keys=Object.keys(root.audit).sort((a,b)=>root.audit[a].at-root.audit[b].at);for(const k of keys.slice(0,Math.max(0,keys.length-1000)))delete root.audit[k];}
async function writeAudit(db,e){await db.ref(ROOT+'/audit').transaction(x=>{const holder={audit:x||{}};audit(holder,e);return holder.audit;},undefined,false);}
async function rate(db,key,limit=12,window=15*60*1000){const ref=db.ref('secureV8Limits/'+key),now=Date.now();let blocked=false;await ref.transaction(x=>{x=x&&x.until>now?x:{n:0,until:now+window};if(x.n>=limit){blocked=true;return;}return {n:x.n+1,until:x.until};});if(blocked)throw P.error('RATE_LIMIT','محاولات كثيرة؛ حاول بعد 15 دقيقة',429);}
async function principal(req,db,auth){const match=/^Bearer (.+)$/.exec(req.headers.authorization||'');if(!match)throw P.error('AUTH','سجل دخولك أولًا',401);let token;try{token=await auth.verifyIdToken(match[1],true);}catch{throw P.error('AUTH','الجلسة انتهت؛ سجل دخولك مجددًا',401);}if(!Number.isFinite(token.sessionExpiresAt)||token.sessionExpiresAt<=Date.now())throw P.error('AUTH','انتهت مدة الجلسة؛ سجل دخولك مجددًا',401);const a=(await db.ref(ROOT+'/accounts/'+token.uid).get()).val();if(!a||a.active===false||token.sv!==(a.sessionVersion||1))throw P.error('AUTH','الحساب موقوف أو تغيرت صلاحياته؛ سجل دخولك مجددًا',401);return {actor:a,token};}
async function mutate(db,actor,token,fn){let failure,result;const now=Date.now();const tx=await db.ref(ROOT).transaction(root=>{
 failure=null;result=null;
 try{if(!root?.accounts)throw P.error('NOT_READY','لم يتم الإعداد',503);const current=root.accounts[actor.id];if(!current||current.active===false||(current.sessionVersion||1)!==token.sv)throw P.error('AUTH','الجلسة انتهت',401);result=fn(root,current,now);return root;}catch(e){failure=e;return;}
 },undefined,false);if(failure)throw failure;if(!tx.committed)throw P.error('CONFLICT','تعارض الحفظ؛ أعد المحاولة',409);return result;}
function profileData(data,old){const name=P.text(data.name,150),username=P.text(data.username,100),role=P.text(data.role||old?.role||'خادم',100);if(!name||/[<>]|&(?:lt|gt);/i.test(name))throw P.error('INVALID','اكتب اسمًا بدون HTML',400);if(!username||/[<>\[\]{}]/.test(username))throw P.error('INVALID','اسم مستخدم غير صالح',400);if(role==='إدارة النظام'&&!old?.owner)throw P.error('INVALID','إدارة النظام لا تمنح كدور جديد',400);return {id:old?.id||crypto.randomUUID(),name,username,role,photo:P.photo(data.photo||''),phone:P.text(data.phone||'',40),permissions:P.permissions(data.permissions),owner:old?.owner===true,active:old?.active!==false,sessionVersion:old?.sessionVersion||1};}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store, private');res.setHeader('X-Content-Type-Options','nosniff');
 try{
 if(req.method!=='POST')return res.status(405).json({error:'METHOD',message:'POST required'});
 sameOrigin(req);
 const bytes=Number(req.headers['content-length']||0);if(bytes>3500000)throw P.error('TOO_LARGE','الطلب كبير جدًا؛ قلّل الصور أو حجم الدفعة',413);
 const body=typeof req.body==='string'?JSON.parse(req.body):req.body;if(!body||typeof body.action!=='string')throw P.error('INVALID','طلب غير صالح',400);
 const {db,auth}=services(),data=body.data||{};
 if(body.action==='health'){
  const ready=(await db.ref(ROOT+'/config/ready').get()).val()===true;
  return res.json({ok:true,ready,version:8});
 }
 if(body.action==='setup'){
  if(!process.env.E3_SETUP_TOKEN||process.env.E3_SETUP_TOKEN.length<32||!constant(req.headers['x-setup-token'],process.env.E3_SETUP_TOKEN))throw P.error('SETUP_DENIED','رمز الإعداد غير صحيح');
  if(data.confirm!=='MIGRATE_WITH_NEW_PASSWORDS')throw P.error('CONFIRM','تأكيد النقل مطلوب',400);
  if((await db.ref(ROOT).get()).exists())throw P.error('ALREADY_SETUP','النسخة الجديدة موجودة؛ لن يتم استبدالها',409);
  // Do not migrate while legacy data is publicly readable.
  const probe=await fetch(DB_URL+'/ekhdam.json?shallow=true',{signal:AbortSignal.timeout(6000)});
  if(probe.status!==401&&probe.status!==403)throw P.error('LOCK_FIRST','أغلق قواعد القاعدة أولًا بقواعد الصيانة المرفقة؛ النقل ممنوع والبيانات مفتوحة');
  const legacy=(await db.ref('ekhdam').get()).val();if(!legacy?.users)throw P.error('NO_LEGACY','لم توجد حسابات قديمة',400);
  const ownerKey=P.text(data.ownerId||'',128),source=legacy.users[ownerKey];
  if(!source||source.role!=='إدارة النظام')throw P.error('OWNER','معرف إدارة النظام غير صحيح',400);
  const accounts={},credentials={},usernames={},now=Date.now();let ownerPass;
  for(const [key,v] of Object.entries(legacy.users)){
   if(!v||typeof v!=='object')continue;
   if(!/^[\w-]{1,128}$/.test(key))throw P.error('MIGRATION','معرف قديم غير مدعوم: '+key,400);
   const username=P.text(v.username||v.u||'',100),hash=P.usernameKey(username);if(!username||usernames[hash])throw P.error('DUPLICATE','اسم مستخدم مكرر أو فارغ؛ راجع النسخة القديمة',400);
   const owner=key===ownerKey;
   accounts[key]={id:key,name:P.cleanName(v.name||username),username,role:owner?'إدارة النظام':v.role==='إدارة النظام'?'خادم':v.role||'خادم',phone:String(v.phone||''),photo:'',owner,active:owner,permissions:owner?{}:{viewResults:true},sessionVersion:1};
   try{accounts[key].photo=P.photo(v.photo||'');}catch{};
   const password=crypto.randomBytes(20).toString('base64url');credentials[key]=P.passwordHash(password);if(owner)ownerPass=password;usernames[hash]=key;
   try{await auth.getUser(key);}catch(e){if(e.code==='auth/user-not-found')await auth.createUser({uid:key,displayName:accounts[key].name});else throw e;}
  }
  const map=x=>{const o={};for(const [key,v] of Object.entries(x||{}))if(v&&typeof v==='object'){const id=String(v.id||key);if(!/^[\w-]{1,128}$/.test(id))throw P.error('MIGRATION','معرف بيانات غير مدعوم',400);if(o[id])throw P.error('MIGRATION','معرف سجل مكرر؛ راجع النسخة الاحتياطية',400);o[id]={...v,id};}return o;};
  const root={config:{ready:true,ownerUid:ownerKey,migratedAt:now,version:8},accounts,credentials,usernames,state:{students:map(legacy.students),subjects:map(legacy.subjects),version:1},audit:{}};
  audit(root,entry(accounts[ownerKey],'migration',{count:Object.keys(accounts).length}));
  const done=await db.ref(ROOT).transaction(cur=>cur?undefined:root,undefined,false);if(!done.committed)throw P.error('ALREADY_SETUP','نُفذ الإعداد مسبقًا',409);
  return res.json({ok:true,ownerUsername:accounts[ownerKey].username,temporaryPassword:ownerPass,accounts:Object.keys(accounts).length,students:Object.keys(root.state.students).length,subjects:Object.keys(root.state.subjects).length,message:'احفظ كلمة المرور الآن؛ لن تظهر مرة أخرى. باقي الحسابات موقوفة لحين تعيين كلمات مرور جديدة وتفعيلها.'});
 }
 if(body.action==='login'){
  const username=P.text(data.username,100),password=data.password,key=P.usernameKey(username);
  if(typeof password!=='string'||password.length>128)throw P.error('LOGIN','بيانات دخول غير صحيحة',401);
  const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'unknown').split(',')[0];
  const secret=process.env.FIREBASE_SERVICE_ACCOUNT_JSON||'';const ipKey=crypto.createHmac('sha256',secret).update(ip).digest('hex');
  await rate(db,'ip_'+ipKey,40);await rate(db,'user_'+key,12);
  const uid=(await db.ref(ROOT+'/usernames/'+key).get()).val();
  const a=uid?(await db.ref(ROOT+'/accounts/'+uid).get()).val():null;
  const c=uid?(await db.ref(ROOT+'/credentials/'+uid).get()).val():{salt:'dummy',hash:'00'.repeat(64)};
  const valid=P.verifyPassword(password,c);
  if(!a||a.active===false||!valid)throw P.error('LOGIN','اسم المستخدم أو كلمة المرور غير صحيحين، أو الحساب موقوف',401);
  const customToken=await auth.createCustomToken(uid,{sv:a.sessionVersion||1,sessionExpiresAt:Date.now()+(data.remember===true?7*86400000:8*3600000)});
  await writeAudit(db,entry(a,'login'));
  return res.json({customToken,account:P.publicAccount(a)});
 }
 const {actor,token}=await principal(req,db,auth);
 await rate(db,'api_'+actor.id,240,60000);
 let output;
 if(body.action==='snapshot'){
  const root=(await db.ref(ROOT).get()).val();const me=root?.accounts?.[actor.id];if(!me||me.active===false||(me.sessionVersion||1)!==token.sv)throw P.error('AUTH','الجلسة انتهت',401);
  output={me:P.publicAccount(me),state:P.projectState(me,root.state||{}),users:P.has(me,'manageUsers')?Object.values(root.accounts||{}).map(P.publicAccount):[P.publicAccount(me)],permissionLabels:P.PERMS};
 }else if(body.action==='commit'){
  output=await mutate(db,actor,token,(root,me)=>{
   const state=root.state||{students:{},subjects:{},version:0};if(data.version!==state.version)throw P.error('CONFLICT','وصل تعديل أحدث؛ أعد تحميل البيانات قبل الحفظ',409);
   // Client may only round-trip data it was allowed to read.
   const visible=P.projectState(me,state),submitted={students:data.students||{},subjects:data.subjects||{}};
   const next={students:{...(state.students||{})},subjects:{...(state.subjects||{})}};
   if(P.has(me,'viewStudents'))next.students=submitted.students;
   else if(!P.eq(visible.students,submitted.students))throw P.error('DENIED','تعديل الدارسين يحتاج صلاحية عرض بياناتهم');
   if(P.has(me,'viewSubjects')||P.has(me,'viewStudents')||P.has(me,'viewResults'))next.subjects=submitted.subjects;
   else if(!P.eq(submitted.subjects,{}))throw P.error('DENIED','غير مسموح');
   const changes=P.diffState(me,state,next);if(changes.length>200)throw P.error('BATCH','الحد الأقصى 200 تغيير في الطلب الواحد',400);
   if(!changes.length)return {version:state.version};
   root.state={...next,version:state.version+1,updatedAt:Date.now()};for(const c of changes)audit(root,entry(me,c.action,{...c,page:P.text(data.page||'',200)}));return {version:root.state.version};
  });
 }else if(body.action==='account'){
  const action=P.text(data.operation||'update',20);if(!['self','create','update','status','delete'].includes(action))throw P.error('INVALID','عملية غير صالحة',400);
  const id=action==='self'?actor.id:action==='create'?null:P.text(data.id,128);
  const requestedPassword=data.newPassword||'';if(requestedPassword)P.validatePassword(requestedPassword);
  const hash=requestedPassword?P.passwordHash(requestedPassword):null;
  output=await mutate(db,actor,token,(root,me)=>{
   const old=id?root.accounts[id]:null;if(id&&!old)throw P.error('NOT_FOUND','الحساب غير موجود',404);
   if(action==='status'){
    const next={...old,active:data.active===true};P.authorizeAccount(me,old,next,'status');if(old.id===me.id)throw P.error('DENIED','لا يمكنك إيقاف حسابك');
    root.accounts[id]={...next,sessionVersion:(old.sessionVersion||1)+1};audit(root,entry(me,next.active?'activate_user':'suspend_user',{targetId:id}));return {ok:true};
   }
   if(action==='delete'){
    P.authorizeAccount(me,old,null,'delete');if(id===me.id)throw P.error('DENIED','لا يمكنك حذف حسابك');delete root.accounts[id];delete root.credentials[id];delete root.usernames[P.usernameKey(old.username)];audit(root,entry(me,'delete_user',{targetId:id}));return {ok:true};
   }
   let next=profileData(data,old);
   if(action==='self'){next={...next,owner:old.owner,role:old.role,active:old.active,permissions:old.permissions||{}};}
   P.authorizeAccount(me,old,next,action);if(action!=='self')P.validatePermissionDependencies(next.permissions);
   if(old&&old.id===me.id&&action!=='self')throw P.error('SELF','لتعديل حسابك استخدم صفحة حسابك');
   if(requestedPassword&&old&&action!=='self'&&!me.owner)throw P.error('DENIED','تغيير كلمة مرور الآخرين لإدارة النظام فقط');
   if(action==='self'&&requestedPassword&&!P.verifyPassword(data.currentPassword||'',root.credentials[id]))throw P.error('CURRENT_PASSWORD','كلمة المرور الحالية غير صحيحة',400);
   if(action==='create'&&!requestedPassword)throw P.error('PASSWORD','كلمة مرور الحساب الجديد مطلوبة',400);
   const index=P.usernameKey(next.username),taken=root.usernames[index];if(taken&&taken!==next.id)throw P.error('DUPLICATE','اسم المستخدم مستخدم بالفعل',409);
   if(old&&P.usernameKey(old.username)!==index)delete root.usernames[P.usernameKey(old.username)];root.usernames[index]=next.id;
   const securityChanged=!!old&&(requestedPassword||!P.eq(old.permissions,next.permissions));if(securityChanged)next.sessionVersion=(old.sessionVersion||1)+1;
   root.accounts[next.id]=next;if(hash)root.credentials[next.id]=hash;
   audit(root,entry(me,action==='self'?'profile_updated':action==='create'?'user_created':'user_updated',{targetId:next.id,passwordChanged:!!requestedPassword}));
   return {account:P.publicAccount(next),relogin:next.id===me.id&&!!securityChanged};
  });
  if(output.account){try{await auth.getUser(output.account.id);}catch(e){if(e.code==='auth/user-not-found')await auth.createUser({uid:output.account.id,displayName:output.account.name});else throw e;}}
 }else if(body.action==='navigate'){
  const page=P.text(data.page||'',200),tab=page.split(/[/?]/)[0];const permission={students:'viewStudents',student:'viewStudents',subjects:'viewSubjects',results:'viewResults',team:'manageUsers'}[tab];
  if(permission)P.need(actor,permission);else if(tab==='activity'){if(!actor.owner)throw P.error('DENIED','غير مسموح');}else if(tab!=='profile')throw P.error('INVALID','صفحة غير صالحة',400);
  const extra={page,source:'client_reported'};if(Number.isInteger(data.level)&&data.level>=1&&data.level<=3)extra.level=data.level;if(['table','retake'].includes(data.mode))extra.mode=data.mode;
  await writeAudit(db,entry(actor,'page_view',extra));output={ok:true};
 }else if(body.action==='activity'){
  if(!actor.owner)throw P.error('DENIED','الحضور وسجل النشاط لإدارة النظام فقط');
  const [presence,events]=(await Promise.all([db.ref('v8Presence').get(),db.ref(ROOT+'/audit').orderByChild('at').limitToLast(250).get()])).map(s=>s.val()||{});
  output={presence,events:Object.values(events).sort((a,b)=>b.at-a.at)};
 }else if(body.action==='event'){
  const kind=P.text(data.kind||'',30);if(!['print','export','logout'].includes(kind))throw P.error('INVALID','نوع حدث غير مسموح',400);
  if(kind!=='logout')P.need(actor,kind);
  if(kind==='export'){
   P.need(actor,'viewStudents');P.need(actor,'viewSubjects');
   const state=(await db.ref(ROOT+'/state').get()).val()||{};output={db:state};
  }else output={ok:true};
  await writeAudit(db,entry(actor,kind,{page:P.text(data.page||'',200),source:'client_request'}));
 }else if(body.action==='purge'){
  if(!actor.owner)throw P.error('DENIED','غير مسموح');const all=(await db.ref('v8Presence').get()).val()||{},updates={},cut=Date.now()-30*86400000;
  for(const [uid,sessions]of Object.entries(all))for(const [sid,v]of Object.entries(sessions||{}))if((v.lastSeen||v.endedAt||0)<cut)updates['v8Presence/'+uid+'/'+sid]=null;
  const events=(await db.ref(ROOT+'/audit').orderByChild('at').endAt(cut).get()).val()||{};for(const id of Object.keys(events))updates[ROOT+'/audit/'+id]=null;
  // Login rate buckets contain only counters and hashed identifiers.
  const limits=(await db.ref('secureV8Limits').get()).val()||{};for(const [id,v]of Object.entries(limits))if(v.until<Date.now())updates['secureV8Limits/'+id]=null;
  if(Object.keys(updates).length)await db.ref().update(updates);output={ok:true,removed:Object.keys(updates).length};
 }else throw P.error('NOT_FOUND','عملية غير معروفة',404);
 return res.json(output);
 }catch(e){const status=e.status||500;if(status>=500)console.error('secure-api',e.code||e.name);return res.status(status).json({error:e.code||'SERVER',message:status>=500?'تعذر تنفيذ الطلب؛ راجع إعدادات الخادم وسجل Vercel بدون نشر المفاتيح':e.message});}
};

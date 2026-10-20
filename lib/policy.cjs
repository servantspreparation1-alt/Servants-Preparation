'use strict';
const crypto=require('node:crypto');
const PERMS={
 viewStudents:'عرض بيانات الدارسين',createStudents:'إضافة دارس',updateStudents:'تعديل بيانات الدارسين',deleteStudents:'حذف دارس',
 viewSubjects:'عرض المواد',createSubjects:'إضافة مادة',updateSubjects:'تعديل المواد',deleteSubjects:'حذف مادة',
 viewResults:'عرض النتائج',editGrades:'تعديل الدرجات والمحاولات والمعايير الخاصة',print:'الطباعة',export:'تصدير البيانات',
 manageUsers:'إدارة حسابات الخدام',createUsers:'إنشاء حسابات',updateUsers:'تعديل الحسابات العادية',suspendUsers:'إيقاف وتفعيل الحسابات',deleteUsers:'حذف حسابات',grantPermissions:'تعيين الصلاحيات داخل نطاق التفويض'
};
const ALL=Object.keys(PERMS);
function error(code,message,status=403){return Object.assign(new Error(message),{code,status});}
function has(p,k){return !!p&&(p.owner===true||p.permissions?.[k]===true);}
function need(p,k){if(!has(p,k))throw error('DENIED','غير مسموح: '+(PERMS[k]||k));}
function normUser(s){return String(s||'').normalize('NFKC').trim().toLowerCase();}
function usernameKey(s){return crypto.createHash('sha256').update(normUser(s)).digest('hex');}
function cleanName(s){return String(s||'').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/<[^>]*>/g,'').replace(/<[^>]*$/g,'').replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim();}
function text(s,n=200){if(typeof s!=='string'||s.length>n||/[\u0000-\u001f]/.test(s))throw error('INVALID','قيمة نصية غير صالحة',400);return s.trim();}
function photo(s){if(!s)return '';if(typeof s!=='string'||s.length>650000)throw error('INVALID','حجم الصورة كبير',400);if(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s))return s;throw error('INVALID','الصورة يجب أن تكون JPG أو PNG أو WEBP مرفوعة من الجهاز',400);}
function permissions(raw){const o={};for(const k of ALL)if(raw?.[k]===true)o[k]=true;return o;}
function validatePermissionDependencies(p){
 const dependencies={createStudents:['viewStudents'],updateStudents:['viewStudents'],deleteStudents:['viewStudents'],editGrades:['viewStudents'],createSubjects:['viewSubjects'],updateSubjects:['viewSubjects'],deleteSubjects:['viewSubjects'],createUsers:['manageUsers'],updateUsers:['manageUsers'],deleteUsers:['manageUsers'],suspendUsers:['manageUsers'],grantPermissions:['manageUsers'],export:['viewStudents','viewSubjects']};
 for(const [key,needed]of Object.entries(dependencies))if(p[key])for(const k of needed)if(!p[k])throw error('DEPENDENCY','صلاحية '+PERMS[key]+' تحتاج '+PERMS[k],400);
}
function publicAccount(a){if(!a)return null;return {id:a.id,name:a.name,username:a.username,u:a.username,role:a.role,phone:a.phone||'',photo:a.photo||'',active:a.active!==false,owner:a.owner===true,permissions:permissions(a.permissions)};}
function effectivePermissions(p){return p.owner?Object.fromEntries(ALL.map(k=>[k,true])):permissions(p.permissions);}
function canManage(actor,target){return target&&((actor.owner===true)||(!target.owner&&has(actor,'manageUsers')));}
function authorizeAccount(actor,old,next,action){
 if(action==='self'){
  if(!old||actor.id!==old.id)throw error('DENIED','غير مسموح');
  for(const k of ['owner','role','active','permissions','id'])if(JSON.stringify(old[k]??null)!==JSON.stringify(next[k]??null))throw error('DENIED','لا يمكن تغيير صلاحيات حسابك');
  return;
 }
 need(actor,'manageUsers');
 if(!actor.owner&&old)for(const k of ALL)if(has(old,k)&&!has(actor,k))throw error('DELEGATION','الحساب المستهدف خارج نطاق تفويضك');
 if(old?.owner)throw error('OWNER_PROTECTED','حساب إدارة النظام محمي');
 if(next?.owner)throw error('DENIED','لا يمكن إنشاء إدارة نظام من واجهة الحسابات');
 if(!old){need(actor,'createUsers');}
 else if(action==='delete'){need(actor,'deleteUsers');}
 else if(action==='status'){need(actor,'suspendUsers');}
 else need(actor,'updateUsers');
 if(!actor.owner&&next){
  const before=permissions(old?.permissions),after=permissions(next.permissions);
  if(JSON.stringify(before)!==JSON.stringify(after)){
   need(actor,'grantPermissions');
   for(const k of ALL)if(before[k]!==after[k]&&!has(actor,k))throw error('DELEGATION','لا يمكنك تغيير صلاحية خارج نطاق تفويضك');
  }
  if(!old)for(const k of ALL)if(after[k]&&!has(actor,k))throw error('DELEGATION','لا يمكنك منح صلاحية لا تملكها');
 }
}
function canonical(x){if(x==null)return null;if(Array.isArray(x))return canonical(Object.fromEntries(x.map((v,i)=>[String(i),v])));if(typeof x==='object'){const o={};for(const k of Object.keys(x).sort()){const v=canonical(x[k]);if(v!==null&&!(typeof v==='object'&&Object.keys(v).length===0))o[k]=v;}return o;}return x;}
const eq=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function stripGrade(x){const o={...x};for(const k of ['grades','custom','attempts'])delete o[k];return o;}
function validMap(map){if(!map||typeof map!=='object'||Array.isArray(map))throw error('INVALID','بيانات غير صالحة',400);for(const [id,v]of Object.entries(map)){if(['__proto__','prototype','constructor'].includes(id)||!/^[\w-]{1,128}$/.test(id)||!v||typeof v!=='object'||Array.isArray(v)||v.id!==id)throw error('INVALID','معرف سجل غير صالح',400);}}
function diffState(actor,old,next){
 validMap(next.students);validMap(next.subjects);
 const changes=[];
 const removedSubjects=new Set(Object.keys(old.subjects||{}).filter(id=>!next.subjects[id]));
 for(const [kind,prefix] of [['subjects','Subjects'],['students','Students']]){
  const before=old[kind]||{},after=next[kind];
  for(const id of new Set([...Object.keys(before),...Object.keys(after)])){
   const a=before[id],b=after[id];if(eq(a,b))continue;
   if(!a){need(actor,'create'+prefix);if(!b.name||/[<>]/.test(b.name))throw error('INVALID','اكتب الاسم بدون HTML',400);if(kind==='students'&&(Object.keys(b.grades||{}).length||Object.keys(b.attempts||{}).length||Object.keys(b.custom||{}).length))need(actor,'editGrades');changes.push({action:'create',kind,id,name:cleanName(b.name).slice(0,150)});continue;}
   if(!b){need(actor,'delete'+prefix);changes.push({action:'delete',kind,id,name:cleanName(a.name).slice(0,150)});continue;}
   if(kind==='subjects'){need(actor,'updateSubjects');}
   else{
    if(!eq(stripGrade(a),stripGrade(b)))need(actor,'updateStudents');
    let ag={},bg={};
    for(const key of ['grades','custom','attempts']){
     ag[key]={...(a[key]||{})};bg[key]={...(b[key]||{})};
     for(const sid of removedSubjects){if(has(actor,'deleteSubjects')&&!Object.hasOwn(bg[key],sid))delete ag[key][sid];}
    }
    if(!eq(ag,bg))need(actor,'editGrades');
   }
   if(a.name!==b.name&&(!b.name||/[<>]/.test(b.name)))throw error('INVALID','اكتب الاسم بدون HTML',400);
   changes.push({action:'update',kind,id,name:cleanName(b.name).slice(0,150),fields:[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>!eq(a[k],b[k])).slice(0,30)});
  }
 }
 return changes;
}
function projectState(actor,state){
 const full=has(actor,'viewStudents'),result=has(actor,'viewResults');let students={},subjects={};
 if(full)students=state.students||{};
 else if(result)for(const [id,s] of Object.entries(state.students||{})){const r={};for(const k of ['id','name','level','status','joinYear','grades','custom','attempts'])if(s[k]!==undefined)r[k]=s[k];students[id]=r;}
 if(has(actor,'viewSubjects')||full||result)subjects=state.subjects||{};
 return {students,subjects,version:state.version||0};
}
function passwordHash(pass){const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync(pass,salt,64).toString('hex')};}
function verifyPassword(pass,c){if(!c?.salt||!c?.hash)return false;try{return crypto.timingSafeEqual(crypto.scryptSync(pass,c.salt,64),Buffer.from(c.hash,'hex'));}catch{return false;}}
function validatePassword(p){if(typeof p!=='string'||p.length<12||p.length>128)throw error('INVALID','كلمة المرور من 12 إلى 128 حرفًا',400);}
module.exports={validatePermissionDependencies,PERMS,ALL,error,has,need,normUser,usernameKey,cleanName,text,photo,permissions,publicAccount,effectivePermissions,authorizeAccount,diffState,projectState,passwordHash,verifyPassword,validatePassword,eq};
